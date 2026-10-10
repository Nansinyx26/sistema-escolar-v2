/**
 * @jest-environment jsdom
 */

/**
 * ferramentasProfessorFrontend.test.js — Issue #753 (Etapa 5 da #720)
 *
 * A conta do professor mostra cadeado e "Solicitar autorização" nas
 * ferramentas que a direção não liberou, e libera sem recarregar quando ela
 * decide. A regra continua no servidor; aqui se confere só que a tela reflete
 * o que ele responde.
 */

const fs = require('node:fs');
const path = require('node:path');

function respostaJson(corpo, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => corpo,
    };
}

function minhas(lista) {
    return respostaJson({ success: true, data: lista });
}

let F;

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    global.fetch = jest.fn();
    // jsdom não implementa <dialog>.showModal.
    HTMLDialogElement.prototype.showModal = function showModal() {
        this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close() {
        this.removeAttribute('open');
    };
    F = require('../../../js/ferramentas-professor.js');
});

describe('cadeado nos atalhos', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <a id="ia" href="/ia" data-ferramenta="ia.assistente">Assistente</a>
            <a id="pais" href="/pais" data-ferramenta="gestao.autorizacoes-pais">Autorizações</a>`;
    });

    it('tranca o que está bloqueado ou pendente e deixa aberto o autorizado', async () => {
        fetch.mockResolvedValueOnce(
            minhas([
                { id: 'ia.assistente', nome: 'Assistente de IA', status: 'bloqueado' },
                {
                    id: 'gestao.autorizacoes-pais',
                    nome: 'Autorizações dos Pais',
                    status: 'autorizado',
                },
            ])
        );
        await F.carregar();

        const ia = document.getElementById('ia');
        expect(ia.classList.contains('fp-trancada')).toBe(true);
        // aria-disabled não: o system-global.css tira o clique de quem o tem.
        expect(ia.hasAttribute('aria-disabled')).toBe(false);
        expect(ia.getAttribute('aria-haspopup')).toBe('dialog');
        expect(ia.querySelector('.fp-cadeado')).not.toBeNull();

        const pais = document.getElementById('pais');
        expect(pais.classList.contains('fp-trancada')).toBe(false);
        expect(pais.querySelector('.fp-cadeado')).toBeNull();
    });

    it('para quem não é professor (livre) não há cadeado', async () => {
        fetch.mockResolvedValueOnce(
            minhas([{ id: 'ia.assistente', nome: 'Assistente de IA', status: 'livre' }])
        );
        await F.carregar();
        expect(document.querySelector('.fp-trancada')).toBeNull();
    });

    it('sem resposta do servidor nada é trancado (a barreira do backend continua valendo)', async () => {
        fetch.mockRejectedValueOnce(new Error('offline'));
        expect(await F.carregar()).toBe(false);
        expect(document.querySelector('.fp-trancada')).toBeNull();
    });

    it('o clique num atalho trancado abre o aviso em vez de navegar', async () => {
        // `iniciar` agenda a procura pelo socket; relógio falso para não vazar timers.
        jest.useFakeTimers();
        fetch.mockResolvedValue(
            minhas([{ id: 'ia.assistente', nome: 'Assistente de IA', status: 'bloqueado' }])
        );
        await F.iniciar();

        const evento = new MouseEvent('click', { bubbles: true, cancelable: true });
        document.getElementById('ia').dispatchEvent(evento);

        expect(evento.defaultPrevented).toBe(true);
        const dialogo = document.querySelector('dialog.fp-dialogo');
        expect(dialogo.hasAttribute('open')).toBe(true);
        expect(dialogo.textContent).toContain('Assistente de IA');
        expect(dialogo.textContent).toContain(F.TEXTO_BLOQUEIO);
        expect(dialogo.querySelector('.fp-botao').textContent).toContain('Solicitar autorização');
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('a decisão da direção destranca sem recarregar e avisa a página', async () => {
        fetch.mockResolvedValueOnce(
            minhas([{ id: 'ia.assistente', nome: 'Assistente de IA', status: 'pendente' }])
        );
        await F.carregar();
        const ouvinte = jest.fn();
        document.addEventListener('ferramentas:mudou', (e) => ouvinte(e.detail));

        F.definirStatus('ia.assistente', 'autorizado');

        expect(document.getElementById('ia').classList.contains('fp-trancada')).toBe(false);
        expect(ouvinte).toHaveBeenCalledWith({
            ferramentaId: 'ia.assistente',
            status: 'autorizado',
        });
    });

    it('ao reler o status, avisa só o que mudou', async () => {
        fetch.mockResolvedValueOnce(
            minhas([
                { id: 'ia.assistente', nome: 'Assistente de IA', status: 'pendente' },
                {
                    id: 'gestao.autorizacoes-pais',
                    nome: 'Autorizações dos Pais',
                    status: 'bloqueado',
                },
            ])
        );
        await F.carregar();
        const ouvinte = jest.fn();
        document.addEventListener('ferramentas:mudou', (e) => ouvinte(e.detail));

        fetch.mockResolvedValueOnce(
            minhas([
                { id: 'ia.assistente', nome: 'Assistente de IA', status: 'autorizado' },
                {
                    id: 'gestao.autorizacoes-pais',
                    nome: 'Autorizações dos Pais',
                    status: 'bloqueado',
                },
            ])
        );
        await F.carregar();

        expect(ouvinte).toHaveBeenCalledTimes(1);
        expect(ouvinte).toHaveBeenCalledWith({
            ferramentaId: 'ia.assistente',
            status: 'autorizado',
        });
    });
});

describe('Solicitar autorização', () => {
    it('envia o pedido, vira "Aguardando a direção" e não deixa pedir de novo', async () => {
        fetch.mockResolvedValueOnce(
            respostaJson({ success: true, data: { id: 's1', status: 'pendente', nova: true } }, 201)
        );
        const bloco = F.criarBloqueio({ id: 'ia.plano-aula', nome: 'Plano de aula com IA' });
        document.body.appendChild(bloco);
        const botao = bloco.querySelector('.fp-botao');

        botao.click();
        await new Promise((r) => setTimeout(r, 0));

        const [url, opcoes] = fetch.mock.calls[0];
        expect(url).toBe('/api/ferramentas/ia.plano-aula/solicitar');
        expect(opcoes.method).toBe('POST');
        expect(botao.disabled).toBe(true);
        expect(botao.textContent).toContain('Aguardando a direção');
        expect(bloco.querySelector('.fp-texto').textContent).toBe(F.TEXTO_PENDENTE);
        expect(F.status('ia.plano-aula')).toBe('pendente');
    });

    it('com pedido aberto o botão já nasce desabilitado', () => {
        const bloco = F.criarBloqueio(
            { id: 'ia.assistente', nome: 'Assistente de IA' },
            { pendente: true }
        );
        const botao = bloco.querySelector('.fp-botao');
        expect(botao.disabled).toBe(true);
        expect(botao.textContent).toContain('Aguardando a direção');
    });

    it('falha no pedido mostra o motivo e libera o botão', async () => {
        fetch.mockResolvedValueOnce(
            respostaJson({ success: false, error: 'Só professor pede autorização.' }, 403)
        );
        const bloco = F.criarBloqueio({ id: 'ia.assistente', nome: 'Assistente de IA' });
        document.body.appendChild(bloco);
        const botao = bloco.querySelector('.fp-botao');

        botao.click();
        await new Promise((r) => setTimeout(r, 0));

        expect(botao.disabled).toBe(false);
        expect(bloco.querySelector('.fp-erro').textContent).toBe('Só professor pede autorização.');
    });

    it('se a direção já tinha liberado, a ferramenta destranca', async () => {
        fetch.mockResolvedValueOnce(
            respostaJson({ success: false, codigo: 'JA_AUTORIZADO', error: 'Já autorizada.' }, 409)
        );
        expect(await F.solicitar('ia.assistente')).toEqual({ ok: true });
        expect(F.status('ia.assistente')).toBe('autorizado');
    });
});

describe('copiloto: 403 da barreira vira o pedido', () => {
    const { ChatController } = require('../../../js/ia/ChatController.js');

    function contexto() {
        return {
            baseApi: '/api',
            renderer: { mostrarAviso: jest.fn() },
            aoAvisar: jest.fn(),
            _solicitarFerramenta: jest.fn(),
        };
    }

    const BARREIRA = {
        success: false,
        codigo: 'FERRAMENTA_NAO_AUTORIZADA',
        error: 'A ferramenta "Assistente de IA" precisa de autorização da direção.',
        ferramenta: { id: 'ia.assistente', nome: 'Assistente de IA' },
    };

    it('sem pedido aberto, oferece "Solicitar autorização"', () => {
        const ctx = contexto();
        ChatController.prototype._mostrarBloqueioFerramenta.call(ctx, {
            ...BARREIRA,
            solicitacaoPendente: false,
            podeSolicitar: true,
        });
        const [mensagem, { acao }] = ctx.renderer.mostrarAviso.mock.calls[0];
        expect(mensagem).toBe(BARREIRA.error);
        expect(acao.rotulo).toBe('Solicitar autorização');
        acao.aoClicar('botao');
        expect(ctx._solicitarFerramenta).toHaveBeenCalledWith('ia.assistente', 'botao');
    });

    it('com pedido aberto, só avisa que está com a direção', () => {
        const ctx = contexto();
        ChatController.prototype._mostrarBloqueioFerramenta.call(ctx, {
            ...BARREIRA,
            solicitacaoPendente: true,
            podeSolicitar: false,
        });
        const [mensagem, opcoes] = ctx.renderer.mostrarAviso.mock.calls[0];
        expect(mensagem).toContain('já está com ela');
        expect(opcoes.acao).toBeUndefined();
    });

    it('o pedido vai para a rota da ferramenta e o botão vira "Aguardando a direção"', async () => {
        fetch.mockResolvedValueOnce(respostaJson({ success: true, data: { nova: true } }, 201));
        const ctx = contexto();
        const botao = document.createElement('button');
        await ChatController.prototype._solicitarFerramenta.call(ctx, 'ia.assistente', botao);
        expect(fetch.mock.calls[0][0]).toBe('/api/ferramentas/ia.assistente/solicitar');
        expect(botao.disabled).toBe(true);
        expect(botao.textContent).toBe('Aguardando a direção');
        expect(ctx.aoAvisar).toHaveBeenCalledWith(expect.stringContaining('Pedido enviado'));
    });
});

describe('chatbot flutuante', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../../js/chatbot-ia.js'), 'utf8');

    it('o botão do chatbot é um atalho controlado pelo Assistente de IA', () => {
        expect(src).toMatch(/id="chatbot-fab"[^>]*data-ferramenta="ia\.assistente"/);
    });

    it('o 403 da barreira mostra o bloqueio com o pedido, e não só o texto', () => {
        expect(src).toContain("corpo?.codigo === 'FERRAMENTA_NAO_AUTORIZADA'");
        expect(src).toContain(
            'window.FerramentasProfessor.criarBloqueio(ferramenta, { pendente })'
        );
    });
});
