/**
 * @jest-environment jsdom
 */

/**
 * termoVoltar.test.js — para onde o "Voltar" da página do Termo leva cada
 * perfil, e o que o painel de aceite exige antes de liberar o botão.
 *
 * O DEFEITO, EM UMA FRASE (Issue #201)
 * ------------------------------------
 * O fallback do "Voltar" era `perfil.html`, que não é a casa de perfil nenhum.
 * Quem abrisse a página sem referrer utilizável — link colado, aba nova, volta
 * pelo cache do Service Worker — saía dela para o lugar errado; e para o
 * responsável, `perfil.html` é uma tela do lado escolar do sistema, não o
 * portal dele.
 *
 * É o MESMO defeito que `conversasVoltar.test.js` guarda para a tela de
 * conversas, e a correção segue a mesma disciplina: o destino sai da tabela de
 * painéis (espelhada em `js/guarda-acesso.js`, que por sua vez espelha
 * `backend/src/utils/painelPorPerfil.js`), e o perfil é resolvido pelo
 * `/auth/me` quando o `sessionStorage` não tem nada — porque o portal do
 * responsável autentica por cookie e NUNCA grava `currentUser`.
 *
 * POR QUE UM TESTE EM jsdom, SE `paginaModeracao.test.js` JÁ OLHA A PÁGINA
 * -----------------------------------------------------------------------
 * Lá as asserções são sobre strings: provam que as PEÇAS estão na página. Entre
 * uma tabela correta e um `href` correto existe código que pode falhar — o
 * seletor pode não casar, a resposta do `/auth/me` pode ser lida no campo
 * errado, o `await` pode nunca resolver. Aqui o script real da página roda, e a
 * asserção é sobre o atributo que o navegador de fato seguiria.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PAGINA = path.join(RAIZ, 'html/termo-audio-imagem.html');
const GUARD = path.join(RAIZ, 'js/guarda-acesso.js');

const html = fs.readFileSync(PAGINA, 'utf8');

const PORTAL = '/portal-responsavel/dist/index.html';
const DASHBOARD = '/html/dashboard.html';
const PAINEL_SECRETARIA = '/html/secretaria/painel.html';

/** O que o HTML traz de fábrica, antes de o script decidir qualquer coisa. */
const FALLBACK_DO_HTML = 'dashboard.html';

/**
 * O corpo REAL da página, sem os `<script>`. Remontar o esqueleto à mão faria o
 * teste passar para sempre, mesmo que alguém tirasse o `id="btnVoltarNav"` —
 * que é justamente a regressão a pegar.
 */
function corpoDaPagina() {
    const corpo = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
    return corpo.replace(/<script[\s\S]*?<\/script>/g, '');
}

/** O script inline da página, que é onde a decisão mora. */
function scriptDaPagina() {
    const inline = html.match(/<script>\n([\s\S]*?)\n {4}<\/script>/);
    if (!inline) throw new Error('script inline da página do Termo não encontrado');
    return inline[1];
}

const PENDENTE = {
    aceito: false,
    aceitoEm: null,
    consentimentoLgpd: { aceito: false, versao: '2.0', aceitoEm: null },
};

function resposta(corpo) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(corpo) });
}

/** Deixa as promessas já resolvidas de `fetch` assentarem no DOM. */
async function assentar() {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
}

function linkVoltar() {
    return document.getElementById('btnVoltarNav');
}

/**
 * Abre a tela com uma sessão de determinado perfil.
 *
 * @param {object}      opcoes
 * @param {string|null} opcoes.cache             perfil em `currentUser` (sessionStorage)
 * @param {string|null} opcoes.perfilDoServidor  o que `/auth/me` responde
 * @param {string|null} opcoes.referrer          página anterior (caminho interno)
 * @param {object}      opcoes.estado            resposta de `GET /aceite-termo`
 */
async function abrirComo({
    cache = null,
    perfilDoServidor = null,
    referrer = null,
    estado = PENDENTE,
} = {}) {
    document.body.innerHTML = corpoDaPagina();

    Object.defineProperty(document, 'referrer', {
        value: referrer ? `${window.location.origin}${referrer}` : '',
        configurable: true,
    });

    if (cache) sessionStorage.setItem('currentUser', JSON.stringify({ perfil: cache }));

    global.fetch = jest.fn((url) => {
        const u = String(url);
        if (u.includes('/auth/me')) {
            if (!perfilDoServidor) return Promise.resolve({ ok: false, status: 401 });
            return resposta({ success: true, user: { perfil: perfilDoServidor } });
        }
        if (u.includes('/aceite-termo')) return resposta({ success: true, data: estado });
        return resposta({ success: true });
    });
    window.fetch = global.fetch;

    // O guard de verdade, e não uma tabela de mentira: é dele que sai o painel
    // de cada perfil. Em jsdom a página corrente é '/', que a matriz trata como
    // pública — ele publica `window.GuardaAcesso` e sai sem esconder nada.
    require(GUARD);

    // `new Function` e não um `<script>`: o jsdom do Jest não executa script
    // inline. O código vem do arquivo de produção, sem adaptação.
    new Function(scriptDaPagina())();
    document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await assentar();
}

beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '';
    sessionStorage.clear();
    delete window.GuardaAcesso;
});

afterEach(() => {
    delete global.fetch;
});

// ─────────────────────────────────────────────────────────────────────────────

