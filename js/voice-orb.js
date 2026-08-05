/**
 * voice-orb.js — Gerenciador do componente VoiceOrb
 * Implementa animações orgânicas e estados idle/loading/speaking.
 */

class VoiceOrbManager {
    constructor() {
        this.container = null;
        this.state = 'idle';
        this.mode = 'chat';
        this.voiceName = 'Ember';
    }

    /**
     * Inicializa e renderiza o Orbe em um container específico
     * @param {HTMLElement} parent - Elemento pai onde o orbe será inserido
     * @param {Object} options - Configurações (mode, voiceName, etc)
     */
    init(parent, options = {}) {
        this.destroy(); 

        this.mode = options.mode || 'chat';
        this.voiceName = options.voiceName || 'Ember';

        this.container = document.createElement('div');
        this.container.className = `voice-orb-container ${this.mode} state-idle`;
        
        // Estrutura de Alta Fidelidade (Exatamente como o Mockup)
        this.container.innerHTML = `
            <div class="voice-orb-stage">
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
        }
        return this.container;
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
            const labels = {
                idle: 'pronto',
                loading: 'carregando...',
                thinking: 'pensando...',
                speaking: 'falando...',
                listening: 'entendendo pergunta...',
                error: 'algo deu errado'
            };
            statusLabel.textContent = labels[state] || 'pronto';
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

    destroy() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
        this.container = null;
    }

    simulateBars() {
        if (!this.container || this.state === 'idle') return;
        // As animações agora são via CSS keyframes no modo 'speaking'
        // Mantemos por compatibilidade se necessário, mas o CSS já cuida da pulsação
    }
}

window.VoiceOrbManager = new VoiceOrbManager();
console.info('[VoiceOrb] Manager de alta fidelidade carregado.');
