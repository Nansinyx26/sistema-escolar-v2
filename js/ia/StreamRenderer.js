/**
 * StreamRenderer.js — desenha as mensagens do chat e a resposta que chega
 * token a token.
 *
 * Separado do ChatController de propósito: aqui só existe DOM. Nenhuma chamada
 * de rede, nenhuma regra de negócio. Isso mantém o controller testável e deixa
 * a Fase 5 (destaque de sintaxe, cards de resultado) mexendo em um arquivo só.
 *
 * ACESSIBILIDADE
 * --------------
 * A área de mensagens é `aria-live="polite"`. Um leitor de tela anunciando cada
 * token seria insuportável, então o texto parcial fica em `aria-busy` durante a
 * geração e só é anunciado quando a resposta fecha.
 */

import { renderizarMarkdown, realcarCodigo } from './MarkdownRenderer.js';

/** Intervalo entre repinturas do Markdown parcial (~30 fps de texto). */
const INTERVALO_REPINTURA_MS = 60;

/**
 * Rótulo humano de cada ferramenta. O nome técnico (`contarAlunos`) não diz
 * nada a quem está usando; o rótulo diz o que o assistente foi buscar.
 */
const ROTULOS_FERRAMENTA = {
    contarAlunos: 'Contando alunos...',
    listarTurmas: 'Consultando as turmas...',
    buscarAluno: 'Procurando o aluno...',
    listarProfessores: 'Consultando o quadro docente...',
    consultarFrequencia: 'Verificando a frequência...',
    consultarNotas: 'Consultando as notas...',
    listarEventos: 'Olhando o calendário...',
    listarComunicados: 'Buscando os comunicados...',
    resumoDashboard: 'Montando o panorama da escola...'
};

function agora() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function icone(nome) {
    const i = document.createElement('i');
    i.setAttribute('data-lucide', nome);
    i.setAttribute('aria-hidden', 'true');
    return i;
}

/** Pede ao shim do Lucide para desenhar os ícones recém-inseridos. */
function redesenharIcones() {
    if (typeof window.renderLucideIcons === 'function') window.renderLucideIcons();
    else if (window.lucide?.createIcons) window.lucide.createIcons();
}

export class StreamRenderer {
    /**
     * @param {HTMLElement} container  elemento da lista de mensagens
     */
    constructor(container) {
        this.container = container;
        this.mensagemAtual = null;
        this.corpoAtual = null;
        this.textoAcumulado = '';
        this.ultimaRepintura = 0;
        this.repinturaAgendada = null;
    }

    /** Remove o estado vazio inicial, se ainda estiver na tela. */
    limparEstadoVazio() {
        this.container.querySelector('.ia-vazio')?.remove();
    }

    rolarParaFim() {
        this.container.scrollTop = this.container.scrollHeight;
    }

    /** Bolha do usuário. Texto puro — nunca passa pelo renderizador de Markdown. */
    adicionarMensagemUsuario(texto) {
        this.limparEstadoVazio();

        const item = document.createElement('article');
        item.className = 'ia-msg ia-msg-usuario';

        const bolha = document.createElement('div');
        bolha.className = 'ia-bolha';
        bolha.textContent = texto; // textContent = zero risco de injeção

        const hora = document.createElement('time');
        hora.className = 'ia-hora';
        hora.textContent = agora();

        item.append(bolha, hora);
        this.container.appendChild(item);
        this.rolarParaFim();
        return item;
    }

    /**
     * Abre a bolha do assistente com o indicador de "pensando" e prepara o
     * acúmulo de tokens.
     */
    iniciarResposta() {
        this.limparEstadoVazio();
        this.textoAcumulado = '';
        this.ultimaRepintura = 0;

        const item = document.createElement('article');
        item.className = 'ia-msg ia-msg-assistente';
        item.setAttribute('aria-busy', 'true');

        const bolha = document.createElement('div');
        bolha.className = 'ia-bolha ia-markdown';

        const pensando = document.createElement('div');
        pensando.className = 'ia-pensando';
        pensando.setAttribute('role', 'status');
        pensando.setAttribute('aria-label', 'O assistente está escrevendo');
        pensando.innerHTML = '<span></span><span></span><span></span>';
        bolha.appendChild(pensando);

        item.appendChild(bolha);
        this.container.appendChild(item);
        this.rolarParaFim();

        this.mensagemAtual = item;
        this.corpoAtual = bolha;
        return item;
    }

