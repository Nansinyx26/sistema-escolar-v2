/**
 * @jest-environment jsdom
 */

/**
 * painelDadosEscape.test.js — Issue #656
 *
 * `js/painel-dados.js` é a base dos painéis da direção e da secretaria.
 * `kpi(nome, valorHtml)` punha o valor cru no innerHTML, e `pendencias()`
 * interpolava a contagem sem escape e o `href` sem olhar o esquema. Agora o
 * valor do cartão é texto (a unidade "%" é montada pelo DOM), a contagem é
 * escapada e o link só vale se ficar na mesma origem.
 */

const TAG = '<img src=x onerror="window.__xss=1">';

let D;

beforeAll(() => {
    require('../../../js/painel-dados.js');
    D = window.PainelDados;
});

afterEach(() => {
    delete window.__xss;
    document.body.innerHTML = '';
});

function semElementoDoDado(container) {
    expect(container.querySelector('img, script, svg, iframe')).toBeNull();
    expect(window.__xss).toBeUndefined();
}

describe('kpi', () => {
    beforeEach(() => {
        document.body.innerHTML = '<p data-kpi="x"></p><p data-kpi-sub="x"></p>';
    });

    it('escreve o valor como texto', () => {
        D.kpi('x', TAG, TAG);
        const valor = document.querySelector('[data-kpi="x"]');
        semElementoDoDado(document.body);
        expect(valor.textContent).toBe(TAG);
        expect(document.querySelector('[data-kpi-sub="x"]').textContent).toBe(TAG);
    });

    it('a unidade entra num <small> montado pelo DOM', () => {
        D.kpi('x', '83', 'Presença no ano letivo', '%');
        const valor = document.querySelector('[data-kpi="x"]');
        expect(valor.textContent).toBe('83%');
        expect(valor.querySelector('small').textContent).toBe('%');
    });
});

describe('pendencias', () => {
    function hrefs(itens) {
        document.body.innerHTML = '<ul id="lista"></ul>';
        D.pendencias('lista', itens);
        semElementoDoDado(document.getElementById('lista'));
        return Array.from(document.querySelectorAll('#lista a')).map((a) => a.getAttribute('href'));
    }

    it('rótulo e contagem aparecem como texto', () => {
        hrefs([{ rotulo: TAG, valor: TAG, href: 'secretaria/justificativas.html' }]);
        const pill = document.querySelector('.pn-pill-alerta');
        expect(pill.textContent).toBe(TAG);
        expect(document.querySelector('.pn-pend-txt').textContent).toBe(TAG);
    });

    it('mantém os links relativos e as âncoras dos painéis', () => {
        expect(
            hrefs([
                { rotulo: 'a', valor: 1, href: 'secretaria/justificativas.html' },
                { rotulo: 'b', valor: 0, href: '../detalhes/avaliacoes.html' },
                { rotulo: 'c', valor: null, href: '#pnFrequenciaTurmas' },
            ])
        ).toEqual([
            'secretaria/justificativas.html',
            '../detalhes/avaliacoes.html',
            '#pnFrequenciaTurmas',
        ]);
    });

    it.each([
        'javascript:alert(1)',
        ' JavaScript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        '//outro-host.test/x',
        'https://outro-host.test/x',
        '',
        undefined,
    ])('troca %p por "#"', (href) => {
        expect(hrefs([{ rotulo: 'a', valor: 1, href }])).toEqual(['#']);
    });
});
