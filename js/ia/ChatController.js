/**
 * ChatController.js — orquestra a conversa do copiloto.
 *
 * Responsabilidades: falar com `POST /api/ia/chat`, consumir o stream SSE,
 * manter o histórico do turno e comandar o StreamRenderer. Nenhum HTML é
 * montado aqui, e nenhuma regra de permissão vive aqui — a autorização é toda
 * do servidor; o que a interface faz é só refletir o que ele responde.
 *
 * POR QUE `fetch` E NÃO `EventSource`
 * -----------------------------------
 * Toda escrita em /api passa pelo validador CSRF, que exige o cabeçalho
 * `X-CSRF-Token`. `EventSource` não envia cabeçalhos personalizados — então
 * consumimos o mesmo formato SSE por `fetch` + `ReadableStream`. De brinde vem
 * o `AbortController`, que é o que faz o botão "parar" realmente interromper a
 * geração no servidor em vez de só esconder o texto.
 */

import { ActionConfirm } from './ActionConfirm.js';
import { NarradorStream } from './NarradorStream.js';
import { SegmentadorFala } from './SegmentadorFala.js';
import { StreamRenderer } from './StreamRenderer.js';

/** Teto por mensagem. Espelha MAX_CHARS_MENSAGEM do IaCopilotoController. */
const MAX_CHARS_MENSAGEM = 4000;

/**
 * Tela inicial. As sugestões são `<button>` (e não `<div>`) para chegarem à
 * navegação por teclado sem `tabindex` postiço.
 */
const ESTADO_VAZIO_HTML = `
  <div class="ia-vazio">
    <div class="ia-vazio-icone"><i data-lucide="sparkles" aria-hidden="true"></i></div>
    <h2>Como posso ajudar?</h2>
    <p>Pergunte sobre rotina escolar, planejamento pedagógico ou como usar o sistema.</p>
    <div class="ia-sugestoes">
      <button type="button" class="ia-sugestao">Como dar um retorno construtivo a uma família?</button>
      <button type="button" class="ia-sugestao">Sugira uma atividade de frações para o 6º ano</button>
      <button type="button" class="ia-sugestao">O que posso fazer neste sistema?</button>
    </div>
  </div>
`;

function lerCookie(nome) {
    const partes = ('; ' + document.cookie).split('; ' + nome + '=');
    if (partes.length === 2) return partes.pop().split(';').shift();
    return '';
}

export class ChatController {
    /**
     * @param {Object} elementos  nós do DOM já resolvidos pela página
     * @param {Object} [opcoes]
     * @param {Function} [opcoes.aoMudarEstado]     (estado, mensagem?) — 'ocioso'|
     *   'pensando'|'falando'|'erro'; `mensagem` só acompanha o estado de erro
     * @param {Function} [opcoes.aoAvisar]          exibe um toast
     * @param {Function} [opcoes.aoReceberContexto] contexto confirmado pelo servidor
     * @param {boolean}  [opcoes.narrarAuto] narrar toda resposta ao terminá-la
     */
    constructor(elementos, opcoes = {}) {
        this.el = elementos;
        this.aoMudarEstado = opcoes.aoMudarEstado || (() => {});
        this.aoAvisar = opcoes.aoAvisar || (() => {});
        this.aoReceberContexto = opcoes.aoReceberContexto || (() => {});

        // Propriedade pública: o painel de preferências troca isso em tempo de
        // execução, sem recriar o controller nem recarregar a página.
        this.narrarAuto = Boolean(opcoes.narrarAuto);

        this.aoSalvarConversa = opcoes.aoSalvarConversa || (() => {});

        this.renderer = new StreamRenderer(elementos.mensagens);
        this.confirmacao = new ActionConfirm({
            aoAvisar: this.aoAvisar,
            // "Editar" devolve o pedido à caixa para a pessoa reescrever.
            aoEditar: (texto) => {
                this.el.entrada.value = texto;
                this._ajustarAltura();
                this.el.entrada.focus();
            },
        });
        // A partir da Fase 3 o histórico vive no servidor. O cliente guarda
        // apenas QUAL conversa está aberta e a última pergunta, para o botão
        // "gerar outra resposta".
        this.conversaId = null;
        this.ultimaPergunta = null;
        this.controlador = null; // AbortController do envio em curso
        this.gerando = false;
        this.narrando = false; // narração em curso — ver _definirGerando
        this.paleta = null; // definida por conectarPaleta()

        /** @type {NarradorStream|null} fila de áudio da narração em curso */
        this.narrador = null;
        /** @type {SegmentadorFala|null} corta a resposta em trechos falados */
        this.segmentador = null;

        this._ligarEventos();
    }

