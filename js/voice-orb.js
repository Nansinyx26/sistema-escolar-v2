/**
 * voice-orb.js — Gerenciador do componente VoiceOrb.
 *
 * O orb do chatbot que aparece em TODOS os painéis (direção, professor,
 * secretaria) durante a narração e o processamento da resposta.
 *
 * ─── O que mudou e por quê ──────────────────────────────────────────────────
 * O miolo do orb era um equalizador de cinco barras em CSS: cinco `<div>` com
 * `@keyframes` de altura fixa e atrasos escalonados. O problema não era o
 * visual — era o vínculo. As barras tocavam a mesma coreografia de 0.8s
 * independentemente do que a voz estivesse dizendo, então quem ouvia via uma
 * animação que nunca batia com o áudio. Um loop decorativo em cima da fala.
 *
 * Agora o miolo é a mesma `AssistantSphere` da página do assistente,
 * alimentada pelo espectro real do áudio do ElevenLabs (`NivelDeVoz`). A
 * esfera se move porque a voz está ali; quando ela para, a esfera assenta.
 *
 * O orb em CSS continua no documento inteiro, embaixo do canvas: é o fallback
 * de quem não tem Canvas 2D, de quem bloqueia módulos, e de qualquer falha no
 * laço de render. A classe `.esfera-ativa` é a única coisa que decide quem
 * aparece — nunca removemos o fallback do DOM.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Caminhos ABSOLUTOS: este arquivo é carregado de `/html/dashboard.html`,
 * `/html/direcao/index.html` e `/html/secretaria/*.html`, em profundidades
 * diferentes. Um caminho relativo resolveria para três lugares distintos e
 * quebraria em dois deles.
 */
const MODULO_ESFERA = '/js/ia/AssistantSphere.js';
const MODULO_MEDIDOR = '/js/ia/NivelDeVoz.js';

/**
 * Enquadramento da esfera dentro do orb.
 *
 * `compacto` derruba as duas órbitas externas e `escalaRaio` usa a folga que
 * elas deixaram. Num quadrado de ~200px as quatro órbitas ficam a poucos
 * pixels uma da outra e lêem como borrão; com duas, cada uma é uma órbita, e
 * a esfera cabe 40% maior — que é o tamanho em que a água aparece.
 */
const ENQUADRAMENTO = { compacto: true, escalaRaio: 1.4 };

/** Estados do orb → estados da esfera. */
const ESTADO_ESFERA = {
    idle: 'ocioso',
    loading: 'pensando',
    thinking: 'pensando',
    speaking: 'falando',
    listening: 'ouvindo',
    error: 'erro',
};

const ROTULOS = {
    idle: 'pronto',
    loading: 'carregando...',
    thinking: 'pensando...',
    speaking: 'falando...',
    listening: 'entendendo pergunta...',
    error: 'algo deu errado',
};

/**
 * Duração da saída, em ms. Metade da entrada da esfera (420ms) de propósito:
 * a saída não disputa atenção — quem está lendo a resposta já saiu do orb.
 * Tem de bater com a transição de `.is-leaving` em `css/voice-orb.css`.
 */
const MS_SAIDA = 220;

class VoiceOrbManager {
    constructor() {
        this.container = null;
        this.state = 'idle';
        this.mode = 'chat';
        this.voiceName = 'Ember';

        /** @type {import('./ia/AssistantSphere.js').AssistantSphere|null} */
        this.esfera = null;
        this.medidor = null;
        this.canvas = null;
        /** Timer da saída suave, e a função que ela vai executar no fim. */
        this.timerSaida = 0;
        /** @type {(() => void)|null} */
        this.encerrarSaida = null;

        // O analisador de áudio é do GERENCIADOR, não da esfera: ele sobrevive
        // a montar e desmontar o orb. Recriar um AudioContext por narração
        // esbarra no limite de contextos do Chrome (~6) e, a partir daí, a
        // narração inteira emudece.
        this.aoIniciarTts = () => this.medidor?.observar(window.currentTtsAudio);
        this.aoTerminarTts = () => this.medidor?.soltar();
        window.addEventListener('tts:started', this.aoIniciarTts);
        window.addEventListener('tts:ended', this.aoTerminarTts);

        // O AudioContext nasce suspenso e só um gesto do usuário o libera.
        // Sem isto a PRIMEIRA narração da sessão cai no envelope sintético.
        const destravar = () => this.medidor?.desbloquear();
        document.addEventListener('pointerdown', destravar, { once: true, passive: true });
        document.addEventListener('keydown', destravar, { once: true });
    }

