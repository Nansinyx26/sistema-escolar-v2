/**
 * @jest-environment jsdom
 */

/**
 * navegacaoMesmaOrigem.test.js — Issue #656
 *
 * Dois pontos do frontend punham um valor direto em `location.href`:
 *
 *   - js/sidebar-voice.js: qualquer `[data-href]` virava navegação, e um
 *     `javascript:` rodaria código;
 *   - js/botao-voltar.js: a pilha guarda `pathname + search`, e o pathname de
 *     `https://escola//outro-host/x` é `//outro-host/x` — URL relativa ao
 *     esquema, que leva para outro site quando o Voltar a desempilha.
 *
 * Os dois agora resolvem o destino contra a página e só aceitam a mesma origem.
 */

const NavegacaoVoltar = require('../../../js/botao-voltar.js');

const PAGINA = 'https://escola.test/html/perfil.html';

const ACEITOS = [
    'perfil.html',
    '../direcao/horario-jaguari.html',
    '/html/dashboard.html',
    '/html/secretaria/painel.html?aba=1',
    '#pnFrequenciaTurmas',
    'https://escola.test/html/dashboard.html',
];

const RECUSADOS = [
    '//outro-host.test/x',
    '/\\outro-host.test/x',
    '\\\\outro-host.test/x',
    'https://outro-host.test/html/dashboard.html',
    'http://escola.test/html/dashboard.html',
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://escola.test/123',
    '',
    '   ',
    null,
    undefined,
];

let locationOriginal;

function fingirPagina(href) {
    delete window.location;
    window.location = { href, pathname: new URL(href).pathname, search: '' };
}

beforeEach(() => {
    locationOriginal = window.location;
    sessionStorage.clear();
    fingirPagina(PAGINA);
});

afterEach(() => {
    window.location = locationOriginal;
    document.body.innerHTML = '';
});

describe('js/botao-voltar.js — destinoMesmaOrigem', () => {
    it.each(ACEITOS)('aceita %p', (url) => {
        expect(NavegacaoVoltar.destinoMesmaOrigem(url)).toBe(url);
    });

    it.each(RECUSADOS)('recusa %p', (url) => {
        expect(NavegacaoVoltar.destinoMesmaOrigem(url)).toBeNull();
    });

    it('caminho //host da pilha não vira redirecionamento externo', () => {
        sessionStorage.setItem('currentUser', JSON.stringify({ perfil: 'diretor' }));
        NavegacaoVoltar.setStack(['/html/direcao/index.html', '//outro-host.test/x']);

        const destino = NavegacaoVoltar.voltar();

        expect(destino).toBe('/html/direcao/index.html');
        expect(window.location.href).toBe('/html/direcao/index.html');
    });

    it('o topo //host não é oferecido como destino do botão', () => {
        sessionStorage.setItem('currentUser', JSON.stringify({ perfil: 'secretaria' }));
        NavegacaoVoltar.setStack(['//outro-host.test/x']);

        expect(NavegacaoVoltar.obterUrlVoltar()).toBe('/html/secretaria/painel.html');
    });

    it('página com pathname //host não entra na pilha', () => {
        NavegacaoVoltar.setStack(['/html/dashboard.html']);

        NavegacaoVoltar.registrarPaginaAtual('//outro-host.test/x');

        expect(NavegacaoVoltar.getStack()).toEqual(['/html/dashboard.html']);
    });

    it('fallback do botão fora da origem dá lugar ao painel do perfil', () => {
        sessionStorage.setItem('currentUser', JSON.stringify({ perfil: 'professor' }));

        expect(NavegacaoVoltar.getFallbackDashboard('javascript:alert(1)')).toBe(
            '/html/dashboard.html'
        );
        expect(NavegacaoVoltar.getFallbackDashboard('//outro-host.test/')).toBe(
            '/html/dashboard.html'
        );
        expect(NavegacaoVoltar.getFallbackDashboard('../detalhes/alunos.html')).toBe(
            '../detalhes/alunos.html'
        );
    });
});

describe('js/sidebar-voice.js — clique em [data-href]', () => {
    beforeAll(() => {
        // Registra o ouvinte de clique do documento (uma vez: cada require
        // somaria outro ouvinte ao mesmo `document`).
        require('../../../js/sidebar-voice.js');
    });

    function clicar(href) {
        document.body.innerHTML = '<button type="button" id="alvo"></button>';
        const botao = document.getElementById('alvo');
        botao.setAttribute('data-href', href);
        botao.click();
        return window.location.href;
    }

    it.each(ACEITOS)('navega para %p', (href) => {
        expect(clicar(href)).toBe(href);
    });

    it.each(RECUSADOS.filter((h) => typeof h === 'string'))('não navega para %p', (href) => {
        expect(clicar(href)).toBe(PAGINA);
    });
});
