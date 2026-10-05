/**
 * @jest-environment jsdom
 */

/**
 * acoesDelegacao.test.js — Issue #613 (épico #612)
 *
 * `js/acoes.js` é o substituto dos handlers inline: o HTML nomeia a ação em
 * `data-acao`, e só uma ação registrada roda.
 */
const Acoes = require('../../../js/acoes.js');

afterEach(() => {
    document.body.innerHTML = '';
    jest.restoreAllMocks();
});

describe('js/acoes.js', () => {
    it('clique em data-acao chama a ação registrada com o elemento', () => {
        const fn = jest.fn();
        Acoes.registrar('excluirTeste', fn);
        document.body.innerHTML =
            '<button data-acao="excluirTeste" data-id="42"><span>x</span></button>';

        document.querySelector('span').click();

        expect(fn).toHaveBeenCalledTimes(1);
        const [evento, alvo] = fn.mock.calls[0];
        expect(evento.type).toBe('click');
        expect(alvo.dataset.id).toBe('42');
        expect(fn.mock.instances[0]).toBe(alvo);
    });

    it('vale para HTML montado depois, por innerHTML', () => {
        const fn = jest.fn();
        Acoes.registrar('abrirDepois', fn);
        const lista = document.createElement('div');
        document.body.appendChild(lista);

        lista.innerHTML = '<a href="#" data-acao="abrirDepois">abrir</a>';
        lista.querySelector('a').click();

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('change, input e submit usam o atributo do próprio evento', () => {
        const aoMudar = jest.fn();
        const aoDigitar = jest.fn();
        const aoEnviar = jest.fn((e) => e.preventDefault());
        Acoes.registrar({ aoMudar, aoDigitar, aoEnviar });
        document.body.innerHTML = `
            <form data-acao-submit="aoEnviar">
                <select data-acao-change="aoMudar"><option>a</option></select>
                <input data-acao-input="aoDigitar">
            </form>`;

        document.querySelector('select').dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
        document
            .querySelector('form')
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

        expect(aoMudar).toHaveBeenCalledTimes(1);
        expect(aoDigitar).toHaveBeenCalledTimes(1);
        expect(aoEnviar).toHaveBeenCalledTimes(1);
    });

    it('ação não registrada não roda função global com o mesmo nome', () => {
        window.funcaoGlobalQualquer = jest.fn();
        const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {});
        document.body.innerHTML = '<button data-acao="funcaoGlobalQualquer">x</button>';

        document.querySelector('button').click();

        expect(window.funcaoGlobalQualquer).not.toHaveBeenCalled();
        expect(aviso).toHaveBeenCalled();
        delete window.funcaoGlobalQualquer;
    });

    it('recusa registro sem função', () => {
        expect(() => Acoes.registrar('semFuncao', 'texto')).toThrow(TypeError);
    });
});
