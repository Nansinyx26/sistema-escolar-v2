/**
 * @jest-environment jsdom
 */

/**
 * relatoriosDoDiretor.test.js — para onde o "Relatórios" do dashboard leva.
 *
 * O DEFEITO, EM UMA FRASE
 * -----------------------
 * A diretora abria o dashboard, apertava "Relatórios" e caía em
 * `/html/secretaria/relatorios.html` — a tela da SECRETARIA, com os filtros e
 * as exportações dela.
 *
 * POR QUE A CORREÇÃO ANTERIOR NÃO BASTOU (Issue #186)
 * ---------------------------------------------------
 * Aquela correção trocou o `href` do item da barra lateral e acrescentou um
 * `if (user.perfil === 'diretor')` em `verRelatorios`. As duas leem
 * `user.perfil` — o campo CRU do documento de usuário. E o dashboard não
 * decide o perfil assim em todo lugar: `atualizarHeader` usa
 * `resolverPerfilAtivo` (js/auth.js), que dá precedência ao cargo do VÍNCULO
 * da escola ativa. Numa conta multi-escola as duas leituras discordam.
 *
 * O resultado era a tela contando duas histórias ao mesmo tempo: o cabeçalho
 * escrevia "Diretor(a)" e, logo abaixo, a barra lateral montava o menu da
 * secretaria — inclusive o "Relatórios" que aponta para a tela dela. Não havia
 * nada de errado com o `href` corrigido: ele simplesmente não era o link que
 * aparecia para essa conta.
 *
 * O QUE ESTE ARQUIVO COBRA
 * ------------------------
 *   1. `verRelatorios()` decide pelo perfil ATIVO, e só a secretaria chega à
 *      tela da secretaria — inclusive quando não dá para saber quem é.
 *   2. Depois do boot real do dashboard, a conta de direção não recebe nenhum
 *      link para `/html/secretaria/` na barra lateral.
 *
 * O que é dublê: `db`, `auth` e `fetch`. As decisões exercidas são as de
 * produção — `js/auth.js` e `js/dashboard.js` são os arquivos servidos.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const PAGINA = path.join(RAIZ, 'html', 'dashboard.html');
const AUTH = path.join(RAIZ, 'js', 'auth.js');
const DASHBOARD = path.join(RAIZ, 'js', 'dashboard.js');

const BI_DA_DIRECAO = '/html/direcao/bi-pedagogico.html';
const RELATORIOS_DA_SECRETARIA = '/html/secretaria/relatorios.html';

const ESCOLA = '65f000000000000000000001';

/**
 * O corpo REAL da página, sem os `<script>`. Remontar a barra lateral à mão
 * faria o teste passar para sempre, mesmo que alguém devolvesse o item da
 * secretaria ao bloco da direção — que é a regressão a pegar.
 */
function corpoDaPagina() {
    const html = fs.readFileSync(PAGINA, 'utf8');
    const corpo = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));
    return corpo.replace(/<script[\s\S]*?<\/script>/g, '');
}

function resposta(corpo) {
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(corpo) });
}

/** Deixa as promessas já resolvidas de `fetch` assentarem no DOM. */
async function assentar() {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
}

/**
 * Sobe a tela com uma sessão.
 *
 * @param {object|null} usuario  o que `auth.getCurrentUser()` devolve
 * @param {boolean}     bootar   dispara o DOMContentLoaded (boot completo)
 */
