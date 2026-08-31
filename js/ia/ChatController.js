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
        this.narrando = false; // áudio em reprodução — ver _definirGerando
        this.paleta = null; // definida por conectarPaleta()

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
                    aoOuvir: typeof window.speak === 'function' ? (t) => this._falar(t) : null,
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
                const erro = await resposta.json().catch(() => ({}));
                this.renderer.mostrarAviso(
                    erro.error || 'Não foi possível falar com o assistente agora.'
                );
                return;
            }

            this.ultimaPergunta = texto;
            await this._consumirStream(resposta.body);

            if (cancelado) {
                this.renderer.mostrarAviso('Geração interrompida.', { tipo: 'info' });
            }
        } catch (e) {
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
            // Houve erro, mas pode ter ficado uma ação pendente no servidor.
            // Descartar evita um token vivo sem card correspondente na tela.
            for (const c of confirmacoes) this.confirmacao._descartar(c.confirmToken);
            return null;
        }

        const texto = this.renderer.finalizarResposta({
            aoCopiar: (t, botao) => this._copiar(t, botao),
            aoRegenerar: () => this.regenerar(),
            aoOuvir: typeof window.speak === 'function' ? (t) => this._falar(t) : null,
        });

        // Os cards vêm DEPOIS do texto: o assistente primeiro explica o que
        // entendeu, e só então a pessoa decide.
        for (const acao of confirmacoes) {
            this.confirmacao.renderizar(this.el.mensagens, acao);
        }
        if (confirmacoes.length > 0) this.renderer.rolarParaFim();

        // Narração automática. Fica aqui, e não em `finalizarResposta`, para NÃO
        // disparar em `retomar()`: reabrir uma conversa antiga não deve começar
        // a ler respostas que a pessoa já leu. O `aborted` cobre o caso de ter
        // clicado em "parar" — narrar meia resposta seria pior que silêncio.
        if (this.narrarAuto && texto && !this.controlador?.signal.aborted) {
            this._falar(texto);
        }

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
     * calar o áudio sem chamar `window.stopTtsAudio` direto: aquela chamada
     * pararia o som mas deixaria `narrando` ligado, e o controller pararia de
     * devolver o orb ao repouso a partir dali.
     */
    pararNarracao() {
        if (window.stopTtsAudio) window.stopTtsAudio();
        this.narrando = false;
    }

    /**
     * Narra a resposta usando o serviço de voz já existente na página
     * (`window.speak`, definido em sidebar-voice.js). Voz é opcional: uma falha
     * aqui nunca invalida a resposta de texto.
     */
    async _falar(texto) {
        // Falha de voz vira estado `erro` (esfera âmbar + rótulo com a causa),
        // e não `ocioso`: cair direto no repouso fazia a narração sumir sem
        // que a tela registrasse nada — só o toast, que passa em 3,5s.
        const falhar = (mensagem) => {
            this.narrando = false;
            this.aoMudarEstado('erro', mensagem);
            this.aoAvisar(mensagem);
        };

        if (typeof window.speak !== 'function') {
            falhar('A narração não está disponível nesta página.');
            return;
        }
        const encerrar = () => {
            this.narrando = false;
            this.aoMudarEstado('ocioso');
        };

        try {
            if (window.stopTtsAudio) window.stopTtsAudio();
            this.narrando = true;
            this.aoMudarEstado('falando');
            // Marcação de Markdown não deve ser lida em voz alta.
            const limpo = texto
                .replace(/[*_~`#|>]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const audio = await window.speak(limpo);

            if (audio && 'onended' in audio) {
                // `onended` só cobre o fim natural. Sem o `onerror` o orb ficava
                // preso em "Narrando a resposta..." quando o áudio falhava no
                // meio da reprodução.
                audio.onended = encerrar;
                audio.onerror = encerrar;
                return;
            }

            // `window.speak` devolve null quando o servidor de voz recusa. Sem
            // aviso, a pessoa clica em "Ouvir" e não acontece absolutamente
            // nada — parecia que o botão estava quebrado.
            falhar('Não foi possível gerar o áudio agora. O texto da resposta continua acima.');
        } catch (e) {
            console.warn('[IA] Narração indisponível:', e?.message);
            falhar('Não foi possível gerar o áudio agora.');
        }
    }
}

export { ESTADO_VAZIO_HTML, MAX_CHARS_MENSAGEM };
