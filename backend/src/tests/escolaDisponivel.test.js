/**
 * @jest-environment jsdom
 */

/**
 * escolaDisponivel.test.js — regra de escola disponível (#475).
 *
 * O login (js/login.js) e o modal de escolas da landing (js/escolas-modal.js)
 * decidem quem é selecionável só por `escola.ativo`. Antes a regra casava o
 * nome ("jaguari"/"mascellani"): uma segunda escola ativada no banco seguia
 * bloqueada, e uma inativa com "Jaguari" no nome era liberada.
 */

const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');

// Nomes fora de ordem alfabética, e a inativa carrega o termo que a regra
// antiga liberava pelo nome.
const ESCOLAS = [
    { _id: 'e3', nome: 'EMEF Vila Nova', ativo: true },
    { _id: 'e1', nome: 'EMEF Residencial Jaguari', ativo: false },
    { _id: 'e2', nome: 'CIEP Paulo Freire', ativo: true },
];

function respostaEscolas(escolas) {
    return jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: escolas.map((e) => ({ ...e })) }),
    });
}

const esperarPromessas = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
    delete global.fetch;
    delete window.showToast;
    localStorage.clear();
    window.history.replaceState(null, '', '/');
});

describe('js/login.js — seletor de escola', () => {
    function montar() {
        document.body.innerHTML = `
            <div id="loginEscolaGroup" style="display:none">
                <select id="loginEscola"></select>
            </div>`;
        let mod;
        jest.isolateModules(() => {
            mod = require(path.join(RAIZ, 'js', 'login.js'));
        });
        return mod;
    }

    const opcoes = () =>
        [...document.querySelectorAll('#loginEscola option')]
            .filter((o) => o.value)
            .map((o) => [o.value, o.disabled]);

    it('libera as duas ativas e bloqueia a inativa, sem olhar o nome', async () => {
        global.fetch = respostaEscolas(ESCOLAS);
        await montar().setupEscolaSelect();

        expect(opcoes()).toEqual([
            ['e2', false],
            ['e3', false],
            ['e1', true],
        ]);
        expect(document.getElementById('loginEscolaGroup').style.display).toBe('');
    });

    it('não escolhe escola por padrão quando há mais de uma ativa', async () => {
        global.fetch = respostaEscolas(ESCOLAS);
        await montar().setupEscolaSelect();

        expect(document.getElementById('loginEscola').value).toBe('');
    });

    it('pré-seleciona a única escola ativa', async () => {
        global.fetch = respostaEscolas([
            { _id: 'e1', nome: 'EMEF Residencial Jaguari', ativo: false },
            { _id: 'e3', nome: 'EMEF Vila Nova', ativo: true },
        ]);
        await montar().setupEscolaSelect();

        expect(document.getElementById('loginEscola').value).toBe('e3');
    });

    it('respeita a escola vinda do modal só se estiver ativa', async () => {
        global.fetch = respostaEscolas(ESCOLAS);
        window.history.replaceState(null, '', '/?escolaId=e3');
        await montar().setupEscolaSelect();
        expect(document.getElementById('loginEscola').value).toBe('e3');

        window.history.replaceState(null, '', '/?escolaId=e1');
        await montar().setupEscolaSelect();
        expect(document.getElementById('loginEscola').value).toBe('');
    });
});

describe('js/escolas-modal.js — modal "Escolas em Americana"', () => {
    async function montar(escolas) {
        document.body.innerHTML = `
            <div id="schoolSwitcherList"></div>
            <div class="marquee-inner"></div>`;
        global.fetch = respostaEscolas(escolas);
        jest.isolateModules(() => {
            require(path.join(RAIZ, 'js', 'escolas-modal.js'));
        });
        await esperarPromessas();
        return [...document.querySelectorAll('#schoolSwitcherList .school-list-item')];
    }

    it('ativas primeiro em ordem alfabética, cada uma com link para o login', async () => {
        const itens = await montar(ESCOLAS);

        expect(itens.map((i) => i.textContent.trim())).toEqual([
            'CIEP Paulo Freire',
            'EMEF Vila Nova',
            'EMEF Residencial Jaguari',
        ]);
        expect(itens[0].getAttribute('href')).toBe('/html/login.html?escolaId=e2');
        expect(itens[1].getAttribute('href')).toBe('/html/login.html?escolaId=e3');
    });

    it('bloqueia a inativa com aviso genérico, sem citar escola', async () => {
        window.showToast = jest.fn();
        const itens = await montar(ESCOLAS);
        const inativa = itens[2];

        expect(inativa.hasAttribute('href')).toBe(false);
        expect(inativa.getAttribute('aria-disabled')).toBe('true');
        inativa.click();
        expect(window.showToast).toHaveBeenCalledWith(
            'Esta escola ainda não está disponível no sistema.',
            'warning'
        );
    });
});
