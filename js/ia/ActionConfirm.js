/**
 * ActionConfirm.js — card de confirmação das ações de escrita.
 *
 * O QUE ESTE CARD PROTEGE
 * -----------------------
 * Nada foi gravado quando ele aparece. Ele é a única etapa em que a pessoa lê,
 * em português, exatamente o que o assistente entendeu — antes de virar uma
 * turma no sistema ou um comunicado na caixa de todo mundo.
 *
 * O token viaja daqui direto para POST /api/ia/confirmar. Os PARÂMETROS não vão
 * junto: o servidor executa a cópia que ele mesmo guardou. Editar um campo aqui
 * não mudaria o que é executado — por isso "Editar" cancela e devolve o texto à
 * caixa de mensagem, em vez de fingir um formulário.
 */

/** Rótulo humano de cada ação. */
const TITULOS = {
    criarTurma: 'Criar turma',
    criarEvento: 'Adicionar ao calendário',
    enviarComunicado: 'Publicar comunicado'
};

/** Campos cujo valor merece destaque no card, por ação. */
const ROTULOS_CAMPO = {
    nome: 'Turma',
    periodo: 'Período',
    ano: 'Ano letivo',
    sala: 'Sala',
    capacidade: 'Capacidade',
    titulo: 'Título',
    tipo: 'Tipo',
    dataInicio: 'Início',
    dataFim: 'Término',
    descricao: 'Descrição',
    conteudo: 'Texto',
    destinatarios: 'Para',
    prioridade: 'Prioridade'
};

const DATAS = new Set(['dataInicio', 'dataFim']);

function formatarValor(chave, valor) {
    if (valor === undefined || valor === null || valor === '') return null;
    if (Array.isArray(valor)) return valor.join(', ');
    if (DATAS.has(chave)) {
        const d = new Date(valor);
        if (!Number.isNaN(d.getTime())) {
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }
    }
    return String(valor);
}

export class ActionConfirm {
    /**
     * @param {Object} opcoes
     * @param {Function} opcoes.aoAvisar
     * @param {Function} opcoes.aoEditar   (textoSugerido) => void
     * @param {Function} [opcoes.aoConcluir] (resultado) => void
     */
    constructor({ aoAvisar = () => {}, aoEditar = () => {}, aoConcluir = () => {} } = {}) {
        this.aoAvisar = aoAvisar;
        this.aoEditar = aoEditar;
        this.aoConcluir = aoConcluir;
    }

    get baseApi() {
        return (window.API_BASE_URL || '/api').replace(/\/$/, '');
    }

    _csrf() {
        const partes = ('; ' + document.cookie).split('; csrf_token=');
        return partes.length === 2 ? partes.pop().split(';').shift() : '';
    }

    /**
     * Desenha o card dentro do container informado.
     * @param {HTMLElement} container
     * @param {Object} acao  evento `confirmacao` do stream
     */
    renderizar(container, acao) {
        const card = document.createElement('div');
        card.className = 'ia-confirmacao';
        card.setAttribute('role', 'group');
        card.setAttribute('aria-label', 'Confirmação de ação');

        const cabecalho = document.createElement('header');
        cabecalho.className = 'ia-confirmacao-cabecalho';
        cabecalho.innerHTML = '<i data-lucide="shield-alert" aria-hidden="true"></i>';

        const titulo = document.createElement('strong');
        titulo.textContent = TITULOS[acao.acao] || 'Confirmar ação';
        cabecalho.appendChild(titulo);
        card.appendChild(cabecalho);

        const resumo = document.createElement('p');
        resumo.className = 'ia-confirmacao-resumo';
        resumo.textContent = acao.resumo;
        card.appendChild(resumo);

        // Detalhes campo a campo — é aqui que a pessoa confere o que vai sair.
        const detalhes = document.createElement('dl');
        detalhes.className = 'ia-confirmacao-dados';
        for (const [chave, valor] of Object.entries(acao.dados || {})) {
            const texto = formatarValor(chave, valor);
            if (texto === null) continue;

            const dt = document.createElement('dt');
            dt.textContent = ROTULOS_CAMPO[chave] || chave;
            const dd = document.createElement('dd');
            dd.textContent = texto; // sempre textContent: o valor veio do modelo
            detalhes.append(dt, dd);
        }
        if (detalhes.childElementCount > 0) card.appendChild(detalhes);

        const acoes = document.createElement('div');
        acoes.className = 'ia-confirmacao-acoes';

        const btnConfirmar = document.createElement('button');
        btnConfirmar.type = 'button';
        btnConfirmar.className = 'ia-btn-confirmar';
        btnConfirmar.textContent = 'Confirmar';

        const btnEditar = document.createElement('button');
        btnEditar.type = 'button';
        btnEditar.className = 'ia-btn-editar';
        btnEditar.textContent = 'Editar';

        const btnCancelar = document.createElement('button');
        btnCancelar.type = 'button';
        btnCancelar.className = 'ia-btn-cancelar';
        btnCancelar.textContent = 'Cancelar';

        acoes.append(btnConfirmar, btnEditar, btnCancelar);
        card.appendChild(acoes);
        container.appendChild(card);

        const encerrar = (mensagem, tipo) => {
            card.innerHTML = '';
            card.className = 'ia-confirmacao ia-confirmacao-' + tipo;
            const p = document.createElement('p');
            p.setAttribute('role', 'status');
            p.textContent = mensagem;
            card.appendChild(p);
        };

        btnConfirmar.addEventListener('click', async () => {
            btnConfirmar.disabled = true;
            btnEditar.disabled = true;
            btnCancelar.disabled = true;
            btnConfirmar.textContent = 'Confirmando...';

            try {
                const res = await fetch(this.baseApi + '/ia/confirmar', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': this._csrf()
                    },
                    // Só o token. Os parâmetros estão no servidor.
                    body: JSON.stringify({ confirmToken: acao.confirmToken })
                });
                const json = await res.json();

                if (!json.success) {
                    encerrar(json.error || 'Não foi possível concluir a ação.', 'erro');
                    return;
                }

                encerrar(json.data?.mensagem || 'Ação concluída.', 'ok');
                this.aoConcluir(json.data);
            } catch {
                encerrar('Falha de conexão. Nada foi alterado.', 'erro');
            }
        });

        btnCancelar.addEventListener('click', async () => {
            encerrar('Ação cancelada. Nada foi alterado.', 'cancelado');
            await this._descartar(acao.confirmToken);
        });

        btnEditar.addEventListener('click', async () => {
            encerrar('Ação cancelada para edição.', 'cancelado');
            await this._descartar(acao.confirmToken);
            // Devolve o pedido à caixa de mensagem para a pessoa reescrever —
            // é o caminho honesto, já que editar campos aqui não teria efeito.
            this.aoEditar(acao.resumo);
        });

        if (typeof window.renderLucideIcons === 'function') window.renderLucideIcons();
    }

    /** Avisa o servidor para descartar o token. Falha aqui é inofensiva: expira em 5 min. */
    async _descartar(confirmToken) {
        try {
            await fetch(this.baseApi + '/ia/cancelar', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': this._csrf()
                },
                body: JSON.stringify({ confirmToken })
            });
        } catch {
            // Sem tratamento: o TTL do servidor cobre este caso.
        }
    }
}