describe('o Voltar da página do Termo leva cada perfil para a casa dele', () => {
    it('RESPONSÁVEL volta para o portal, não para uma tela do lado escolar', async () => {
        // Vem do portal: React autenticado por cookie, sem `currentUser`.
        await abrirComo({ perfilDoServidor: 'responsavel' });

        expect(linkVoltar().getAttribute('href')).toBe(PORTAL);
        expect(linkVoltar().getAttribute('href')).not.toContain('perfil.html');
    });

    it('PROFESSOR volta para o dashboard', async () => {
        await abrirComo({ cache: 'professor', perfilDoServidor: 'professor' });
        expect(linkVoltar().getAttribute('href')).toBe(DASHBOARD);
    });

    it('DIRETOR volta para o dashboard', async () => {
        await abrirComo({ cache: 'diretor', perfilDoServidor: 'diretor' });
        expect(linkVoltar().getAttribute('href')).toBe(DASHBOARD);
    });

    it('SECRETARIA volta para o painel dela', async () => {
        await abrirComo({ cache: 'secretaria', perfilDoServidor: 'secretaria' });
        expect(linkVoltar().getAttribute('href')).toBe(PAINEL_SECRETARIA);
    });

    it('respeita a página anterior quando ela é interna e abrível', async () => {
        // Quem veio da conversa estava tentando enviar uma mídia: devolver ao
        // painel seria perder justamente esse contexto (Issue #189).
        await abrirComo({
            cache: 'responsavel',
            perfilDoServidor: 'responsavel',
            referrer: '/html/conversas.html',
        });

        expect(linkVoltar().getAttribute('href')).toBe('/html/conversas.html');
    });

    it('ignora a página anterior que o perfil não pode abrir', async () => {
        // Um responsável com o dashboard no referrer (histórico, link herdado)
        // seria devolvido para uma página que o gate do servidor não deixa ele
        // abrir — ou seja, para um redirecionamento.
        await abrirComo({
            cache: 'responsavel',
            perfilDoServidor: 'responsavel',
            referrer: '/html/dashboard.html',
        });

        expect(linkVoltar().getAttribute('href')).toBe(PORTAL);
    });

    it('sem perfil resolvido e sem página anterior, mantém o fallback do HTML', async () => {
        // Chutar um painel seria pior: o link continua clicável e levaria a
        // pessoa para a tela errada. Mesma decisão de `js/conversas.js`.
        await abrirComo({ perfilDoServidor: null });
        expect(linkVoltar().getAttribute('href')).toBe(FALLBACK_DO_HTML);
    });
});

describe('o painel de aceite exige os DOIS consentimentos', () => {
    it('só libera o botão com o Termo e o consentimento LGPD marcados', async () => {
        await abrirComo({ cache: 'professor', perfilDoServidor: 'professor' });

        const botao = document.getElementById('btnConfirmarAceite');
        const termo = document.getElementById('checkAceito');
        const lgpd = document.getElementById('checkConsentimentoLgpd');

        expect(botao.disabled).toBe(true);

        termo.checked = true;
        termo.dispatchEvent(new window.Event('change'));
        expect(botao.disabled).toBe(true);

        lgpd.checked = true;
        lgpd.dispatchEvent(new window.Event('change'));
        expect(botao.disabled).toBe(false);
    });

    it('quem já tem o Termo aceito ainda consegue registrar só o consentimento', async () => {
        // A conta que assinou o Termo ANTES da Issue #201 existir: se o painel
        // sumisse por causa do Termo aceito, ela ficaria sem caminho nenhum
        // para consentir — e "Meus Dados" diria "não registrado" para sempre.
        await abrirComo({
            cache: 'professor',
            perfilDoServidor: 'professor',
            estado: {
                aceito: true,
                aceitoEm: '2026-08-01T10:00:00.000Z',
                consentimentoLgpd: { aceito: false, versao: '2.0', aceitoEm: null },
            },
        });

        const botao = document.getElementById('btnConfirmarAceite');
        const termo = document.getElementById('checkAceito');
        const lgpd = document.getElementById('checkConsentimentoLgpd');

        expect(termo.checked).toBe(true);
        expect(termo.disabled).toBe(true);
        expect(botao.style.display).toBe('inline-flex');

        lgpd.checked = true;
        lgpd.dispatchEvent(new window.Event('change'));
        expect(botao.disabled).toBe(false);
    });

    it('some com o painel só quando os dois estão registrados', async () => {
        await abrirComo({
            cache: 'professor',
            perfilDoServidor: 'professor',
            estado: {
                aceito: true,
                aceitoEm: '2026-08-01T10:00:00.000Z',
                consentimentoLgpd: {
                    aceito: true,
                    versao: '2.0',
                    aceitoEm: '2026-08-01T10:00:00.000Z',
                },
            },
        });

        expect(document.getElementById('btnConfirmarAceite').style.display).toBe('none');
        expect(document.getElementById('checkConsentimentoLgpd').disabled).toBe(true);
        expect(document.getElementById('statusLgpdTitulo').textContent).toContain('Registrado');
    });

    it('não afirma pendência quando não conseguiu consultar', async () => {
        // Falha ABERTA, como o `js/termo-audio-imagem.js` do chat: dizer
        // "pendente" sem ter perguntado é mentir sobre o estado da conta.
        document.body.innerHTML = corpoDaPagina();
        Object.defineProperty(document, 'referrer', { value: '', configurable: true });
        global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500 }));
        window.fetch = global.fetch;
        require(GUARD);
        // Mesma execução do script real usada no bloco acima.
        new Function(scriptDaPagina())();
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        await assentar();

        expect(document.getElementById('statusTextoTitulo').textContent).toContain(
            'Não foi possível'
        );
        expect(document.getElementById('statusLgpdTitulo').textContent).toContain(
            'Não foi possível'
        );
        expect(document.getElementById('btnConfirmarAceite').style.display).toBe('inline-flex');
    });
});