    /**
     * Repinta uma resposta JÁ COMPLETA, vinda do histórico.
     *
     * Não passa pelo caminho de streaming: não há indicador de "pensando", nem
     * cursor, nem repintura incremental — o texto já existe inteiro.
     */
    adicionarRespostaPronta(texto, { ferramentas, aoCopiar, aoRegenerar, aoOuvir } = {}) {
        this.limparEstadoVazio();

        const item = document.createElement('article');
        item.className = 'ia-msg ia-msg-assistente';

        if (Array.isArray(ferramentas) && ferramentas.length > 0) {
            const trilha = document.createElement('div');
            trilha.className = 'ia-ferramentas';
            for (const nome of ferramentas) {
                const chip = document.createElement('span');
                chip.className = 'ia-ferramenta ia-ferramenta-feita';
                chip.textContent = (ROTULOS_FERRAMENTA[nome] || 'Consulta ao sistema')
                    .replace('...', '');
                trilha.appendChild(chip);
            }
            item.appendChild(trilha);
        }

        const bolha = document.createElement('div');
        bolha.className = 'ia-bolha ia-markdown';
        bolha.innerHTML = renderizarMarkdown(texto);
        realcarCodigo(bolha);
        item.appendChild(bolha);

        this.container.appendChild(item);

        // Reusa a barra de ações do fluxo normal, com o texto já conhecido.
        this.mensagemAtual = item;
        this.corpoAtual = bolha;
        this.textoAcumulado = texto;
        this.finalizarResposta({ aoCopiar, aoRegenerar, aoOuvir });

        return item;
    }

    /**
     * Mostra que o assistente está consultando o sistema.
     *
     * Uma consulta ao banco leva um instante em que nada chega pelo stream —
     * sem sinal visível, a espera parece travamento. O rótulo também torna
     * auditável, para quem está olhando, QUAL dado foi buscado.
     */
    mostrarFerramenta(nome) {
        if (!this.corpoAtual) return;

        let trilha = this.mensagemAtual.querySelector('.ia-ferramentas');
        if (!trilha) {
            trilha = document.createElement('div');
            trilha.className = 'ia-ferramentas';
            this.mensagemAtual.insertBefore(trilha, this.corpoAtual);
        }

        const chip = document.createElement('span');
        chip.className = 'ia-ferramenta';
        chip.setAttribute('role', 'status');
        chip.textContent = ROTULOS_FERRAMENTA[nome] || 'Consultando o sistema...';
        trilha.appendChild(chip);

        this.rolarParaFim();
    }

    /**
     * Acrescenta um pedaço de texto à resposta em curso.
     *
     * Repintar o Markdown a cada token derruba o quadro em respostas longas
     * (cada repintura reprocessa o texto inteiro), então há um teto de
     * frequência. O último pedaço sempre é aplicado por `finalizarResposta`.
     */
    adicionarDelta(texto) {
        if (!this.corpoAtual) return;
        this.textoAcumulado += texto;

        const t = performance.now();
        if (t - this.ultimaRepintura < INTERVALO_REPINTURA_MS) {
            if (this.repinturaAgendada) return;
            this.repinturaAgendada = setTimeout(() => {
                this.repinturaAgendada = null;
                this._repintar();
            }, INTERVALO_REPINTURA_MS);
            return;
        }
        this._repintar();
    }

    _repintar() {
        if (!this.corpoAtual) return;
        this.ultimaRepintura = performance.now();

        // Perto do fim? Então acompanha a rolagem. Se a pessoa subiu para reler
        // algo, não arrastamos a tela de volta.
        const coladoNoFim = this.container.scrollHeight - this.container.scrollTop
            - this.container.clientHeight < 80;

        this.corpoAtual.innerHTML = renderizarMarkdown(this.textoAcumulado)
            + '<span class="ia-cursor" aria-hidden="true"></span>';

        if (coladoNoFim) this.rolarParaFim();
    }

