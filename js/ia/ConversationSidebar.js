/**
 * ConversationSidebar.js — lista de conversas anteriores.
 *
 * Só apresentação e chamadas de leitura. Quem decide o que aparece é o
 * servidor: a listagem não aceita parâmetro de usuário nem de escola, então não
 * existe forma de pedir o histórico de outra pessoa a partir daqui.
 */

/** Rótulo relativo — "há 2 h" comunica melhor que uma data completa. */
function quando(iso) {
    const data = new Date(iso);
    if (Number.isNaN(data.getTime())) return '';

    const minutos = Math.floor((Date.now() - data.getTime()) / 60000);
    if (minutos < 1) return 'agora';
    if (minutos < 60) return `há ${minutos} min`;

    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `há ${horas} h`;

    const dias = Math.floor(horas / 24);
    if (dias === 1) return 'ontem';
    if (dias < 7) return `há ${dias} dias`;

    return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

export class ConversationSidebar {
    /**
     * @param {HTMLElement} container  onde a lista é desenhada
     * @param {Object} opcoes
     * @param {Function} opcoes.aoAbrir     (id) => void
     * @param {Function} opcoes.aoApagar    (id) => void
     * @param {Function} [opcoes.aoAvisar]
     */
    constructor(container, { aoAbrir, aoApagar, aoAvisar = () => {} }) {
        this.container = container;
        this.aoAbrir = aoAbrir;
        this.aoApagar = aoApagar;
        this.aoAvisar = aoAvisar;
        this.conversas = [];
        this.idAtiva = null;

        // Delegação: a lista é redesenhada inteira a cada mudança, e religar
        // listener por item a cada repintura vazaria handlers.
        this.container.addEventListener('click', (e) => this._aoClicar(e));
    }

    get baseApi() {
        return (window.API_BASE_URL || '/api').replace(/\/$/, '');
    }

    _csrf() {
        const partes = ('; ' + document.cookie).split('; csrf_token=');
        return partes.length === 2 ? partes.pop().split(';').shift() : '';
    }

    async carregar() {
        try {
            const res = await fetch(this.baseApi + '/ia/conversas', { credentials: 'include' });
            const json = await res.json();
            this.conversas = json.success ? (json.data || []) : [];
        } catch {
            this.conversas = [];
        }
        this.desenhar();
    }

    /**
     * Reflete uma conversa recém-salva sem recarregar a lista do servidor.
     * O título só é conhecido depois da primeira resposta, então este método é
     * chamado ao fim de cada turno.
     */
    registrar({ id, titulo }) {
        if (!id) return;
        this.idAtiva = id;

        const existente = this.conversas.find(c => c.id === id);
        if (existente) {
            existente.titulo = titulo || existente.titulo;
            existente.atualizadoEm = new Date().toISOString();
            // Sobe para o topo: a ordem é por atividade.
            this.conversas = [existente, ...this.conversas.filter(c => c.id !== id)];
        } else {
            this.conversas.unshift({
                id, titulo: titulo || 'Nova conversa',
                atualizadoEm: new Date().toISOString()
            });
        }
        this.desenhar();
    }

    marcarAtiva(id) {
        this.idAtiva = id;
        this.desenhar();
    }

    desenhar() {
        if (this.conversas.length === 0) {
            this.container.innerHTML =
                '<p class="ia-sidebar-vazio">Suas conversas aparecem aqui.</p>';
            return;
        }

        this.container.innerHTML = this.conversas.map(c => `
            <div class="ia-conversa${c.id === this.idAtiva ? ' ativa' : ''}" data-id="${c.id}">
              <button type="button" class="ia-conversa-abrir" data-acao="abrir">
                <span class="ia-conversa-titulo"></span>
                <span class="ia-conversa-quando">${quando(c.atualizadoEm)}</span>
              </button>
              <button type="button" class="ia-conversa-apagar" data-acao="apagar"
                      title="Apagar conversa" aria-label="Apagar conversa">
                <i data-lucide="trash-2" aria-hidden="true"></i>
              </button>
            </div>
        `).join('');

        // O título vem do texto que o usuário digitou: entra por textContent,
        // nunca interpolado no HTML acima.
        this.container.querySelectorAll('.ia-conversa').forEach(el => {
            const c = this.conversas.find(x => x.id === el.dataset.id);
            el.querySelector('.ia-conversa-titulo').textContent = c ? c.titulo : '';
        });

        if (typeof window.renderLucideIcons === 'function') window.renderLucideIcons();
    }

    async _aoClicar(e) {
        const botao = e.target.closest('[data-acao]');
        if (!botao) return;

        const item = botao.closest('.ia-conversa');
        const id = item?.dataset.id;
        if (!id) return;

        if (botao.dataset.acao === 'abrir') {
            this.aoAbrir(id);
            return;
        }

        if (botao.dataset.acao === 'apagar') {
            if (!window.confirm('Apagar esta conversa? Não dá para desfazer.')) return;
            await this.apagar(id);
        }
    }

    async apagar(id) {
        try {
            const res = await fetch(this.baseApi + '/ia/conversas/' + encodeURIComponent(id), {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'X-CSRF-Token': this._csrf() }
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'falha');

            this.conversas = this.conversas.filter(c => c.id !== id);
            this.desenhar();
            this.aoApagar(id);
        } catch {
            this.aoAvisar('Não foi possível apagar a conversa.');
        }
    }

    /** Busca o histórico completo de uma conversa. */
    async obter(id) {
        const res = await fetch(this.baseApi + '/ia/conversas/' + encodeURIComponent(id), {
            credentials: 'include'
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Conversa não encontrada.');
        return json.data;
    }
}
