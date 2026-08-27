/**
 * @jest-environment jsdom
 */

/**
 * conversasVoltar.test.js — para onde o botão "voltar" leva cada perfil.
 *
 * O DEFEITO, EM UMA FRASE
 * -----------------------
 * O responsável abria a tela de conversas vindo do portal, apertava "voltar" e
 * caía no dashboard do professor — barra lateral da escola, rótulo de cargo
 * trocado, e nada na tela que o levasse de volta ao portal dele. O `href` era
 * fixo em `dashboard.html`, e esta é a ÚNICA página em HTML puro que o
 * responsável alcança (ele chega de portal-responsavel/.../Header.tsx).
 *
 * POR QUE ESTE ARQUIVO EXISTE, SE JÁ HÁ TESTES DA CORREÇÃO
 * --------------------------------------------------------
 * `paginaConversas.test.js` confere que o mapa de destinos do script bate com o
 * do servidor e que a página marca o link com `data-voltar-perfil`. Isso prova
 * que as PEÇAS estão certas — não que elas se encontram. Entre um mapa correto
 * e um `href` correto existe código que pode falhar: o seletor pode não casar,
 * a resposta de `/auth/me` pode ser lida no campo errado, o `await` pode nunca
 * resolver. Nenhum desses erros aparece num teste de string.
 *
 * Aqui a página real é carregada em jsdom com o `js/conversas.js` de produção,
 * e a asserção é sobre o atributo que o navegador de fato seguiria.
 *
 * O QUE É DUBLÊ
 * -------------
 * Só `fetch`. A decisão de destino é a de produção, sem adaptação.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PAGINA = path.join(RAIZ, 'html', 'conversas.html');
const LISTA = path.join(RAIZ, 'js', 'conversas.js');

const PORTAL = '/portal-responsavel/dist/index.html';
const DASHBOARD = '/html/dashboard.html';
const PAINEL_SECRETARIA = '/html/secretaria/painel.html';

/** O que o HTML traz de fábrica, antes de o script decidir qualquer coisa. */
const FALLBACK_DO_HTML = 'dashboard.html';

function resposta(corpo) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(corpo) });
}

/**
 * O corpo REAL da página, sem os `<script>`. Remontar o esqueleto à mão faria o
 * teste passar para sempre, mesmo que alguém tirasse o `data-voltar-perfil` do
 * link — que é justamente a regressão a pegar.
 */
function corpoDaPagina() {
    const html = fs.readFileSync(PAGINA, 'utf8');
    const corpo = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
    return corpo.replace(/<script[\s\S]*?<\/script>/g, '');
}

/** Deixa as promessas já resolvidas de `fetch` assentarem no DOM. */
async function assentar() {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
}

function linkVoltar() {
    return document.querySelector('.conv-voltar');
}

/**
 * Abre a tela com uma sessão de determinado perfil.
 *
 * @param {object}       opcoes
 * @param {string|null}  opcoes.perfilDoServidor  o que `/auth/me` responde
 * @param {object|null}  opcoes.cache             `currentUser` no sessionStorage
 * @param {boolean}      opcoes.servidorFalha     `/auth/me` devolve erro
 * @param {string|null}  opcoes.cacheCru          valor bruto (para testar lixo)
 */
async function abrirComo({
    perfilDoServidor = null,
    cache = null,
    servidorFalha = false,
    cacheCru = null,
} = {}) {
    document.body.innerHTML = corpoDaPagina();

    if (cacheCru !== null) sessionStorage.setItem('currentUser', cacheCru);
    else if (cache) sessionStorage.setItem('currentUser', JSON.stringify(cache));

    global.fetch = jest.fn((url) => {
        const u = String(url);
        if (u.includes('/auth/me')) {
            if (servidorFalha) return Promise.resolve({ ok: false, status: 401 });
            return resposta({ success: true, user: { perfil: perfilDoServidor } });
        }
        if (u.includes('/chat-direto/contatos')) return resposta({ success: true, data: [] });
        return resposta({ success: true });
    });
    window.fetch = global.fetch;

    // Sem um socket com `.on`, o script reagenda a conexão até o fim da suíte.
    window.socket = { on: jest.fn() };

    require(LISTA);
    if (document.readyState === 'loading') {
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
    }
    await assentar();
}

