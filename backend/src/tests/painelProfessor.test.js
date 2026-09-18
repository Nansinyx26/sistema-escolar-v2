/**
 * @jest-environment jsdom
 */

/**
 * painelProfessor.test.js — painel do professor no visual novo (Issue #367)
 *
 * Roda o corpo REAL de `html/dashboard.html` com `js/painel-professor.js` e
 * `js/escola-switcher.js`. Dublê só para `fetch`. Cobra:
 *
 *   1. os cartões mostram o que a API devolve — nada de número inventado;
 *   2. a agenda do dia lista as aulas da grade e marca a próxima;
 *   3. sem aula na grade, a agenda mostra o estado vazio que diz o que fazer;
 *   4. com a API fora, cada bloco mostra "—" e a agenda oferece tentar de novo;
 *   5. o cabeçalho mostra só o NOME da escola ativa, nunca o id.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PAGINA = path.join(RAIZ, 'html', 'dashboard.html');
const PAINEL = path.join(RAIZ, 'js', 'painel-professor.js');
const SWITCHER = path.join(RAIZ, 'js', 'escola-switcher.js');

const ESCOLA_ID = '65f0000000000000000000aa';

function corpoDaPagina() {
    const html = fs.readFileSync(PAGINA, 'utf8');
    const abertura = html.match(/<body[^>]*>/);
    const corpo = html.slice(abertura.index + abertura[0].length, html.indexOf('</body>'));
    return corpo.replace(/<script[\s\S]*?<\/script>/g, '');
}

function ok(data) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data }),
    });
}

function falha() {
    return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
}

async function assentar() {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
}

const PAINEL_COM_AULAS = {
    turmas: ['3A', '4B'],
    proximasAulas: [
        {
            hora: '07:30',
            horarioRange: '07:30 - 08:20',
            materia: 'Aula regular',
            turma: '3A',
            sala: 'Sala 16',
            status: 'Concluída',
        },
        {
            hora: '08:20',
            horarioRange: '08:20 - 09:10',
            materia: 'Inglês (Marcelo)',
            turma: '3A',
            sala: 'Sala 16',
            status: 'Agora',
        },
        {
            hora: '09:30',
            horarioRange: '09:30 - 10:20',
            materia: 'Aula regular',
            turma: '3A',
            sala: 'Sala 16',
            status: 'Às 09:30',
        },
    ],
};

function abrir(rotas) {
    document.body.innerHTML = corpoDaPagina();
    document.body.className = 'ui3 ui-painel';
    window.API_BASE_URL = '/api';
    global.fetch = jest.fn((url) => {
        const caminho = String(url).replace('/api', '');
        const chave = Object.keys(rotas).find((r) => caminho.startsWith(r));
        return chave ? rotas[chave]() : falha();
    });
    window.fetch = global.fetch;
    require(PAINEL);
}

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
});

afterEach(() => {
    delete global.fetch;
    delete window.PainelProfessor;
});

const texto = (sel) => document.querySelector(sel).textContent.trim();

describe('painel do professor (Issue #367)', () => {
    it('preenche os cartões com o que a API devolve', async () => {
        abrir({
            '/dashboard/teacher-panel': () => ok(PAINEL_COM_AULAS),
            '/avaliacoes-escolares': () =>
                ok([{ totalNotas: 0 }, { totalNotas: 12 }, { totalNotas: 0 }]),
            '/faltas': () => ok([{ turma: '3A' }, { turma: '3A' }]),
        });
        await window.PainelProfessor.iniciar();
        await assentar();

        expect(document.getElementById('pnKpisProfessor').hidden).toBe(false);
        expect(texto('[data-kpi="turmas"]')).toBe('2');
        expect(texto('[data-kpi="proxima"]')).toBe('Agora');
        expect(texto('[data-kpi-sub="proxima"]')).toContain('Inglês (Marcelo)');
        expect(texto('[data-kpi="avaliacoes"]')).toBe('2');
        expect(texto('[data-kpi="frequencia"]')).toBe('1/2');
    });

    it('lista a agenda da grade e marca a aula em andamento e a próxima', async () => {
        abrir({
            '/dashboard/teacher-panel': () => ok(PAINEL_COM_AULAS),
            '/avaliacoes-escolares': () => ok([]),
            '/faltas': () => ok([]),
        });
        await window.PainelProfessor.iniciar();
        await assentar();

        const estados = Array.from(document.querySelectorAll('#pnAgendaLista .pn-aula')).map(
            (li) => li.dataset.estado
        );
        expect(estados).toEqual(['concluida', 'agora', 'proxima']);
        expect(document.getElementById('pnAgendaLista').getAttribute('aria-busy')).toBe('false');
    });

    it('sem aula na grade mostra o estado vazio, não uma agenda de exemplo', async () => {
        abrir({
            '/dashboard/teacher-panel': () => ok({ turmas: ['3A'], proximasAulas: [] }),
            '/avaliacoes-escolares': () => ok([]),
            '/faltas': () => ok([]),
        });
        await window.PainelProfessor.iniciar();
        await assentar();

        expect(document.querySelectorAll('#pnAgendaLista .pn-aula')).toHaveLength(0);
        expect(texto('#pnAgendaLista .pn-vazio')).toMatch(/Nenhuma aula na grade para hoje/);
        expect(texto('[data-kpi="proxima"]')).toBe('—');
        expect(texto('[data-kpi-sub="avaliacoes"]')).toBe('Nenhuma avaliação criada');
    });

    it('com a API fora, cada cartão mostra "—" e a agenda oferece tentar de novo', async () => {
        abrir({});
        await window.PainelProfessor.iniciar();
        await assentar();

        for (const kpi of ['turmas', 'proxima', 'avaliacoes', 'frequencia']) {
            expect(texto(`[data-kpi="${kpi}"]`)).toBe('—');
        }
        expect(document.querySelector('#pnAgendaLista [data-pn-recarregar]')).not.toBeNull();
    });
});

describe('escola ativa no cabeçalho', () => {
    it('mostra só o nome da escola, nunca o id', async () => {
        document.body.innerHTML = corpoDaPagina();
        document.body.className = 'ui3 ui-painel';
        window.API_BASE_URL = '/api';
        global.fetch = jest.fn(() =>
            Promise.resolve({
                ok: true,
                json: () =>
                    Promise.resolve({
                        success: true,
                        escolaAtivaId: ESCOLA_ID,
                        data: [{ _id: ESCOLA_ID, nome: 'CIEP Profª Maria Nilde Mascellani' }],
                    }),
            })
        );
        require(SWITCHER);
        await assentar();

        const topo = document.querySelector('[data-escola-ativa-topo]');
        expect(topo.hidden).toBe(false);
        expect(texto('.pn-escola-topo-nome')).toBe('CIEP Profª Maria Nilde Mascellani');
        expect(document.body.textContent).not.toContain(ESCOLA_ID);
    });
});