    /**
     * Inicializa e renderiza o Orbe em um container específico
     * @param {HTMLElement} parent - Elemento pai onde o orbe será inserido
     * @param {Object} options - Configurações (mode, voiceName, etc)
     */
    init(parent, options = {}) {
        // Imediato: o novo container entra no mesmo tique. Com a saída suave
        // os dois coexistiriam por 220ms e o usuário veria dois orbs.
        this.destroy({ imediato: true });

        this.mode = options.mode || 'chat';
        this.voiceName = options.voiceName || 'Ember';
        // O estado acompanha a classe que vamos escrever. Sem isto ele ficava
        // com o valor do orb ANTERIOR, e a esfera nova — que lê `this.state`
        // quando o módulo termina de carregar — nascia no estado errado.
        this.state = 'idle';

        this.container = document.createElement('div');
        this.container.className = `voice-orb-container ${this.mode} state-idle`;

        // A esfera é `aria-hidden`: quem lê por leitor de tela recebe o estado
        // pela pill, em texto. Um canvas anunciado não acrescenta nada.
        this.container.innerHTML = `
            <div class="voice-orb-stage">
                <canvas class="voice-orb-canvas" aria-hidden="true"></canvas>

                <div class="voice-orb-rings">
                    <div class="orb-ring ring-1"></div>
                    <div class="orb-ring ring-2"></div>
                    <div class="orb-ring ring-3"></div>
                </div>

                <div class="voice-orb-wrapper">
                    <div class="voice-orb-core">
                        <div class="voice-orb-glass"></div>
                        <div class="voice-orb-bars">
                            <div class="orb-bar"></div>
                            <div class="orb-bar"></div>
                            <div class="orb-bar"></div>
                            <div class="orb-bar"></div>
                            <div class="orb-bar"></div>
                        </div>
                    </div>
                </div>

                <div class="voice-orb-pill">
                    <div class="pill-icon">
                        <div class="bar-mini"></div>
                        <div class="bar-mini"></div>
                        <div class="bar-mini"></div>
                    </div>
                    <span class="pill-text"><strong>${this.voiceName}</strong> · <span class="status-label">pronto</span></span>
                    <div class="user-mic-bar" style="display:none; margin-left:10px; gap:2px; align-items:center;">
                        <div class="mic-segment"></div>
                        <div class="mic-segment"></div>
                        <div class="mic-segment"></div>
                        <div class="mic-segment"></div>
                        <div class="mic-segment"></div>
                    </div>
                </div>
            </div>
        `;

        parent.appendChild(this.container);
        this.canvas = this.container.querySelector('.voice-orb-canvas');
        this._montarEsfera();

        if (this.mode === 'fab') {
            this.container.addEventListener('click', () => {
                if (window.chatbotIA && window.chatbotIA.openChat) {
                    window.chatbotIA.openChat();
                } else {
                    const dashboardLink = window.location.pathname.includes('direcao') ? '/html/direcao/index.html' : '/html/dashboard.html';
                    window.location.href = `${dashboardLink}#chat`;
                }
            });
        }
    }

    /**
     * Garante que o orbe está montado no container informado, SEM recriar
     * o DOM se já estiver lá. Recriar a cada interação reiniciava todas as
     * animações CSS (rings, entrada, glow) — o bug visual do "flicker".
     * Use este método em vez de init() em handlers repetitivos.
     */
    ensureMounted(parent, options = {}) {
        const jaMontado = this.container
            && this.container.parentNode === parent
            && this.mode === (options.mode || this.mode);
        if (!jaMontado) {
            this.init(parent, options);
            return this.container;
        }
        // Um orb anterior pode ainda estar saindo neste palco: tira-o do
        // caminho agora, para os dois não se sobreporem por 220ms.
        this._concluirSaida();
        return this.container;
    }

    /**
     * Sobe a esfera em canvas por cima do orb em CSS.
     *
     * Assíncrono e silencioso: `import()` dinâmico não pode atrasar a
     * montagem do orb nem derrubar a página se falhar. Enquanto o módulo não
     * chega — e para sempre, se ele não chegar — o que se vê é o orb em CSS.
     */
    async _montarEsfera() {
        const canvas = this.canvas;
        if (!canvas || typeof canvas.getContext !== 'function') return;

        let AssistantSphere;
        let criarMedidorDeVoz;
        try {
            [{ AssistantSphere }, { criarMedidorDeVoz }] = await Promise.all([
                import(MODULO_ESFERA),
                import(MODULO_MEDIDOR),
            ]);
        } catch (e) {
            console.warn('[VoiceOrb] Esfera indisponível; seguindo com o orb em CSS.', e);
            return;
        }

        // O await abriu uma janela: o orb pode ter sido desmontado, ou
        // remontado noutro lugar, enquanto o módulo carregava. Montar a esfera
        // num canvas órfão deixaria um rAF girando para ninguém.
        if (this.canvas !== canvas || !canvas.isConnected) return;

        // A classe entra ANTES de construir: é ela que dá ao palco o tamanho
        // final. Medir o canvas antes disso o dimensionaria pelo tamanho
        // errado, e num navegador sem ResizeObserver ele ficaria assim.
        this.container.classList.add('esfera-ativa');

        try {
            this.medidor = this.medidor || criarMedidorDeVoz();
            this.esfera = new AssistantSphere(canvas, {
                ...ENQUADRAMENTO,
                medidor: this.medidor,
                aoFalhar: () => this._reverterParaCss(),
            });
        } catch (e) {
            console.warn('[VoiceOrb] Esfera não subiu; seguindo com o orb em CSS.', e);
            this._reverterParaCss();
            return;
        }

        // Estado atual já pode não ser mais 'idle': a esfera nasce em repouso e
        // precisa alcançar o que o chat já pediu enquanto o módulo carregava.
        this.esfera.definirEstado(ESTADO_ESFERA[this.state] || 'ocioso');

        // Uma narração já em curso quando o orb montou: liga o analisador nela
        // em vez de esperar o próximo `tts:started`, que talvez nunca venha.
        if (window.currentTtsAudio && !window.currentTtsAudio.paused) {
            this.medidor.observar(window.currentTtsAudio);
        }
    }