async function abrirComo(usuario, { bootar = false } = {}) {
    document.body.innerHTML = corpoDaPagina();

    // jsdom não navega: sem isto, escrever em `location.href` estoura.
    delete window.location;
    window.location = { href: '' };

    window.API_BASE_URL = '/api';

    // A ORDEM IMPORTA: `js/auth.js` termina em `window.auth = new AuthManager()`.
    // Carregado DEPOIS do dublê, ele o substituiria pelo gerenciador real — que
    // lê a sessão do sessionStorage, não acha nada e devolve `null`. O teste
    // continuaria verde pelo motivo errado: todo perfil cairia no destino
    // padrão. Primeiro o arquivo real (é dele que vem `resolverPerfilAtivo`),
    // depois o dublê por cima.
    require(AUTH);

    global.auth = {
        init: jest.fn().mockResolvedValue(undefined),
        isAuthenticated: () => Boolean(usuario),
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

    if (bootar) {
        document.dispatchEvent(new window.Event('DOMContentLoaded'));
        await assentar();
    }
}

/** Todo link da barra lateral que o navegador de fato mostraria. */
function itensVisiveisDaBarra() {
    return Array.from(
        document.querySelectorAll('#mainSidebar a.sidebar-item, aside a.sidebar-item')
    )
        .filter((a) => a.style.display !== 'none')
        .map((a) => ({
            texto: a.textContent.trim(),
            href: a.getAttribute('href') || '',
        }));
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

// ─────────────────────────────────────────────────────────────────────────────

describe('verRelatorios leva cada perfil aos relatórios dele', () => {
    it.each([
        ['diretor', BI_DA_DIRECAO],
        ['admin', BI_DA_DIRECAO],
        ['professor', BI_DA_DIRECAO],
        ['secretaria', RELATORIOS_DA_SECRETARIA],
    ])('%s vai para %s', async (perfil, destino) => {
        await abrirComo({ nome: 'Fulano', perfil });

        window.verRelatorios();

        expect(`${perfil}: ${window.location.href}`).toBe(`${perfil}: ${destino}`);
    });

    it('o cargo do vínculo da escola ativa vence o campo do documento', async () => {
        // O defeito relatado, escrito como teste: documento diz `secretaria`,
        // vínculo desta escola diz `diretor`. O cabeçalho já escrevia
        // "Diretor(a)"; o botão continuava indo para a secretaria.
        localStorage.setItem('escolaSelecionada', JSON.stringify({ id: ESCOLA }));

        await abrirComo({
            nome: 'Fulana',
            perfil: 'secretaria',
            vinculos: [{ escolaId: ESCOLA, cargo: 'diretor' }],
        });

        window.verRelatorios();

        expect(window.location.href).toBe(BI_DA_DIRECAO);
    });

    it('sem sessão resolvida não cai na tela da secretaria', async () => {
        // O ramo final da versão anterior mandava todo perfil não reconhecido
        // para a secretaria. Não saber quem é não pode virar um palpite que
        // abre a tela de outro setor.
        await abrirComo(null);

        window.verRelatorios();

        expect(window.location.href).toBe(BI_DA_DIRECAO);
    });
});

describe('a barra lateral da direção não oferece a tela da secretaria', () => {
    it('nenhum item visível aponta para /html/secretaria/', async () => {
        await abrirComo({ nome: 'Fulano', perfil: 'diretor' }, { bootar: true });

        const paraSecretaria = itensVisiveisDaBarra().filter((i) => i.href.includes('secretaria/'));

        expect(paraSecretaria).toEqual([]);
    });

    it('a conta multi-escola com vínculo de direção também não os recebe', async () => {
        // Mesmo cenário do defeito, agora na barra lateral: era ela que punha
        // o "Relatórios" da secretaria na frente de quem dirige a escola.
        localStorage.setItem('escolaSelecionada', JSON.stringify({ id: ESCOLA }));

        await abrirComo(
            {
                nome: 'Fulana',
                perfil: 'secretaria',
                vinculos: [{ escolaId: ESCOLA, cargo: 'diretor' }],
            },
            { bootar: true }
        );

        const paraSecretaria = itensVisiveisDaBarra().filter((i) => i.href.includes('secretaria/'));

        expect(paraSecretaria).toEqual([]);
    });

    it('a secretaria continua enxergando os relatórios dela', async () => {
        // O risco simétrico: fechar a porta para a direção e fechá-la também
        // para quem mora na tela.
        await abrirComo({ nome: 'Fulana', perfil: 'secretaria' }, { bootar: true });

        const hrefs = itensVisiveisDaBarra().map((i) => i.href);

        expect(hrefs.some((h) => h.includes('secretaria/relatorios.html'))).toBe(true);
    });

    it('perfil que a tela não reconhece não recebe bloco de setor nenhum', async () => {
        // `atualizarVisibilidadeSidebar` não tinha ramo final: um perfil fora
        // dos três deixava a barra exatamente como o HTML a entregou. Hoje isso
        // é inofensivo porque cada item restrito nasce com `display: none`
        // inline — uma garantia que mora no HTML, não na função.
        await abrirComo({ nome: 'Fulano', perfil: 'responsavel' }, { bootar: true });

        const restritos = itensVisiveisDaBarra().filter(
            (i) => i.href.includes('secretaria/') || i.href.includes('direcao/')
        );

        expect(restritos).toEqual([]);
    });
});

describe('o HTML servido acompanha o JS corrigido', () => {
    it('o dashboard pede uma versão de js/dashboard.js posterior à do defeito', () => {
        // `?v=3` é a versão publicada COM o defeito. Enquanto a query não muda,
        // o navegador (e o stale-while-revalidate do service worker) devolve o
        // arquivo antigo e a correção não chega a rodar.
        const html = fs.readFileSync(PAGINA, 'utf8');
        const versao = html.match(/js\/dashboard\.js\?v=(\d+)/);

        expect(versao).not.toBeNull();
        expect(Number(versao[1])).toBeGreaterThan(3);
    });

    it('nenhum item director-only da barra aponta para a secretaria', () => {
        // Asserção sobre o arquivo, não sobre o DOM: pega a regressão mesmo que
        // alguém mude a função que decide a visibilidade.
        const html = fs.readFileSync(PAGINA, 'utf8');
        const linhas = html.split('\n').filter((l) => l.includes('director-only'));

        expect(linhas.length).toBeGreaterThan(0);
        expect(linhas.filter((l) => l.includes('secretaria/'))).toEqual([]);
    });
});
