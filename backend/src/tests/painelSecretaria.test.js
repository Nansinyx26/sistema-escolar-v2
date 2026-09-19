/**
 * @jest-environment jsdom
 */

/**
 * painelSecretaria.test.js — painel da secretaria no visual novo (Issue #369)
 *
 * Roda o corpo REAL de `html/secretaria/painel.html` com `js/painel-dados.js`
 * e `js/painel-secretaria.js`. Dublê só para `fetch`. Cobra:
 *
 *   1. os seis cartões mostram o que a API devolve;
 *   2. nome do aluno e motivo da justificativa (escritos pelo responsável)
 *      entram escapados — o painel antigo os injetava crus no innerHTML;
 *   3. sem dado, cada bloco diz o que acontece; com a API fora, "—";
 *   4. os atalhos do painel antigo continuam alcançáveis.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PAGINA = path.join(RAIZ, 'html', 'secretaria', 'painel.html');
const DADOS = path.join(RAIZ, 'js', 'painel-dados.js');
const PAINEL = path.join(RAIZ, 'js', 'painel-secretaria.js');

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
    window.auth = { getCurrentUser: () => ({ nome: 'Marta Souza', perfil: 'secretaria' }) };
    global.fetch = jest.fn((url) => {
        const caminho = String(url).replace('/api', '');
        const chave = Object.keys(rotas).find((r) => caminho.startsWith(r));
        return chave ? rotas[chave]() : falha();
    });
    window.fetch = global.fetch;
    require(DADOS);
    require(PAINEL);
}

const texto = (sel) => document.querySelector(sel).textContent.trim();

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
});

afterEach(() => {
    delete global.fetch;
    delete window.auth;
    delete window.PainelDados;
    delete window.PainelSecretaria;
    delete window.sair;
});

describe('painel da secretaria (Issue #369)', () => {
    it('mostra os seis cartões com os números da API', async () => {
        abrir({
            '/secretaria/dashboard/resumo': () =>
                ok({
                    data: {
                        totalAlunos: 120,
                        totalTurmas: 5,
                        totalMatriculas: 118,
                        justificativasPendentes: 2,
                        docsEmitidos: 40,
                    },
                }),
            '/secretaria/autorizacoes': () => ok({ kpis: { totalPendentes: 7 } }),
            '/secretaria/frequencia/consolidada': () =>
                ok({ data: [{ turma: '1A', presencas: 9, totalRegistros: 10 }] }),
            '/comunicados': () =>
                ok({ data: [{ titulo: 'Festa', dataCriacao: new Date().toISOString() }] }),
            '/secretaria/turmas': () => ok({ data: [{ nome: '1A', totalAlunos: 25 }] }),
            '/secretaria/justificativas': () => ok({ data: [] }),
            '/secretaria/calendario': () => ok({ data: [] }),
        });
        await window.PainelSecretaria.iniciar();
        await assentar();

        expect(texto('#secWelcome')).toContain('Marta');
        expect(texto('[data-kpi="sec-alunos"]')).toBe('120');
        expect(texto('[data-kpi-sub="sec-alunos"]')).toBe('Em 5 turmas');
        expect(texto('[data-kpi="sec-matriculas"]')).toBe('118');
        expect(texto('[data-kpi="sec-documentos"]')).toBe('7');
        expect(texto('[data-kpi="sec-frequencia"]')).toBe('90%');
        expect(texto('[data-kpi="sec-solicitacoes"]')).toBe('2');
        expect(texto('[data-kpi="sec-comunicados"]')).toBe('1');
        expect(texto('#pnAtLista .pn-barra-num')).toBe('25');
    });

    it('escapa nome do aluno e motivo da justificativa', async () => {
        abrir({
            '/secretaria/justificativas': () =>
                ok({
                    data: [
                        { alunoNome: '<img src=x onerror=alert(1)>', motivo: '<b>consulta</b>' },
                    ],
                }),
        });
        await window.PainelSecretaria.iniciar();
        await assentar();

        const lista = document.getElementById('secPendingList');
        expect(lista.querySelector('img')).toBeNull();
        expect(lista.querySelector('b')).toBeNull();
        expect(lista.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    it('sem dado, os blocos dizem o que acontece; com a API fora, "—"', async () => {
        abrir({
            '/secretaria/justificativas': () => ok({ data: [] }),
            '/secretaria/turmas': () => ok({ data: [] }),
        });
        await window.PainelSecretaria.iniciar();
        await assentar();

        expect(texto('#secPendingList .pn-vazio')).toMatch(/Nenhuma justificativa pendente/);
        expect(texto('#pnAtLista .pn-vazio')).toMatch(/Nenhuma turma cadastrada/);
        for (const kpi of ['sec-alunos', 'sec-documentos', 'sec-frequencia', 'sec-comunicados']) {
            expect(texto(`[data-kpi="${kpi}"]`)).toBe('—');
        }
    });

    it('mantém alcançáveis os atalhos do painel antigo', () => {
        const html = fs.readFileSync(PAGINA, 'utf8');
        for (const destino of [
            'href="/html/conversas.html"',
            'href="matriculas.html"',
            'href="turma-alunos.html"',
            'href="importar-alunos.html"',
            'href="documentos.html"',
            'href="/detalhes/autorizacoes-pais.html"',
            'href="/detalhes/avaliacoes.html"',
            'href="justificativas.html"',
            'href="comunicados.html"',
            'href="relatorios.html"',
            'data-codigo-aluno',
            'href="../../detalhes/alunos.html"',
            'href="../direcao/ia-assistant.html"',
        ]) {
            expect(html).toContain(destino);
        }
    });
});
