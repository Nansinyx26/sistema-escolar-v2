/**
 * @jest-environment jsdom
 */

/**
 * painelDirecao.test.js — painel da direção no visual novo (Issue #368)
 *
 * Roda o corpo REAL de `html/dashboard.html` com `js/painel-direcao.js`.
 * Dublê só para `fetch`. Cobra:
 *
 *   1. frequência geral e por turma calculadas dos registros de chamada, com a
 *      turma abaixo de 75% (LDB) marcada;
 *   2. avaliações sem nota e comunicados dos últimos 30 dias vêm da API;
 *   3. as pendências mostram a contagem real, e "em dia" quando é zero;
 *   4. sem chamada nem evento, os blocos dizem o que acontece — nada inventado;
 *   5. com a API fora, os cartões mostram "—".
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PAGINA = path.join(RAIZ, 'html', 'dashboard.html');
const PAINEL = path.join(RAIZ, 'js', 'painel-direcao.js');

function corpoDaPagina() {
    const html = fs.readFileSync(PAGINA, 'utf8');
    const abertura = html.match(/<body[^>]*>/);
    const corpo = html.slice(abertura.index + abertura[0].length, html.indexOf('</body>'));
    return corpo.replace(/<script[\s\S]*?<\/script>/g, '');
}

function ok(corpo) {
    return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, ...corpo }),
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

const texto = (sel) => document.querySelector(sel).textContent.trim();
const DIA = 24 * 60 * 60 * 1000;

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
});

afterEach(() => {
    delete global.fetch;
    delete window.PainelDirecao;
});

describe('painel da direção (Issue #368)', () => {
    it('mostra frequência, avaliações, comunicados e pendências com os números da API', async () => {
        abrir({
            '/secretaria/frequencia/consolidada': () =>
                ok({
                    data: [
                        { turma: '3A', presencas: 18, totalRegistros: 20 },
                        { turma: '3A', presencas: 20, totalRegistros: 20 },
                        { turma: '4B', presencas: 12, totalRegistros: 20 },
                    ],
                }),
            '/avaliacoes-escolares': () => ok({ data: [{ totalNotas: 0 }, { totalNotas: 5 }] }),
            '/comunicados': () =>
                ok({
                    data: [
                        { dataCriacao: new Date().toISOString() },
                        { dataCriacao: new Date(Date.now() - 60 * DIA).toISOString() },
                    ],
                }),
            '/dashboard/chart-data': () =>
                ok({ data: { turmas: [{ label: '3A', value: '7.5' }] } }),
            '/secretaria/calendario': () => ok({ data: [] }),
            '/secretaria/dashboard/resumo': () => ok({ data: { justificativasPendentes: 3 } }),
            '/conformidade/frequencia/alertas': () => ok({ data: [], total: 0 }),
        });
        await window.PainelDirecao.iniciar();
        await assentar();

        expect(document.getElementById('pnFrequenciaTurmas').hidden).toBe(false);
        // (18 + 20 + 12) / 60 = 83%
        expect(texto('[data-kpi="dir-frequencia"]')).toBe('83%');
        const barras = Array.from(document.querySelectorAll('#pnFreqLista .pn-barra'));
        expect(barras.map((b) => b.querySelector('.pn-barra-rot').textContent)).toEqual([
            '3A',
            '4B',
        ]);
        expect(barras[0].classList.contains('pn-barra--alerta')).toBe(false); // 95%
        expect(barras[1].classList.contains('pn-barra--alerta')).toBe(true); // 60%

        expect(texto('[data-kpi="dir-avaliacoes"]')).toBe('1');
        expect(texto('[data-kpi="dir-comunicados"]')).toBe('1');
        expect(texto('#pnDesLista .pn-barra-num')).toBe('7,5');

        const pendencias = Array.from(document.querySelectorAll('#pnPendLista .pn-pend')).map((a) =>
            a.textContent.trim()
        );
        expect(pendencias[0]).toMatch(/Justificativas.*3$/);
        expect(pendencias[1]).toMatch(/Avaliações sem nota.*1$/);
        expect(pendencias[2]).toMatch(/abaixo de 75%.*1$/);
        expect(pendencias[3]).toMatch(/em dia$/);
    });

    it('sem chamada nem evento, os blocos dizem o que acontece', async () => {
        abrir({
            '/secretaria/frequencia/consolidada': () => ok({ data: [] }),
            '/avaliacoes-escolares': () => ok({ data: [] }),
            '/comunicados': () => ok({ data: [] }),
            '/dashboard/chart-data': () => ok({ data: { turmas: [] } }),
            '/secretaria/calendario': () => ok({ data: [] }),
            '/secretaria/dashboard/resumo': () => ok({ data: { justificativasPendentes: 0 } }),
            '/conformidade/frequencia/alertas': () => ok({ data: [], total: 0 }),
        });
        await window.PainelDirecao.iniciar();
        await assentar();

        expect(texto('[data-kpi="dir-frequencia"]')).toBe('—');
        expect(texto('#pnFreqLista .pn-vazio')).toMatch(/Nenhuma chamada registrada/);
        expect(texto('#pnDesLista .pn-vazio')).toMatch(/Nenhuma nota lançada/);
        expect(texto('#pnEvLista .pn-vazio')).toMatch(/Nenhum evento marcado/);
    });

    it('com a API fora, os cartões mostram "—" em vez de número', async () => {
        abrir({});
        await window.PainelDirecao.iniciar();
        await assentar();

        for (const kpi of ['dir-frequencia', 'dir-avaliacoes', 'dir-comunicados']) {
            expect(texto(`[data-kpi="${kpi}"]`)).toBe('—');
        }
        expect(texto('#pnEvLista .pn-vazio')).toMatch(/Não foi possível carregar/);
    });
});
