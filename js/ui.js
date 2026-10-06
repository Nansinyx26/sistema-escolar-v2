/**
 * Módulo de Interface do Usuário
 * Gerencia componentes visuais, modais e notificações
 */

/**
 * Mensagem como TEXTO (Issue #656).
 *
 * Toast, título de modal, botões e as mensagens de `confirm`, `alert` e
 * `prompt` iam crus para o innerHTML, e os chamadores passam `error.message`
 * vindo do servidor. Nenhum chamador passa marcação de propósito
 * (levantamento na #656), então o padrão é texto. A exceção é o `content` do
 * `showModal`: é o corpo do modal (formulários), HTML por contrato — quem monta
 * escapa o que for dado, como já faz js/app.js.
 *
 * Regra do #650 (textoHtml): escapa < > aspas e crase, mas NÃO o `&`, que o
 * servidor já grava codificado — o textContent mostraria "&amp;" nesses textos
 * e no que o chamador já escapou. Sem `<` literal, nenhum elemento nasce.
 */
function textoDaMensagem(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(
        /["'<>`]/g,
        (c) => ({ '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;', '`': '&#96;' })[c]
    );
}

class UIManager {
    constructor() {
        this.modals = new Map();
        this.toastContainer = null;
    }

    /**
     * Inicializa o gerenciador de UI
     */
    init() {
        this.createToastContainer();
        this.setupModalListeners();
    }

    /**
     * Cria container para toasts/notificações
     */
    createToastContainer() {
        // Tenta encontrar por qualquer um dos IDs comuns
        this.toastContainer =
            document.getElementById('toast-container') || document.getElementById('toastContainer');

        if (!this.toastContainer) {
            this.toastContainer = document.createElement('div');
            this.toastContainer.id = 'toast-container';
            this.toastContainer.className = 'toast-container';
            document.body.appendChild(this.toastContainer);
        }
    }

    /**
     * Exibe mensagem de toast
     * @param {string} message - Mensagem a exibir
     * @param {string} type - Tipo: success, error, warning, info
     * @param {number} duration - Duração em ms
     * @param {{html?: boolean}} [opcoes] - `html: true` aceita marcação (o
     *        chamador escapa o que for dado); sem isso a mensagem é texto
     */
    showToast(message, type = 'info', duration = 3000, opcoes = {}) {
        // Se por algum motivo o container for nulo, tenta inicializar de novo
        if (!this.toastContainer) {
            this.createToastContainer();
        }

        // Se ainda for nulo (caso extremo), usa o console
        if (!this.toastContainer) {
            console.log(`[${type}] ${message}`);
            return;
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icons = {
            success: '✓',
            error: '✕',
            warning: '⚠',
            info: 'ℹ',
        };

        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || icons.info}</span>
            <span class="toast-message">${opcoes?.html ? message : textoDaMensagem(message)}</span>
        `;

        this.toastContainer.appendChild(toast);

        // Animação de entrada
        setTimeout(() => toast.classList.add('show'), 10);

        // Remove após duração
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    /**
     * Atalhos para tipos de toast
     */
    success(message, duration, opcoes) {
        this.showToast(message, 'success', duration, opcoes);
    }

    error(message, duration, opcoes) {
        this.showToast(message, 'error', duration, opcoes);
    }

    warning(message, duration, opcoes) {
        this.showToast(message, 'warning', duration, opcoes);
    }

    info(message, duration, opcoes) {
        this.showToast(message, 'info', duration, opcoes);
    }

    /**
     * Cria e exibe um modal
     * @param {Object} options - Opções do modal. `title` e o `text` dos botões
     *        são TEXTO; `content` é HTML (o corpo do modal) e quem chama escapa
     *        o que for dado.
     */
    showModal(options) {
        const {
            id = 'modal-' + Date.now(),
            title = '',
            content = '',
            size = 'medium',
            closable = true,
            onClose = null,
            buttons = [],
        } = options;

        // Remove modal existente com mesmo ID
        this.closeModal(id);

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = id;

        const sizeClass =
            {
                small: 'modal-sm',
                medium: 'modal-md',
                large: 'modal-lg',
                fullscreen: 'modal-fs',
            }[size] || 'modal-md';

        modal.innerHTML = `
            <div class="modal ${sizeClass}">
                <div class="modal-header">
                    <h3 class="modal-title">${textoDaMensagem(title)}</h3>
                    ${closable ? '<button class="modal-close" data-close="true">&times;</button>' : ''}
                </div>
                <div class="modal-body">
                    ${content}
                </div>
                ${
                    buttons.length > 0
                        ? `
                    <div class="modal-footer">
                        ${buttons
                            .map(
                                (btn) => `
                            <button class="btn ${btn.class || 'btn-secondary'}" data-action="${btn.action || ''}">
                                ${textoDaMensagem(btn.text)}
                            </button>
                        `
                            )
                            .join('')}
                    </div>
                `
                        : ''
                }
            </div>
        `;

        document.body.appendChild(modal);

        // Salva referência
        this.modals.set(id, { modal, onClose, buttons });

        // Event listeners
        if (closable) {
            modal.querySelector('.modal-close')?.addEventListener('click', () => {
                this.closeModal(id);
            });

            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    this.closeModal(id);
                }
            });
        }

        // Botões de ação
        buttons.forEach((btn) => {
            if (btn.onClick) {
                modal
                    .querySelector(`[data-action="${btn.action}"]`)
                    ?.addEventListener('click', () => {
                        btn.onClick(modal);
                    });
            }
        });

        // Animação de entrada
        setTimeout(() => modal.classList.add('show'), 10);

        return modal;
    }

    /**
     * Fecha um modal
     * @param {string} id - ID do modal
     */
    closeModal(id) {
        const modalData = this.modals.get(id);
        if (modalData) {
            const { modal, onClose } = modalData;
            modal.classList.remove('show');

            setTimeout(() => {
                modal.remove();

                // Only delete from map if it's still the same modal instance
                // preventing race condition when reopening modal with same ID immediately
                const currentData = this.modals.get(id);
                if (currentData && currentData.modal === modal) {
                    this.modals.delete(id);
                }

                if (onClose) onClose();
            }, 300);
        }
    }

    /**
     * Fecha todos os modais
     */
    closeAllModals() {
        this.modals.forEach((_, id) => {
            this.closeModal(id);
        });
    }

    /**
     * Modal de confirmação
     * @param {string} message - Mensagem de confirmação (TEXTO; `options.html`
     *        aceita marcação, e o chamador escapa o que for dado)
     * @param {Object} options - Opções adicionais
     * @returns {Promise<boolean>}
     */
    confirm(message, options = {}) {
        return new Promise((resolve) => {
            const {
                title = 'Confirmação',
                confirmText = 'Confirmar',
                cancelText = 'Cancelar',
                confirmClass = 'btn-primary',
                cancelClass = 'btn-secondary',
                html = false,
            } = options;

            this.showModal({
                id: 'confirm-modal',
                title,
                content: `<p>${html ? message : textoDaMensagem(message)}</p>`,
                size: 'small',
                closable: true,
                onClose: () => resolve(false),
                buttons: [
                    {
                        text: cancelText,
                        class: cancelClass,
                        action: 'cancel',
                        onClick: () => {
                            this.closeModal('confirm-modal');
                            resolve(false);
                        },
                    },
                    {
                        text: confirmText,
                        class: confirmClass,
                        action: 'confirm',
                        onClick: () => {
                            this.closeModal('confirm-modal');
                            resolve(true);
                        },
                    },
                ],
            });
        });
    }

    /**
     * Modal de alerta
     * @param {string} message - Mensagem (texto)
     * @param {string} title - Título (texto)
     */
    alert(message, title = 'Aviso') {
        return new Promise((resolve) => {
            this.showModal({
                id: 'alert-modal',
                title,
                content: `<p>${textoDaMensagem(message)}</p>`,
                size: 'small',
                closable: true,
                onClose: () => resolve(),
                buttons: [
                    {
                        text: 'OK',
                        class: 'btn-primary',
                        action: 'ok',
                        onClick: () => {
                            this.closeModal('alert-modal');
                            resolve();
                        },
                    },
                ],
            });
        });
    }

    /**
     * Modal de prompt
     * @param {string} message - Mensagem (texto)
     * @param {string} defaultValue - Valor padrão
     * @param {string} title - Título (texto)
     * @returns {Promise<string|null>}
     */
    prompt(message, defaultValue = '', title = 'Entrada') {
        return new Promise((resolve) => {
            const inputId = 'prompt-input-' + Date.now();

            this.showModal({
                id: 'prompt-modal',
                title,
                content: `
                    <p>${textoDaMensagem(message)}</p>
                    <input type="text" id="${inputId}" class="form-input" value="${textoDaMensagem(defaultValue)}">
                `,
                size: 'small',
                closable: true,
                onClose: () => resolve(null),
                buttons: [
                    {
                        text: 'Cancelar',
                        class: 'btn-secondary',
                        action: 'cancel',
                        onClick: () => {
                            this.closeModal('prompt-modal');
                            resolve(null);
                        },
                    },
                    {
                        text: 'OK',
                        class: 'btn-primary',
                        action: 'ok',
                        onClick: () => {
                            const value = document.getElementById(inputId)?.value || '';
                            this.closeModal('prompt-modal');
                            resolve(value);
                        },
                    },
                ],
            });

            // Foca no input
            setTimeout(() => {
                document.getElementById(inputId)?.focus();
            }, 100);
        });
    }

    /**
     * Exibe indicador de carregamento
     * @param {boolean} show - Mostrar ou ocultar
     * @param {string} message - Mensagem de carregamento
     */
    loading(show = true, message = 'Carregando...') {
        const loadingId = 'loading-overlay';
        const existing = document.getElementById(loadingId);

        if (show) {
            if (!existing) {
                // Cria o modal se não existir
                const loading = document.createElement('div');
                loading.id = loadingId;
                loading.className = 'loading-overlay';
                loading.innerHTML = `
                    <div class="loading-spinner">
                        <div class="spinner-container" style="display:flex; align-items:center; gap:20px;">
                            <div class="spinner"></div>
                            <div class="timer-lateral" id="timer-lateral" style="font-family: monospace; font-size: 1.5rem; color: var(--primary); font-weight: bold; background: rgba(0,0,0,0.3); padding: 5px 10px; border-radius: 8px; border: 1px solid var(--primary); min-width: 60px; text-align: center;">00s</div>
                        </div>
                        <p id="loading-text" style="margin-top: 20px; color: #ffffff; font-size: 1.4rem; font-weight: 600; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">${textoDaMensagem(message)}</p>
                    </div>
                `;
                document.body.appendChild(loading);
                setTimeout(() => loading.classList.add('show'), 10);

                // Inicia o cronômetro lateral
                let segundos = 0;
                this.counterInterval = setInterval(() => {
                    segundos++;
                    const timerEl = document.getElementById('timer-lateral');
                    if (timerEl) {
                        timerEl.textContent = `${segundos.toString().padStart(2, '0')}s`;
                    }
                }, 1000);

                // Se demorar mais de 5 segundos, muda a mensagem principal e mostra a imagem
                this.loadingTimer = setTimeout(() => {
                    const textEl = document.getElementById('loading-text');
                    const spinnerContainer = document.querySelector('.spinner-container');

                    if (textEl) {
                        textEl.style.fontSize = '1.2rem'; // Ajuste leve para acomodar o texto longo
                        textEl.innerHTML = `Aguarde, estamos acordando o servidor...<br><small style="opacity:0.9; font-size:0.9rem; font-weight: 400;">(Isso pode levar até 30s no primeiro acesso)</small>`;
                    }

                    if (spinnerContainer && !document.getElementById('wakeup-img')) {
                        const img = document.createElement('img');
                        img.id = 'wakeup-img';
                        img.src = '/img/gif/gif.webp';
                        img.style.cssText =
                            'max-width: 280px; margin-bottom: 20px; border-radius: 15px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); animation: fadeIn 0.5s ease-out; display: block; margin-left: auto; margin-right: auto;';

                        // Insere a imagem ANTES do container do spinner
                        spinnerContainer.parentElement.insertBefore(img, spinnerContainer);
                    }
                }, 5000);
            } else {
                // Apenas atualiza a mensagem se já estiver mostrando
                const textEl = document.getElementById('loading-text');
                if (textEl && !document.getElementById('wakeup-img')) {
                    textEl.textContent = message;
                }
            }
        } else {
            // Limpa timers quando for fechar o loading
            if (this.loadingTimer) clearTimeout(this.loadingTimer);
            if (this.counterInterval) clearInterval(this.counterInterval);

            this.loadingTimer = null;
            this.counterInterval = null;

            if (existing) {
                existing.classList.remove('show');
                setTimeout(() => existing.remove(), 300);
            }
        }
    }

    /**
     * Configura listeners globais para modais
     */
    setupModalListeners() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const lastModal = Array.from(this.modals.keys()).pop();
                if (lastModal) {
                    this.closeModal(lastModal);
                }
            }
        });
    }

    /**
     * Formata data para exibição
     * @param {string} dateString - Data em formato ISO
     * @returns {string}
     */
    formatDate(dateString) {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('pt-BR');
    }

    /**
     * Formata número como nota
     * @param {number} nota - Valor da nota
     * @returns {string}
     */
    formatNota(nota) {
        if (nota === null || nota === undefined) return '-';
        return nota.toFixed(1).replace('.', ',');
    }

    /**
     * Retorna classe CSS baseada na nota
     * @param {number} nota - Valor da nota
     * @returns {string}
     */
    getNotaClass(nota) {
        if (nota >= 7) return 'nota-alta';
        if (nota >= 5) return 'nota-media';
        return 'nota-baixa';
    }
}

// Exporta instância única
const ui = new UIManager();
export default ui;
