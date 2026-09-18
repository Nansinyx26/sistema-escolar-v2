/**
 * @jest-environment jsdom
 */

/**
 * loginPortais.test.js — login de professor, direção e secretaria (#366).
 *
 * Duas coisas estão travadas aqui:
 *
 * 1. As três páginas são o MESMO login com conteúdo diferente. Se uma delas
 *    ganhar Google, perder a aba de outro perfil ou a caixa de escola, o
 *    visual e o comportamento dos três portais voltam a divergir.
 * 2. A escola aparece na tela só pelo nome. O `_id` vai no `value` da opção
 *    e sai no POST /auth/login, mas nunca é desenhado — nem no seletor com
 *    busca (js/escola-combobox.js), nem no texto da opção (js/login.js).
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const PORTAIS = [
    ['html/login-professor.html', 'professor'],
    ['html/login-diretor.html', 'diretor'],
    ['html/login-secretaria.html', 'secretaria'],
];

describe('as três páginas de login', () => {
    it.each(PORTAIS)('%s usa a base visual nova e o perfil certo', (arquivo, perfil) => {
        const html = ler(arquivo);
        expect(html).toMatch(/<body class="ui3 ui-login">/);
        expect(html).toMatch(/href="\.\.\/css\/ui-base\.css/);
        expect(html).toMatch(/href="\.\.\/css\/ui-login\.css/);
        expect(html).toMatch(/src="\.\.\/js\/escola-combobox\.js"/);
        expect(html).toContain(`perfil: '${perfil}'`);
    });

    it.each(PORTAIS)('%s tem as três abas e marca só a própria', (arquivo) => {
        const doc = new DOMParser().parseFromString(ler(arquivo), 'text/html');
        const abas = [...doc.querySelectorAll('.lg-abas a')];

        expect(abas.map((a) => a.getAttribute('href'))).toEqual([
            'login-professor.html',
            'login-diretor.html',
            'login-secretaria.html',
        ]);
        const atuais = abas.filter((a) => a.getAttribute('aria-current') === 'page');
        expect(atuais).toHaveLength(1);
        expect(atuais[0].getAttribute('href')).toBe(path.basename(arquivo));
    });

    it.each(PORTAIS)('%s tem escola, e-mail, senha, lembrar-me e recuperar senha', (arquivo) => {
        const doc = new DOMParser().parseFromString(ler(arquivo), 'text/html');
        for (const id of [
            'loginEscola',
            'loginEmail',
            'loginPassword',
            'rememberMe',
            'forgotPasswordLink',
            'forgotPasswordModal',
            'modal2FA',
        ]) {
            expect(doc.getElementById(id)).not.toBeNull();
        }
        expect(doc.getElementById('loginEscola').hasAttribute('data-ui-combo')).toBe(true);
    });

    it.each(PORTAIS)('%s não oferece login com Google', (arquivo) => {
        const html = ler(arquivo);
        expect(html).not.toMatch(
            /accounts\.google\.com|gsi\/client|g_id_onload|google-login|loginGoogle/i
        );
    });
});

describe('js/login.js — texto da opção de escola', () => {
    it('não acrescenta sufixo nem identificador ao nome', () => {
        const fonte = ler('js/login.js');
        expect(fonte).toContain('opt.textContent = e.nome;');
        expect(fonte).not.toMatch(/\(Disponível\)|Em breve\)/);
    });
});

describe('js/escola-combobox.js', () => {
    const ESCOLAS = [
        ['64a1', 'CIEP Profª Maria Nilde Mascellani', false],
        ['64a5', 'EMEF Paulo Freire', false],
        ['64a6', 'EMEF São João', false],
        ['64a4', 'EMEF Vila Nova', true],
    ];

    function montar() {
        document.body.innerHTML = `
            <label for="loginEscola">Escola</label>
            <select id="loginEscola" data-ui-combo data-placeholder="Selecione sua escola">
                <option value="">Selecione sua escola</option>
            </select>`;
        const select = document.getElementById('loginEscola');
        for (const [id, nome, desabilitada] of ESCOLAS) {
            const o = document.createElement('option');
            o.value = id;
            o.textContent = nome;
            o.disabled = desabilitada;
            select.appendChild(o);
        }
        // O script é um IIFE que aprimora os selects do documento ao carregar:
        // um require isolado por teste roda de novo sobre o DOM recém-montado.
        jest.isolateModules(() => {
            require(path.join(RAIZ, 'js', 'escola-combobox.js'));
        });
        return select;
    }

    const tecla = (el, key) =>
        el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

    it('nunca desenha o id da escola', () => {
        montar();
        document.querySelector('.ui-combo-trigger').click();

        const visivel = document.querySelector('.ui-combo').textContent;
        for (const [id] of ESCOLAS) expect(visivel).not.toContain(id);
        expect(visivel).toContain('EMEF Paulo Freire');
    });

    it('busca sem acento, escolhe com Enter e grava o id no select', () => {
        const select = montar();
        const mudou = jest.fn();
        select.addEventListener('change', mudou);

        document.querySelector('.ui-combo-trigger').click();
        const busca = document.querySelector('.ui-combo-busca input');
        busca.value = 'PROFª MARIA';
        busca.dispatchEvent(new Event('input'));

        const opcoes = document.querySelectorAll('.ui-combo-opcao');
        expect(opcoes).toHaveLength(1);
        expect(opcoes[0].textContent).toBe('CIEP Profª Maria Nilde Mascellani');

        tecla(busca, 'Enter');
        expect(select.value).toBe('64a1');
        expect(mudou).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.ui-combo-valor').textContent).toBe(
            'CIEP Profª Maria Nilde Mascellani'
        );
        expect(document.querySelector('.ui-combo-trigger').getAttribute('aria-expanded')).toBe(
            'false'
        );
    });

    it('ignora acento na busca', () => {
        montar();
        document.querySelector('.ui-combo-trigger').click();
        const busca = document.querySelector('.ui-combo-busca input');
        busca.value = 'sao joao';
        busca.dispatchEvent(new Event('input'));

        const opcoes = [...document.querySelectorAll('.ui-combo-opcao')];
        expect(opcoes.map((o) => o.textContent)).toEqual(['EMEF São João']);
    });

    it('não deixa escolher escola desabilitada ("Em breve")', () => {
        const select = montar();
        document.querySelector('.ui-combo-trigger').click();
        const busca = document.querySelector('.ui-combo-busca input');
        busca.value = 'vila';
        busca.dispatchEvent(new Event('input'));

        const opcao = document.querySelector('.ui-combo-opcao');
        expect(opcao.getAttribute('aria-disabled')).toBe('true');
        expect(opcao.textContent).toContain('Em breve');

        opcao.click();
        tecla(busca, 'Enter');
        expect(select.value).toBe('');
    });

    it('Esc fecha e devolve o foco ao botão', () => {
        montar();
        const botao = document.querySelector('.ui-combo-trigger');
        botao.click();
        tecla(document.querySelector('.ui-combo-busca input'), 'Escape');

        expect(document.querySelector('.ui-combo-pop').hidden).toBe(true);
        expect(document.activeElement).toBe(botao);
    });
});