    get baseApi() {
        return (window.API_BASE_URL || '/api').replace(/\/$/, '');
    }

    _ligarEventos() {
        const { entrada, botaoEnviar, botaoParar, botaoNova } = this.el;

        entrada.addEventListener('input', () => {
            this._ajustarAltura();
            this.paleta?.aoDigitar();
        });
        entrada.addEventListener('keydown', (e) => {
            // A paleta tem prioridade nas setas e no Enter enquanto estiver
            // aberta — senão a primeira seta enviaria a mensagem "/".
            if (this.paleta?.aoTeclar(e)) return;

            // Enter envia; Shift+Enter quebra linha. Padrão que todo mundo já espera.
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.enviar();
            }
        });
        entrada.addEventListener('blur', () => this.paleta?.fechar());

        botaoEnviar.addEventListener('click', () => this.enviar());
        botaoParar?.addEventListener('click', () => this.parar());
        botaoNova?.addEventListener('click', () => this.novaConversa());
    }

    /**
     * Liga a paleta de comandos. Fica fora do construtor porque a página é
     * quem sabe se o elemento existe — assim o controller segue utilizável
     * numa tela sem paleta.
     */
    conectarPaleta(paleta) {
        this.paleta = paleta;
    }

    /**
     * Executa um comando escolhido na paleta.
     * Comandos do tipo `interface` são resolvidos pela página (nova conversa,
     * exportar, ajuda) — por isso o retorno indica quem tratou.
     *
     * @returns {boolean} true se o controller já resolveu o comando
     */
    executarComando(comando) {
        if (comando.tipo === 'prompt') {
            this._conversar(comando.prompt);
            return true;
        }
        if (comando.tipo === 'navegacao') {
            window.location.href = comando.destino;
            return true;
        }
        if (comando.tipo === 'interface' && comando.nome === 'nova') {
            this.novaConversa();
            return true;
        }
        return false; // 'ajuda' e 'exportar' são da página
    }

    _ajustarAltura() {
        const { entrada } = this.el;
        entrada.style.height = 'auto';
        entrada.style.height = Math.min(entrada.scrollHeight, 160) + 'px';
    }

    _definirGerando(valor) {
        this.gerando = valor;
        this.el.botaoEnviar.disabled = valor;
        this.el.entrada.disabled = valor;
        if (this.el.botaoParar) this.el.botaoParar.hidden = !valor;

        // Com narração automática a fala começa DENTRO do stream, então este
        // "ocioso" do fim da geração chegaria depois e apagaria o "falando" —
        // o orb voltava ao repouso com o áudio ainda tocando. Quem narra é dono
        // do estado até o áudio acabar.
        if (valor || !this.narrando) {
            this.aoMudarEstado(valor ? 'pensando' : 'ocioso');
        }
        if (!valor) this.el.entrada.focus();
    }

    /** Lê o texto da caixa e dispara o envio. */
    enviar() {
        if (this.gerando) return;
        const texto = this.el.entrada.value.trim();
        if (!texto) return;

        if (texto.length > MAX_CHARS_MENSAGEM) {
            this.aoAvisar(
                'Mensagem muito longa. Reduza para no máximo ' + MAX_CHARS_MENSAGEM + ' caracteres.'
            );
            return;
        }

        this.el.entrada.value = '';
        this._ajustarAltura();
        this._conversar(texto);
    }

    /**
     * Reenvia a última pergunta.
     *
     * A tela é limpa do último par, mas o turno anterior CONTINUA no servidor —
     * apagá-lo exigiria um endpoint de edição de histórico, e uma nova tentativa
     * é informação legítima da conversa. O modelo recebe as duas e a segunda
     * pergunta funciona como um "reformule".
     */
    regenerar() {
        if (this.gerando || !this.ultimaPergunta) return;

        const mensagens = this.el.mensagens.querySelectorAll('.ia-msg');
        for (let i = mensagens.length - 1; i >= 0; i--) {
            const m = mensagens[i];
            m.remove();
            if (m.classList.contains('ia-msg-usuario')) break;
        }

        this._conversar(this.ultimaPergunta);
    }

    /** Interrompe a geração em curso. */
    parar() {
        if (!this.controlador) return;
        this.controlador.abort();
    }

    /** Abre uma conversa em branco. Sem id, o servidor cria um registro novo. */
    novaConversa() {
        if (this.gerando) this.parar();
        // Abrir uma conversa em branco com a resposta anterior ainda sendo lida
        // em voz alta deixa a tela e o áudio falando de coisas diferentes.
        this.pararNarracao();
        this.conversaId = null;
        this.ultimaPergunta = null;
        this.renderer.limpar(ESTADO_VAZIO_HTML);
        this.el.entrada.focus();
    }

    /**
     * Retoma uma conversa anterior, repintando o histórico vindo do servidor.
     * @param {Object} conversa resposta de GET /api/ia/conversas/:id
     */
    retomar(conversa) {
        if (this.gerando) this.parar();
        this.pararNarracao();

        this.conversaId = conversa.id;
        this.renderer.limpar('');

        for (const m of conversa.mensagens || []) {
            if (m.papel === 'usuario') {
                this.renderer.adicionarMensagemUsuario(m.texto);
                this.ultimaPergunta = m.texto;
            } else {
                this.renderer.adicionarRespostaPronta(m.texto, {
                    ferramentas: m.ferramentas,
                    aoCopiar: (t, b) => this._copiar(t, b),
                    aoRegenerar: () => this.regenerar(),
                    aoOuvir: (t, b) => this._falar(t, b),
                });
            }
        }

        // Trechos antigos comprimidos: a pessoa precisa saber que a conversa
        // continua antes do que está na tela.
        if (conversa.temResumoAnterior) {
            this.renderer.mostrarAviso(
                `O início desta conversa (${conversa.mensagensResumidas} mensagens) foi resumido para caber na memória do assistente.`,
                { tipo: 'info' }
            );
        }

        this.el.entrada.focus();
    }

    // ── Núcleo ───────────────────────────────────────────────────────────────

    async _conversar(texto) {
        this.renderer.adicionarMensagemUsuario(texto);
        this.renderer.iniciarResposta();
        this._definirGerando(true);

        // A narração é aberta AQUI, antes do primeiro token, e não no fim da
        // resposta: é o que permite ao primeiro trecho ir para a síntese assim
        // que a primeira frase fechar, com o resto do texto ainda chegando.
        if (this.narrarAuto) this._abrirNarracao(this.renderer.corpoAtual);

        this.controlador = new AbortController();
        let cancelado = false;
        this.controlador.signal.addEventListener('abort', () => {
            cancelado = true;
        });

        try {
            const resposta = await fetch(this.baseApi + '/ia/chat', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'text/event-stream',
                    'X-CSRF-Token': lerCookie('csrf_token'),
                },
                body: JSON.stringify({
                    mensagem: texto,
                    // Só o PONTEIRO da conversa. O conteúdo do histórico é lido
                    // do banco pelo servidor; um id que não seja desta pessoa
                    // (ou desta escola) simplesmente abre uma conversa nova.
                    conversaId: this.conversaId || undefined,
                }),
                signal: this.controlador.signal,
            });

            // Erro tratado (rate limit, sem configuração, sem permissão) volta
            // como JSON comum, não como stream.
            if (!resposta.ok || !resposta.body) {
                this.pararNarracao();
                const erro = await resposta.json().catch(() => ({}));
                this.renderer.mostrarAviso(
                    erro.error || 'Não foi possível falar com o assistente agora.'
                );
                return;
            }

            this.ultimaPergunta = texto;
            await this._consumirStream(resposta.body);

            if (cancelado) {
                this.pararNarracao();
                this.renderer.mostrarAviso('Geração interrompida.', { tipo: 'info' });
            }
        } catch (e) {
            this.pararNarracao();
            if (cancelado || e.name === 'AbortError') {
                this.renderer.mostrarAviso('Geração interrompida.', { tipo: 'info' });
            } else {
                console.error('[IA] Falha na conversa:', e);
                this.renderer.mostrarAviso('Conexão perdida durante a resposta. Tente novamente.');
            }
        } finally {
            this.controlador = null;
            this._definirGerando(false);
        }
    }

    /**
     * Lê o corpo SSE e alimenta o renderizador.
     * @returns {Promise<string|null>} texto final, ou null se o servidor sinalizou erro
     */
    async _consumirStream(corpo) {
        const leitor = corpo.getReader();
        const decodificador = new TextDecoder();
        let buffer = '';
        let houveErro = false;
        const confirmacoes = [];

        for (;;) {
            const { done, value } = await leitor.read();
            if (done) break;

            buffer += decodificador.decode(value, { stream: true });

            // Eventos SSE são separados por linha em branco. O que sobrar no
            // buffer é um evento partido pelo meio: fica para a próxima leitura.
            const blocos = buffer.split('\n\n');
            buffer = blocos.pop() ?? '';

            for (const bloco of blocos) {
                for (const linha of bloco.split('\n')) {
                    if (!linha.startsWith('data:')) continue; // ':' = keepalive
                    const carga = linha.slice(5).trim();
                    if (!carga) continue;

                    let evento;
                    try {
                        evento = JSON.parse(carga);
                    } catch {
                        continue;
                    }

                    if (evento.tipo === 'delta') {
                        this.renderer.adicionarDelta(evento.texto || '');
                        // Fora do renderer de propósito: o que vai para a voz
                        // é o texto-fonte, não o HTML que acabou de ser pintado.
                        this._alimentarNarracao();
                    } else if (evento.tipo === 'ferramenta') {
                        this.renderer.mostrarFerramenta(evento.nome);
                    } else if (evento.tipo === 'inicio') {
                        this._aplicarContexto(evento.contexto);
                    } else if (evento.tipo === 'confirmacao') {
                        // Nada foi gravado ainda: o card é a etapa em que a
                        // pessoa lê e decide. Guardamos para renderizar depois
                        // do texto da resposta, e não no meio dele.
                        confirmacoes.push(evento);
                    } else if (evento.tipo === 'conversa') {
                        // Chega DEPOIS do 'fim': o servidor só conhece o título
                        // após gravar o turno. Alimenta a sidebar e passa a ser
                        // o ponteiro usado na próxima mensagem.
                        this.conversaId = evento.id;
                        this.aoSalvarConversa({ id: evento.id, titulo: evento.titulo });
                    } else if (evento.tipo === 'erro') {
                        houveErro = true;
                        this.renderer.mostrarAviso(evento.mensagem || 'Erro ao gerar a resposta.');
                    } else if (evento.tipo === 'fim' && evento.motivo === 'limite_tokens') {
                        this.renderer.adicionarDelta('\n\n_(resposta interrompida por tamanho)_');
                    }
                }
            }
        }

        if (houveErro) {
            // A resposta não vai ficar de pé; seguir narrando o pedaço que
            // chegou deixaria a voz contando uma história que a tela desmentiu.
            this.pararNarracao();
            // Houve erro, mas pode ter ficado uma ação pendente no servidor.
            // Descartar evita um token vivo sem card correspondente na tela.
            for (const c of confirmacoes) this.confirmacao._descartar(c.confirmToken);
            return null;
        }

        const texto = this.renderer.finalizarResposta({
            aoCopiar: (t, botao) => this._copiar(t, botao),
            aoRegenerar: () => this.regenerar(),
            aoOuvir: (t, botao) => this._falar(t, botao),
        });

        // O resto do texto que não fechou frase entra como último trecho, e a
        // fila é fechada: o áudio que ainda está tocando termina em paz.
        this._concluirNarracao();

        // Os cards vêm DEPOIS do texto: o assistente primeiro explica o que
        // entendeu, e só então a pessoa decide.
        for (const acao of confirmacoes) {
            this.confirmacao.renderizar(this.el.mensagens, acao);
        }
        if (confirmacoes.length > 0) this.renderer.rolarParaFim();

        return texto;
    }

    /**
     * O evento `inicio` carrega o contexto que o SERVIDOR reconheceu — é a
     * confirmação visível de que ele sabe quem está falando e de qual escola.
     */
    _aplicarContexto(contexto) {
        if (!contexto) return;

        if (this.el.contexto) {
            const partes = [];
            if (contexto.escola) partes.push(contexto.escola);
            if (contexto.perfil) partes.push(contexto.perfil);
            this.el.contexto.textContent = partes.join(' · ');
        }
        if (this.el.saudacao && contexto.nome) {
            this.el.saudacao.textContent = 'Olá, ' + contexto.nome.split(' ')[0];
        }

        // O perfil daqui é o do SERVIDOR. A página usa isso para corrigir o
        // destino do "voltar", que na primeira pintura sai de um palpite local.
        this.aoReceberContexto(contexto);
    }

    async _copiar(texto, botao) {
        try {
            await navigator.clipboard.writeText(texto);
            botao.classList.add('ia-acao-ok');
            setTimeout(() => botao.classList.remove('ia-acao-ok'), 1400);
        } catch {
            this.aoAvisar('Não foi possível copiar. Selecione o texto manualmente.');
        }
    }

    /**
     * Interrompe a narração em curso.
     *
     * Existe para quem está FORA do controller (o microfone da página) poder
     * calar o áudio sem mexer na fila direto: parar só o som deixaria
     * `narrando` ligado e os trechos seguintes continuariam sendo sintetizados
     * — gastando cota para produzir áudio que ninguém vai ouvir.
     *
     * NÃO mexe no estado visual: quem cala a narração costuma estar indo para
     * outro estado (o microfone vai para "ouvindo", uma conversa nova vai para
     * o repouso), e um "ocioso" aqui piscaria no meio do caminho.
     */
    pararNarracao() {
        // Continua chamando o `stopTtsAudio` global: fora desta fila ainda há
        // áudio que pode estar tocando (a prévia de voz do painel, por exemplo).
        if (window.stopTtsAudio) window.stopTtsAudio();
        this._encerrarNarracao();
    }

    /**
     * Abre uma narração nova, cancelando a que estiver em curso.
     *
     * @param {HTMLElement|null} corpo bolha onde marcar o trecho falado
     * @param {object} [opcoes]
     * @param {boolean} [opcoes.anunciar=false] põe a esfera em "falando" já na
     *   abertura. É o que o botão "Ouvir" precisa: ali o gesto foi explícito e
     *   ficar sem resposta durante a síntese parece botão quebrado. No fluxo
     *   automático fica false — a esfera continua "pensando" enquanto o texto
     *   chega, e só vira "falando" quando sai a primeira nota de áudio.
     * @returns {NarradorStream}
     */
    _abrirNarracao(corpo, { anunciar = false } = {}) {
        this.pararNarracao();
        this.renderer.definirAlvoNarracao(corpo);

        this.segmentador = new SegmentadorFala();
        this.narrador = new NarradorStream({
            aoTocarTrecho: (trecho) => this.renderer.marcarNarracao(trecho.fala),
            aoComecar: () => this.aoMudarEstado('falando'),
            aoTerminar: () => {
                this._encerrarNarracao();
                // Se a resposta ainda está sendo gerada, o estado é da geração:
                // devolver ao repouso aqui apagaria o "pensando" com o texto
                // ainda chegando na tela.
                if (!this.gerando) this.aoMudarEstado('ocioso');
            },
            aoFalhar: (mensagem) => {
                this._encerrarNarracao();
                // Falha de voz vira estado `erro` (esfera âmbar + rótulo com a
                // causa), e não `ocioso`: cair direto no repouso fazia a
                // narração sumir sem que a tela registrasse nada — só o toast,
                // que passa em 3,5s.
                this.aoMudarEstado('erro', mensagem);
                this.aoAvisar(mensagem);
            },
        });

        // Ligado desde a ABERTURA, e não a partir da primeira nota: entre o fim
        // da geração e o início do áudio existe a janela da síntese, e sem esta
        // marca o `_definirGerando(false)` devolveria a esfera ao repouso no
        // meio dela — um "Pronto para ajudar" piscando logo antes da voz sair.
        this.narrando = true;
        if (anunciar) this.aoMudarEstado('falando');

        return this.narrador;
    }

    /** Larga a fila e a marca de trecho, sem tocar no estado visual. */
    _encerrarNarracao() {
        this.narrador?.parar();
        this.narrador = null;
        this.segmentador = null;
        this.narrando = false;
        this.renderer.encerrarNarracao();
    }

    /** Manda para a fila os trechos que fecharam frase até agora. */
    _alimentarNarracao() {
        if (!this.narrador || !this.segmentador) return;
        for (const trecho of this.segmentador.alimentar(this.renderer.textoAcumulado)) {
            this.narrador.enfileirar(trecho);
        }
    }

    /** Entrega o resto do texto e fecha a fila. O áudio pendente ainda toca. */
    _concluirNarracao() {
        if (!this.narrador || !this.segmentador) return;
        for (const trecho of this.segmentador.finalizar()) this.narrador.enfileirar(trecho);
        this.narrador.fechar();
    }

    /**
     * Narra um texto completo — o botão "Ouvir" de uma resposta que já está
     * inteira na tela, seja desta sessão ou vinda do histórico.
     *
     * Passa pela MESMA fila do fluxo automático, e não por uma chamada única de
     * `window.speak`: assim a fala começa depois da primeira frase em vez de
     * depois da síntese da resposta toda, e a frase corrente fica marcada na
     * bolha igual ao caminho automático. Voz é opcional: uma falha aqui nunca
     * invalida a resposta de texto.
     *
     * @param {string} texto
     * @param {HTMLElement} [botao] botão clicado — serve para achar a bolha
     *   desta mensagem, que é onde o trecho falado será marcado
     */
    _falar(texto, botao) {
        if (!texto || !texto.trim()) return;

        // A bolha desta mensagem — que pode ser uma bem acima da última, se a
        // pessoa clicou em "Ouvir" numa resposta antiga. Sem ela, a marca do
        // trecho narrado cairia na bolha errada.
        const bolha = botao?.closest('.ia-msg')?.querySelector('.ia-bolha') || null;

        const narrador = this._abrirNarracao(bolha, { anunciar: true });
        const segmentador = this.segmentador;

        // O texto já está inteiro: `alimentar` tira os trechos que fecham
        // frase (o primeiro deles curto, que é o que começa a falar rápido) e
        // `finalizar` leva o resto.
        for (const trecho of segmentador.alimentar(texto)) narrador.enfileirar(trecho);
        for (const trecho of segmentador.finalizar()) narrador.enfileirar(trecho);
        narrador.fechar();
    }
}

export { ESTADO_VAZIO_HTML, MAX_CHARS_MENSAGEM };
