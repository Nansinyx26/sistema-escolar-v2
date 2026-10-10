/**
 * @jest-environment jsdom
 */

/**
 * planosIaFrontend.test.js — Issue #761
 *
 * Tela de Plano de aula e Plano de estudo com IA. O HTML vem do modelo, então
 * a barreira que mais importa aqui é o sanitizador; o resto confere que a tela
 * fala com as rotas certas e tranca a aba quando a direção não liberou.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const HTML = fs.readFileSync(path.join(RAIZ, 'html/planos-ia.html'), 'utf8');
const CORPO = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('<!-- api-config.js'));

function resposta(corpo, status = 200) {
    return { ok: status < 400, status, json: async () => corpo };
}

const esperar = () => new Promise((r) => setTimeout(r, 0));

let PlanosIA;

beforeAll(() => {
    // O mesmo DOMPurify da página (js/libs/purify.min.js), em pacote de teste.
    const createDOMPurify = require('dompurify');
    window.DOMPurify = createDOMPurify(window);
});

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = CORPO;
    global.fetch = jest.fn();
    window.FerramentasProfessor = undefined;
    Element.prototype.scrollIntoView = jest.fn();
    PlanosIA = require('../../../js/planos-ia.js');
});

describe('sanitizarPlano', () => {
    it('mantém a estrutura que o prompt pede', () => {
        const html = PlanosIA.sanitizarPlano(
            '<h3>Objetivos</h3><ul><li><strong>Ler</strong> frações</li></ul><p>Fim</p>'
        );
        expect(html).toBe(
            '<h3>Objetivos</h3><ul><li><strong>Ler</strong> frações</li></ul><p>Fim</p>'
        );
    });

    it.each([
        '<script>alert(1)</script><p>x</p>',
        '<img src=x onerror="alert(1)">',
        '<p onclick="roubar()">clique</p>',
        '<a href="javascript:alert(1)">link</a>',
        '<iframe src="https://mal.example"></iframe>',
        '<p style="background:url(javascript:x)">estilo</p>',
        '<svg onload="alert(1)"></svg>',
    ])('neutraliza %s', (entrada) => {
        const html = PlanosIA.sanitizarPlano(entrada);
        expect(html).not.toMatch(
            /<script|onerror|onclick|onload|javascript:|<iframe|<img|<a |style=|<svg/i
        );
    });

    it('sem DOMPurify, cai para texto puro', () => {
        const html = PlanosIA.sanitizarPlano('<p onclick="x()">oi</p><script>y()</script>', {
            sanitize: undefined,
        });
        expect(html).not.toContain('<');
        expect(html).toContain('oi');
    });
});

describe('plano de aula', () => {
    it('envia os campos à rota e mostra o plano já sanitizado', async () => {
        PlanosIA.iniciar();
        fetch.mockResolvedValueOnce(
            resposta({
                success: true,
                data: { planoHtml: '<h3>Plano</h3><p>Aula</p><script>alert(1)</script>' },
            })
        );
        const form = document.getElementById('formAula');
        form.elements.materia.value = 'Matemática';
        form.elements.ano.value = '6º ano';
        form.elements.tema.value = 'Frações';
        form.requestSubmit();
        await esperar();
        await esperar();

        const [url, opcoes] = fetch.mock.calls[0];
        expect(url).toBe('/api/ia/plano-aula');
        expect(JSON.parse(opcoes.body)).toEqual({
            materia: 'Matemática',
            ano: '6º ano',
            tema: 'Frações',
        });
        const plano = document.getElementById('plano');
        expect(plano.innerHTML).toBe('<h3>Plano</h3><p>Aula</p>');
        expect(document.getElementById('resultado').hidden).toBe(false);
        expect(document.getElementById('avisoOffline').hidden).toBe(true);
    });

    it('sem os campos obrigatórios, não chama a IA', () => {
        PlanosIA.iniciar();
        document.getElementById('formAula').requestSubmit();
        expect(fetch).not.toHaveBeenCalled();
        expect(document.querySelector('#formAula .pi-erro').textContent).toMatch(/Preencha/);
    });

    it('modo offline aparece sinalizado', async () => {
        PlanosIA.iniciar();
        fetch.mockResolvedValueOnce(
            resposta({ success: true, data: { planoHtml: '<p>modelo</p>', modoOffline: true } })
        );
        const form = document.getElementById('formAula');
        form.elements.materia.value = 'História';
        form.elements.ano.value = '7º';
        form.elements.tema.value = 'Brasil Colônia';
        form.requestSubmit();
        await esperar();
        await esperar();
        expect(document.getElementById('avisoOffline').hidden).toBe(false);
    });

    it('403 da barreira tranca a aba com o pedido à direção', async () => {
        const definirStatus = jest.fn();
        window.FerramentasProfessor = {
            iniciar: jest.fn().mockResolvedValue(true),
            trancada: () => false,
            definirStatus,
            criarBloqueio: jest.fn(),
        };
        PlanosIA.iniciar();
        fetch.mockResolvedValueOnce(
            resposta(
                {
                    success: false,
                    codigo: 'FERRAMENTA_NAO_AUTORIZADA',
                    error: 'A ferramenta "Plano de aula com IA" precisa de autorização da direção.',
                    ferramenta: { id: 'ia.plano-aula', nome: 'Plano de aula com IA' },
                    solicitacaoPendente: false,
                    podeSolicitar: true,
                },
                403
            )
        );
        const form = document.getElementById('formAula');
        form.elements.materia.value = 'Ciências';
        form.elements.ano.value = '8º';
        form.elements.tema.value = 'Células';
        form.requestSubmit();
        await esperar();
        await esperar();
        expect(definirStatus).toHaveBeenCalledWith('ia.plano-aula', 'bloqueado');
        expect(document.getElementById('resultado').hidden).toBe(true);
    });
});

describe('cadeado por aba', () => {
    it('ferramenta trancada troca o formulário pelo aviso, só naquela aba', async () => {
        const bloco = document.createElement('div');
        bloco.className = 'fp-bloqueio';
        window.FerramentasProfessor = {
            iniciar: jest.fn().mockResolvedValue(true),
            trancada: (id) => id === 'ia.plano-estudo',
            definirStatus: jest.fn(),
            criarBloqueio: jest.fn(() => bloco),
        };
        PlanosIA.iniciar();
        await esperar();
        expect('trancado' in document.getElementById('painelEstudo').dataset).toBe(true);
        expect(document.querySelector('#painelEstudo .fp-bloqueio')).toBe(bloco);
        expect('trancado' in document.getElementById('painelAula').dataset).toBe(false);
    });
});

describe('plano de estudo', () => {
    it('exige escolher um aluno da lista', () => {
        PlanosIA.iniciar();
        document.getElementById('formEstudo').requestSubmit();
        expect(fetch).not.toHaveBeenCalled();
        expect(document.querySelector('#formEstudo .pi-erro').textContent).toMatch(
            /Escolha um aluno/
        );
    });

    it('busca alunos das turmas do professor e gera o PEI do escolhido', async () => {
        jest.useFakeTimers();
        PlanosIA.iniciar();
        fetch.mockResolvedValueOnce(
            resposta({ success: true, data: [{ id: 'a1', nome: 'Ana <b>Lima</b>', turma: '6A' }] })
        );
        const busca = document.getElementById('buscaAluno');
        busca.value = 'ana';
        busca.dispatchEvent(new Event('input'));
        jest.advanceTimersByTime(300);
        jest.useRealTimers();
        await esperar();
        await esperar();

        expect(fetch.mock.calls[0][0]).toBe('/api/alunos?q=ana&limit=8');
        const opcao = document.querySelector('#listaAlunos [role="option"]');
        // Nome vindo do banco é texto, nunca marcação.
        expect(opcao.querySelector('b')).toBeNull();
        expect(opcao.textContent).toContain('Ana <b>Lima</b>');

        opcao.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        fetch.mockResolvedValueOnce(
            resposta({ success: true, data: { planoHtml: '<h3>PEI</h3>' } })
        );
        document.getElementById('formEstudo').requestSubmit();
        await esperar();
        await esperar();

        const [url, opcoes] = fetch.mock.calls[1];
        expect(url).toBe('/api/ia/plano-estudo');
        expect(JSON.parse(opcoes.body)).toEqual({ alunoId: 'a1' });
        expect(document.getElementById('plano').innerHTML).toBe('<h3>PEI</h3>');
    });
});
