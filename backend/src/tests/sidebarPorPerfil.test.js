/**
 * @jest-environment jsdom
 */

/**
 * sidebarPorPerfil.test.js — o que cada perfil enxerga na barra lateral do dashboard.
 *
 * O DEFEITO (Issue #269)
 * ----------------------
 * "Autorizações dos Pais" aparecia duas vezes para Diretor e Secretaria. O
 * dashboard tinha um link no grupo da direção e outro no grupo da secretaria,
 * e os dois usavam `director-secretaria-shared` — a classe que
 * `atualizarVisibilidadeSidebar()` mostra para os dois perfis. Cada perfil
 * recebia os dois links.
 *
 * O QUE ESTE ARQUIVO COBRA
 * ------------------------
 *   1. Diretor, admin e Secretaria veem Autorizações dos Pais exatamente uma vez.
 *   2. Professor não vê Autorizações dos Pais.
 *   3. Diretor, admin, Secretaria e Professor veem Avaliações, uma vez.
 *
 * Mesmo método de `relatoriosDoDiretor.test.js`: o corpo REAL de
 * `html/dashboard.html` e os arquivos servidos `js/auth.js` e
 * `js/dashboard.js`. Dublês só para `db`, `auth` e `fetch`.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PAGINA = path.join(RAIZ, 'html', 'dashboard.html');
const AUTH = path.join(RAIZ, 'js', 'auth.js');
const DASHBOARD = path.join(RAIZ, 'js', 'dashboard.js');

function corpoDaPagina() {
    const html = fs.readFileSync(PAGINA, 'utf8');
    const corpo = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
    return corpo.replace(/<script[\s\S]*?<\/script>/g, '');
}

function resposta(corpo) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(corpo) });
}

async function assentar() {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
}

async function abrirComo(perfil) {
    const usuario = { nome: 'Fulano', perfil };
    document.body.innerHTML = corpoDaPagina();
    delete window.location;
    window.location = { href: '' };
    window.API_BASE_URL = '/api';

    // Primeiro o arquivo real (de onde vem `resolverPerfilAtivo`), depois o
    // dublê por cima — na ordem inversa o AuthManager real apagaria o dublê.
    require(AUTH);
    global.auth = {
        init: jest.fn().mockResolvedValue(undefined),
        isAuthenticated: () => true,
        getCurrentUser: () => usuario,
    };
    window.auth = global.auth;
    global.db = {
        init: jest.fn().mockResolvedValue(undefined),
        findByIndex: jest.fn().mockResolvedValue(null),
        getAll: jest.fn().mockResolvedValue([]),
    };
    global.showToast = jest.fn();
    window.showToast = global.showToast;
    global.fetch = jest.fn(() => resposta({ success: true, data: {} }));
    window.fetch = global.fetch;

    require(DASHBOARD);
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await assentar();
}

/** Quantos links visíveis da barra lateral apontam para a página. */
function visiveisPara(pagina) {
    return Array.from(document.querySelectorAll('aside a.sidebar-item')).filter(
        (a) => a.style.display !== 'none' && (a.getAttribute('href') || '').endsWith(pagina)
    ).length;
}

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    sessionStorage.clear();
    localStorage.clear();
});

afterEach(() => {
    delete global.fetch;
    delete global.auth;
    delete global.db;
    delete global.showToast;
});

describe('Autorizações dos Pais na barra lateral (Issue #269)', () => {
    it.each(['diretor', 'admin', 'secretaria'])(
        '%s vê o item exatamente uma vez',
        async (perfil) => {
            await abrirComo(perfil);
            expect(visiveisPara('autorizacoes-pais.html')).toBe(1);
        }
    );

    it('professor não vê o item', async () => {
        await abrirComo('professor');
        expect(visiveisPara('autorizacoes-pais.html')).toBe(0);
    });
});

describe('Avaliações na barra lateral', () => {
    it.each(['diretor', 'admin', 'secretaria', 'professor'])(
        '%s vê o item exatamente uma vez',
        async (perfil) => {
            await abrirComo(perfil);
            expect(visiveisPara('avaliacoes.html')).toBe(1);
        }
    );
});