function pediuAuthMe() {
    return global.fetch.mock.calls.some((c) => String(c[0]).includes('/auth/me'));
}

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    sessionStorage.clear();
});

afterEach(() => {
    delete global.fetch;
    delete window.socket;
    delete window.chatManager;
});

// ─────────────────────────────────────────────────────────────────────────────

describe('o botão voltar leva cada perfil para a casa dele', () => {
    it('RESPONSÁVEL volta para o portal, não para o dashboard', async () => {
        await abrirComo({ perfilDoServidor: 'responsavel' });

        // A asserção é o defeito relatado, escrito como teste.
        expect(linkVoltar().getAttribute('href')).toBe(PORTAL);
        expect(linkVoltar().getAttribute('href')).not.toContain('dashboard');
    });

    it('o rótulo acessível acompanha o destino', async () => {
        await abrirComo({ perfilDoServidor: 'responsavel' });

        // Um leitor de tela anunciando "Voltar ao painel" mandaria a pessoa para
        // o lugar errado mesmo com o href certo.
        expect(linkVoltar().getAttribute('aria-label')).toBe('Voltar ao portal');
    });

    it.each([
        ['professor', DASHBOARD],
        ['diretor', DASHBOARD],
        ['admin', DASHBOARD],
        ['secretaria', PAINEL_SECRETARIA],
    ])('%s continua indo para %s', async (perfil, destino) => {
        // O risco simétrico do defeito: consertar o responsável e quebrar quem
        // já funcionava. Os quatro são exercidos, não presumidos.
        await abrirComo({ perfilDoServidor: perfil });
        expect(`${perfil}: ${linkVoltar().getAttribute('href')}`).toBe(`${perfil}: ${destino}`);
    });
});

describe('de onde vem o perfil', () => {
    it('usa o sessionStorage quando ele tem o perfil, sem ir à rede', async () => {
        await abrirComo({ cache: { id: 'eu', perfil: 'responsavel' } });

        expect(linkVoltar().getAttribute('href')).toBe(PORTAL);
        expect(pediuAuthMe()).toBe(false);
    });

    it('pergunta ao servidor quando o sessionStorage está vazio', async () => {
        // É O CASO REAL do defeito: o portal do responsável é um app React que
        // autentica por cookie e NUNCA grava `currentUser`. Quem vem de lá chega
        // aqui sem cache nenhum — era por isso que ler só o storage não bastava.
        await abrirComo({ perfilDoServidor: 'responsavel' });

        expect(pediuAuthMe()).toBe(true);
        expect(linkVoltar().getAttribute('href')).toBe(PORTAL);
    });

    it('cache corrompido não derruba a tela — cai para o servidor', async () => {
        await abrirComo({ cacheCru: '{isto nao e json', perfilDoServidor: 'responsavel' });

        expect(linkVoltar().getAttribute('href')).toBe(PORTAL);
    });
});

describe('quando o perfil não resolve', () => {
    it.each([
        ['o servidor falha', { servidorFalha: true }],
        ['o perfil é desconhecido', { perfilDoServidor: 'coordenador' }],
    ])('%s: o link fica como está no HTML, sem chutar', async (_caso, opcoes) => {
        await abrirComo(opcoes);

        // Chutar seria pior: o link continua clicável e levaria a pessoa para a
        // tela errada. Quem cobre esta janela é o gate do servidor, que devolve
        // o responsável ao portal se ele chegar ao dashboard assim mesmo.
        expect(linkVoltar().getAttribute('href')).toBe(FALLBACK_DO_HTML);
    });
});
