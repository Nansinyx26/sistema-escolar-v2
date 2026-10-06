/**
 * @jest-environment jsdom
 */

/**
 * mensagensComoTexto.test.js — Issue #656
 *
 * `showToast`/`showModalAlert` (js/utils.js) e o toast, o título, os botões e
 * as mensagens de `confirm`/`alert`/`prompt` (js/ui.js) punham a mensagem crua
 * no innerHTML, e os chamadores passam `e.message`/`json.error` do servidor.
 * O levantamento dos chamadores não achou nenhum que passe marcação de
 * propósito: o padrão virou texto, e HTML só com `{ html: true }`.
 *
 * O texto segue a regra do #650: escapa < > e aspas sem recodificar o `&`,
 * para que "Pedro &amp; Maria" gravado pelo servidor e o que o chamador já
 * escapou continuem aparecendo certo.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const TAG = '<img src=x onerror="window.__xss=1">';

function semElementoDoDado(container) {
    expect(container.querySelector('img, script, svg, iframe')).toBeNull();
    for (const el of container.querySelectorAll('*')) {
        for (const attr of el.getAttributeNames()) expect(attr.startsWith('on')).toBe(false);
    }
    expect(window.__xss).toBeUndefined();
}

afterEach(() => {
    delete window.__xss;
    document.body.innerHTML = '';
});

describe('js/utils.js', () => {
    beforeAll(() => {
        require('../../../js/utils.js');
    });

    function toast(...args) {
        document.body.innerHTML = '<div id="toastContainer"></div>';
        window.utils.showToast(...args);
        return document.getElementById('toastContainer');
    }

    it('showToast mostra a mensagem do servidor como texto', () => {
        const c = toast(`Erro: ${TAG}`, 'error');
        semElementoDoDado(c);
        expect(c.querySelector('.toast-message').textContent).toBe(`Erro: ${TAG}`);
    });

    it('showToast não recodifica o & do servidor nem o texto já escapado', () => {
        expect(toast('Pedro &amp; Maria').querySelector('.toast-message').textContent).toBe(
            'Pedro & Maria'
        );
        expect(toast('&lt;b&gt;Ana').querySelector('.toast-message').textContent).toBe('<b>Ana');
    });

    it('showToast aceita marcação só com { html: true }', () => {
        const c = toast('<strong>Salvo</strong>', 'success', 3000, { html: true });
        expect(c.querySelector('.toast-message strong').textContent).toBe('Salvo');
    });

    it('showModalAlert mostra título e mensagem como texto', () => {
        window.utils.showModalAlert(TAG, `Atenção ${TAG}`, 'warning');
        const alerta = document.getElementById('customModalAlert');
        semElementoDoDado(alerta);
        expect(alerta.querySelector('h2').textContent).toBe(TAG);
        expect(alerta.querySelector('p').textContent).toBe(`Atenção ${TAG}`);
    });
});

describe('js/ui.js', () => {
    let ui;

    beforeAll(() => {
        jest.useFakeTimers();
        // Módulo ES (`export default ui`): roda o arquivo real devolvendo a instância.
        const src = fonte('js/ui.js').replace(/export default ui;\s*$/, 'return ui;');
        // eslint-disable-next-line no-new-func
        ui = new Function(src)();
    });

    afterAll(() => {
        jest.useRealTimers();
    });

    beforeEach(() => {
        // O afterEach limpa o body; o container antigo ficaria solto.
        ui.toastContainer = null;
        ui.modals.clear();
    });

    it.each(['showToast', 'success', 'error', 'warning', 'info'])(
        '%s mostra a mensagem como texto',
        (metodo) => {
            ui[metodo](`Erro ao salvar: ${TAG}`);
            const msg = document.querySelector('.toast-message');
            semElementoDoDado(document.body);
            expect(msg.textContent).toBe(`Erro ao salvar: ${TAG}`);
        }
    );

    it('toast aceita marcação só com { html: true }', () => {
        ui.showToast('<strong>ok</strong>', 'info', 3000, { html: true });
        expect(document.querySelector('.toast-message strong')).not.toBeNull();
    });

    it('confirm mostra mensagem, título e botões como texto', () => {
        ui.confirm(`Excluir "${TAG}"?`, { title: TAG, confirmText: TAG });
        const modal = document.getElementById('confirm-modal');
        semElementoDoDado(modal);
        expect(modal.querySelector('.modal-body p').textContent).toBe(`Excluir "${TAG}"?`);
        expect(modal.querySelector('.modal-title').textContent).toBe(TAG);
        expect(modal.querySelector('[data-action="confirm"]').textContent.trim()).toBe(TAG);
    });

    it('confirm aceita marcação só com { html: true }', () => {
        ui.confirm('Excluir <strong>Ana</strong>?', { html: true });
        expect(document.querySelector('#confirm-modal .modal-body strong')).not.toBeNull();
    });

    it('alert mostra mensagem e título como texto', () => {
        ui.alert(TAG, TAG);
        const modal = document.getElementById('alert-modal');
        semElementoDoDado(modal);
        expect(modal.querySelector('.modal-body p').textContent).toBe(TAG);
    });

    it('prompt mantém o valor padrão dentro do atributo', () => {
        const valor = '" autofocus data-x="1';
        ui.prompt(TAG, valor, TAG);
        const modal = document.getElementById('prompt-modal');
        semElementoDoDado(modal);
        const input = modal.querySelector('input');
        expect(input.value).toBe(valor);
        expect(input.hasAttribute('autofocus')).toBe(false);
        expect(input.hasAttribute('data-x')).toBe(false);
    });

    it('showModal continua aceitando HTML no content (corpo do modal)', () => {
        ui.showModal({
            id: 'modal-teste',
            title: TAG,
            content: '<form id="formTeste"><input id="campo"></form>',
            buttons: [{ text: TAG, action: 'ok' }],
        });
        const modal = document.getElementById('modal-teste');
        expect(modal.querySelector('#formTeste #campo')).not.toBeNull();
        expect(modal.querySelector('.modal-title').textContent).toBe(TAG);
        expect(modal.querySelector('img')).toBeNull();
    });
});

describe('toasts próprios que recebiam o erro do servidor', () => {
    it.each(['js/register.js', 'html/termo-audio-imagem.html', 'direcao/direcao-notificacoes.js'])(
        '%s não põe a mensagem crua no innerHTML',
        (rel) => {
            expect(fonte(rel)).not.toMatch(/innerHTML = `[^`]*\$\{msg\}/);
        }
    );
});
