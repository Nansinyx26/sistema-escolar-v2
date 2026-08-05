/**
 * CommandPalette.js — paleta de comandos rápidos, aberta ao digitar "/".
 *
 * A LISTA VEM DO SERVIDOR
 * -----------------------
 * `GET /api/ia/comandos` devolve só os comandos permitidos ao cargo da sessão.
 * Montar a lista aqui no cliente a tornaria enfeite — um responsável abriria o
 * DevTools e veria `/logs`. Isso não substitui a autorização: cada comando
 * termina numa ferramenta ou numa rota que tem controle próprio.
 *
 * ACESSIBILIDADE
 * --------------
 * A paleta é um `listbox` com `aria-activedescendant`: as setas movem a seleção
 * sem tirar o foco da caixa de texto, que é o que permite continuar filtrando
 * enquanto navega. Enter aplica, Esc fecha.
 */

export class CommandPalette {
    /**
     * @param {Object} elementos  { painel, entrada }
     * @param {Object} opcoes
     * @param {Function} opcoes.aoEscolher  (comando) => void
     */
    constructor({ painel, entrada }, { aoEscolher }) {
        this.painel = painel;
        this.entrada = entrada;
        this.aoEscolher = aoEscolher;

        this.comandos = [];
        this.filtrados = [];
        this.indice = 0;
        this.aberta = false;

        this.painel.addEventListener('mousedown', (e) => this._aoClicar(e));
    }

    get baseApi() {
        return (window.API_BASE_URL || '/api').replace(/\/$/, '');
    }

    /** Carrega uma vez; a lista não muda dentro de uma sessão. */
    async carregar() {
        if (this.comandos.length > 0) return;
        try {
            const res = await fetch(this.baseApi + '/ia/comandos', { credentials: 'include' });
            const json = await res.json();
            this.comandos = json.success ? (json.data || []) : [];
        } catch {
            this.comandos = [];
        }
    }

    /**
     * Reage ao que está sendo digitado.
     * Abre só quando a "/" inicia a mensagem — no meio de uma frase ela é uma
     * barra comum ("2/3 dos alunos"), e abrir ali atrapalharia a digitação.
     */
    async aoDigitar() {
        const texto = this.entrada.value;
        const corresponde = /^\/(\w*)$/.exec(texto);

        if (!corresponde) {
            this.fechar();
            return;
        }

        await this.carregar();
        const termo = corresponde[1].toLowerCase();
        this.filtrados = this.comandos.filter(c =>
            c.nome.startsWith(termo) || c.descricao.toLowerCase().includes(termo)
        );

        if (this.filtrados.length === 0) {
            this.fechar();
            return;
        }

        this.indice = 0;
        this.abrir();
    }

    /**
     * Trata as teclas de navegação.
     * @returns {boolean} true se a tecla foi consumida pela paleta
     */
    aoTeclar(e) {
        if (!this.aberta) return false;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.indice = (this.indice + 1) % this.filtrados.length;
            this.desenhar();
            return true;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.indice = (this.indice - 1 + this.filtrados.length) % this.filtrados.length;
            this.desenhar();
            return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            this._escolher(this.filtrados[this.indice]);
            return true;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            this.fechar();
            return true;
        }
        return false;
    }

    abrir() {
        this.aberta = true;
        this.painel.hidden = false;
        this.entrada.setAttribute('aria-expanded', 'true');
        this.desenhar();
    }

    fechar() {
        if (!this.aberta) return;
        this.aberta = false;
        this.painel.hidden = true;
        this.painel.innerHTML = '';
        this.entrada.setAttribute('aria-expanded', 'false');
        this.entrada.removeAttribute('aria-activedescendant');
    }

    desenhar() {
        this.painel.innerHTML = this.filtrados.map((c, i) => `
            <div class="ia-comando${i === this.indice ? ' ativo' : ''}"
                 id="ia-comando-${i}" role="option" data-i="${i}"
                 aria-selected="${i === this.indice}">
              <span class="ia-comando-nome"></span>
              <span class="ia-comando-desc"></span>
            </div>
        `).join('');

        // Nome e descrição por textContent — vêm do servidor, mas interpolar
        // texto em HTML é o hábito que um dia entra com dado do usuário.
        this.painel.querySelectorAll('.ia-comando').forEach(el => {
            const c = this.filtrados[Number(el.dataset.i)];
            el.querySelector('.ia-comando-nome').textContent = '/' + c.nome;
            el.querySelector('.ia-comando-desc').textContent = c.descricao;
        });

        this.entrada.setAttribute('aria-activedescendant', `ia-comando-${this.indice}`);
        this.painel.querySelector('.ia-comando.ativo')?.scrollIntoView({ block: 'nearest' });
    }

    _aoClicar(e) {
        // `mousedown` e não `click`: o clique tiraria o foco da caixa antes de
        // o handler rodar, fechando a paleta primeiro.
        e.preventDefault();
        const item = e.target.closest('.ia-comando');
        if (!item) return;
        this._escolher(this.filtrados[Number(item.dataset.i)]);
    }

    _escolher(comando) {
        if (!comando) return;
        this.fechar();
        this.entrada.value = '';
        this.aoEscolher(comando);
    }
}
