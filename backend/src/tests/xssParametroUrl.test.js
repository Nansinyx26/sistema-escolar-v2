/**
 * @jest-environment jsdom
 */

/**
 * xssParametroUrl.test.js — Issue #645
 *
 * Três parâmetros de URL entravam no HTML sem escape: bastava mandar o link
 * para rodar script no navegador de quem o abrisse.
 *   - `?chat=` (conversas, dashboard, direção): o id virava parte de ~25
 *     atributos `id="…_<id>"` da janela de conversa;
 *   - `?turma=` / `?prof=` (direcao/horario-jaguari.html): o id ia para a
 *     mensagem "Turma não encontrada";
 *   - `?turma=` (html/turma.html): o id ia para o cabeçalho do modal de notas.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const PAYLOAD_ATRIBUTO = 'x"><img src=x onerror="window.__xss=1">';
const PAYLOAD_TEXTO = '<img src=x onerror="window.__xss=1">';

/** Texto de `function nome(...) { ... }` dentro do arquivo. */
function textoDaFuncao(rel, nome) {
    const src = fonte(rel);
    const inicio = src.indexOf(`function ${nome}(`);
    if (inicio < 0) throw new Error(`${rel} não declara ${nome}`);
    let profundidade = 0;
    let fim = src.indexOf('{', inicio);
    for (; fim < src.length; fim++) {
        if (src[fim] === '{') profundidade++;
        if (src[fim] === '}' && --profundidade === 0) break;
    }
    return src.slice(inicio, fim + 1);
}

afterEach(() => {
    delete window.__xss;
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
});

describe('?chat= — janela de conversa', () => {
    const resposta = (corpo) =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(corpo) });

    beforeEach(() => {
        jest.resetModules();
        global.fetch = jest.fn((url) =>
            String(url).includes('/chat-direto/historico/')
                ? resposta({ success: true, data: [], hasMore: false })
                : resposta({ success: true, data: [] })
        );
        window.fetch = global.fetch;
        window.socket = { on: jest.fn() };
        window.matchMedia = () => ({
            matches: false,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
        });
        sessionStorage.setItem('currentUser', JSON.stringify({ id: 'eu-mesmo' }));
    });

    afterEach(() => {
        delete global.fetch;
        delete window.socket;
        delete window.chatManager;
        delete window.abrirChatCom;
        sessionStorage.clear();
        localStorage.clear();
    });

    async function abrirComUrl(busca) {
        window.history.replaceState({}, '', `/html/conversas.html${busca}`);
        document.body.innerHTML = '<div id="chatWindowsContainer"></div>';
        require(path.join(RAIZ, 'js', 'chat-direto-manager.js'));
        for (let i = 0; i < 5; i++) {
            await Promise.resolve();
            await new Promise((r) => setTimeout(r, 0));
        }
    }

    it('id com aspas e tag não abre janela nem cria elemento', async () => {
        await abrirComUrl(`?chat=${encodeURIComponent(PAYLOAD_ATRIBUTO)}`);

        expect(document.querySelector('img')).toBeNull();
        expect(document.querySelectorAll('.chat-window')).toHaveLength(0);
        expect(window.__xss).toBeUndefined();
        // O parâmetro sai da barra de endereços mesmo recusado.
        expect(window.location.search).toBe('');
    });

    it('id no formato de id continua abrindo a conversa', async () => {
        await abrirComUrl('?chat=65f0000000000000000000a1');
        expect(document.querySelectorAll('.chat-window')).toHaveLength(1);
    });

    it('a mesma regra vale para quem chama abrirChatCom', async () => {
        await abrirComUrl('');
        window.abrirChatCom(PAYLOAD_ATRIBUTO, { nome: 'X' });
        window.abrirChatCom('prof-1', { nome: 'Ana Lima' });
        expect(document.querySelector('img')).toBeNull();
        expect(document.querySelectorAll('.chat-window')).toHaveLength(1);
    });
});

describe('?turma= / ?prof= — direcao/horario-jaguari', () => {
    const turmasData = { '6A': null };
    let gerarTabelaHTML;
    beforeAll(() => {
        const corpo = ['textoHorario', 'gerarTabelaHTML']
            .map((n) => textoDaFuncao('direcao/horario-jaguari.js', n))
            .join('\n');
        // eslint-disable-next-line no-new-func
        gerarTabelaHTML = new Function('turmasData', `${corpo}\nreturn gerarTabelaHTML;`)(
            turmasData
        );
    });

    it.each([
        ['tag', PAYLOAD_TEXTO],
        ['aspas e tag', PAYLOAD_ATRIBUTO],
    ])('id com %s aparece como texto na mensagem de turma não encontrada', (_caso, id) => {
        document.body.innerHTML = `<div id="c">${gerarTabelaHTML(id)}</div>`;
        const c = document.getElementById('c');
        expect(c.querySelector('img')).toBeNull();
        expect(c.textContent).toBe(`Turma não encontrada: ${id}`);
        expect(window.__xss).toBeUndefined();
    });

    it.each(['constructor', '__proto__', 'toString'])(
        '"%s" não acha o protótipo do objeto',
        (id) => {
            expect(gerarTabelaHTML(id)).toContain('Turma não encontrada');
        }
    );
});

describe('?turma= — modal de notas de html/turma.html', () => {
    it('o id da turma no cabeçalho passa pelo escHtml', () => {
        const src = fonte('js/app.js');
        // biome-ignore lint/suspicious/noTemplateCurlyInString: é o texto do template no código-fonte.
        expect(src).toContain('<p>Turma ${escHtml(turmaId)} - ${escHtml(bimestre)}º Bimestre</p>');
        expect(src).not.toMatch(/Turma \$\{turmaId\}/);
    });
});