    /** Devolve o palco ao orb em CSS. Idempotente. */
    _reverterParaCss() {
        this.container?.classList.remove('esfera-ativa');
        this.esfera?.destruir();
        this.esfera = null;
    }

    /**
     * Altera o estado visual do Orbe
     * @param {string} state - 'idle' | 'loading' | 'thinking' | 'speaking' | 'listening' | 'error'
     */
    setState(state) {
        if (!this.container) return;
        this.state = state;

        this.container.classList.remove(
            'state-idle', 'state-loading', 'state-thinking',
            'state-speaking', 'state-listening', 'state-error'
        );
        this.container.classList.add(`state-${state}`);
        this.esfera?.definirEstado(ESTADO_ESFERA[state] || 'ocioso');

        const micBar = this.container.querySelector('.user-mic-bar');
        const pillIcon = this.container.querySelector('.pill-icon');

        if (state === 'listening') {
            if (micBar) micBar.style.display = 'flex';
            if (pillIcon) pillIcon.style.display = 'none';
        } else {
            if (micBar) micBar.style.display = 'none';
            if (pillIcon) pillIcon.style.display = 'flex';
        }

        const statusLabel = this.container.querySelector('.status-label');
        if (statusLabel) {
            statusLabel.textContent = ROTULOS[state] || 'pronto';
        }
    }

    /**
     * Atualiza o texto de transcrição em tempo real (opcional)
     * @param {string} text
     */
    setTranscription(text) {
        if (!this.container) return;
        const statusLabel = this.container.querySelector('.status-label');
        if (statusLabel && text) {
            statusLabel.textContent = text;
        }
    }

    /**
     * Conclui AGORA uma saída que ainda esteja correndo.
     *
     * Note que ela conclui em vez de cancelar. Quando este método é chamado,
     * `this.container` já é outro elemento (ou nenhum) — `destroy` solta a
     * referência no instante em que a saída começa. Uma versão que apenas
     * limpasse o timer deixaria o elemento anterior parado no DOM para
     * sempre, invisível e sem dono: o timer que o removeria não existe mais e
     * ninguém mais tem o ponteiro para ele.
     */
    _concluirSaida() {
        if (!this.timerSaida) return;
        clearTimeout(this.timerSaida);
        this.timerSaida = 0;
        const encerrar = this.encerrarSaida;
        this.encerrarSaida = null;
        encerrar?.();
    }

    /**
     * Remove o orb. Por padrão ele SAI — some em 220ms em vez de piscar para
     * fora do documento. Um corte seco chama mais atenção do que a saída, que
     * é o contrário do que uma saída deveria fazer.
     *
     * @param {{ imediato?: boolean }} [opcoes] `imediato` remove no mesmo tique;
     *   use quando outro orb vai ocupar o lugar agora.
     */
    destroy(opcoes = {}) {
        this._concluirSaida();
        const container = this.container;
        if (!container) return;

        // Tudo o que vai morrer é capturado AGORA. Durante os 220ms da saída
        // um `init()` pode montar outro orb; se `encerrar` fosse ler
        // `this.esfera` no fim do timer, destruiria a esfera do orb novo.
        const esfera = this.esfera;
        this.esfera = null;
        this.container = null;
        this.canvas = null;

        const encerrar = () => {
            this.timerSaida = 0;
            this.encerrarSaida = null;
            esfera?.destruir();
            // O medidor é compartilhado e sobrevive ao orb. Só soltamos o áudio
            // se ninguém tiver montado outro orb nesse meio-tempo — senão a
            // narração em curso perderia o analisador no meio da frase.
            if (!this.container) this.medidor?.soltar();
            container.parentNode?.removeChild(container);
        };

        // `matchMedia` pode não existir (jsdom, navegadores antigos): sem ele
        // assumimos que o usuário não pediu redução, que é o padrão da web.
        const semMovimento = window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (opcoes.imediato || semMovimento) {
            encerrar();
            return;
        }

        container.classList.add('is-leaving');
        // Guardado para que `_concluirSaida` possa executá-lo antes da hora.
        this.encerrarSaida = encerrar;
        this.timerSaida = setTimeout(encerrar, MS_SAIDA);
    }
}

window.VoiceOrbManager = new VoiceOrbManager();
console.info('[VoiceOrb] Manager de alta fidelidade carregado.');