    /**
     * Fecha a resposta: repintura final, remoção do cursor e barra de ações.
     *
     * @param {Object} opcoes
     * @param {Function} opcoes.aoCopiar
     * @param {Function} opcoes.aoRegenerar
     * @param {Function} [opcoes.aoOuvir]  ausente quando não há voz disponível
     * @returns {string} texto final da resposta
     */
    finalizarResposta({ aoCopiar, aoRegenerar, aoOuvir } = {}) {
        if (this.repinturaAgendada) {
            clearTimeout(this.repinturaAgendada);
            this.repinturaAgendada = null;
        }
        if (!this.corpoAtual) return '';

        const texto = this.textoAcumulado;

        if (!texto.trim()) {
            this.corpoAtual.innerHTML = '<p class="ia-sem-resposta">O assistente não retornou nenhum texto.</p>';
        } else {
            this.corpoAtual.innerHTML = renderizarMarkdown(texto);
            // Só agora, com o texto completo: realçar durante o streaming
            // reprocessaria o bloco a cada token. Não bloqueia a finalização.
            realcarCodigo(this.corpoAtual);
        }

        const acoes = document.createElement('div');
        acoes.className = 'ia-acoes';

        const botao = (rotulo, nomeIcone, aoClicar) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ia-acao';
            b.title = rotulo;
            b.setAttribute('aria-label', rotulo);
            b.appendChild(icone(nomeIcone));
            b.addEventListener('click', () => aoClicar(texto, b));
            return b;
        };

        if (aoCopiar) acoes.appendChild(botao('Copiar resposta', 'copy', aoCopiar));
        if (aoRegenerar) acoes.appendChild(botao('Gerar outra resposta', 'refresh-cw', aoRegenerar));
        if (aoOuvir) acoes.appendChild(botao('Ouvir resposta', 'volume-2', aoOuvir));

        const hora = document.createElement('time');
        hora.className = 'ia-hora';
        hora.textContent = agora();
        acoes.appendChild(hora);

        this.mensagemAtual.appendChild(acoes);
        // Só agora o leitor de tela anuncia — o texto está completo.
        this.mensagemAtual.removeAttribute('aria-busy');

        redesenharIcones();
        this.rolarParaFim();

        this.mensagemAtual = null;
        this.corpoAtual = null;
        return texto;
    }

    /**
     * Mostra um aviso dentro da bolha em curso (ou como bolha própria).
     * Usado para erro do servidor e para cancelamento pelo usuário.
     */
    mostrarAviso(mensagem, { tipo = 'erro' } = {}) {
        if (this.repinturaAgendada) {
            clearTimeout(this.repinturaAgendada);
            this.repinturaAgendada = null;
        }

        const aviso = document.createElement('p');
        aviso.className = 'ia-aviso ia-aviso-' + tipo;
        aviso.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
        aviso.textContent = mensagem;

        if (this.corpoAtual) {
            // Mantém o que já havia chegado antes da falha — jogar fora o texto
            // parcial faz a pessoa perder uma resposta que já estava quase toda lá.
            if (this.textoAcumulado.trim()) {
                this.corpoAtual.innerHTML = renderizarMarkdown(this.textoAcumulado);
            } else {
                this.corpoAtual.innerHTML = '';
            }
            this.corpoAtual.appendChild(aviso);
            this.mensagemAtual.removeAttribute('aria-busy');
            this.mensagemAtual = null;
            this.corpoAtual = null;
        } else {
            this.limparEstadoVazio();
            const item = document.createElement('article');
            item.className = 'ia-msg ia-msg-assistente';
            const bolha = document.createElement('div');
            bolha.className = 'ia-bolha';
            bolha.appendChild(aviso);
            item.appendChild(bolha);
            this.container.appendChild(item);
        }

        this.rolarParaFim();
    }

    /** Remove todas as mensagens e devolve o estado inicial. */
    limpar(htmlEstadoVazio) {
        this.container.innerHTML = htmlEstadoVazio;
        this.mensagemAtual = null;
        this.corpoAtual = null;
        this.textoAcumulado = '';
        redesenharIcones();
    }
}
