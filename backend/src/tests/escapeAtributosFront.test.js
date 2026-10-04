/**
 * @jest-environment jsdom
 */

/**
 * escapeAtributosFront.test.js — Issue #582
 *
 * O sanitizador do backend codifica `&`, `<` e `>`, mas deixa as aspas cruas.
 * O front montava `alt="${p.nome}"`, `value="${p.nome}"`, `src="${aluno.foto}"`
 * e, no chatbot, `onclick="selectOption('${label}')"` com valor do banco: uma
 * aspa fechava o atributo e, com `script-src-attr 'unsafe-inline'` na CSP, o
 * resto virava handler executável. O caso confirmado era a tela de salas: o
 * professor edita o próprio nome e o script roda no navegador do diretor.
 * Desde o épico #612 (Issue #618) o chatbot põe o rótulo em `data-*`,
 * escapado por `attrHtml`; o caso abaixo cobre a mesma garantia.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

// Valores como chegam do servidor: aspas cruas, `&` já codificado.
const NOME_MALICIOSO = 'Prof" onerror="window.__xss=1" data-x="';
const NOME_APOSTROFO = "Maria D'Ávila";
const NOME_COM_E = 'Pedro &amp; Maria';

/** Extrai `function nome(...) { ... }` do arquivo e devolve a função. */
function extrairFuncao(rel, nome) {
    const src = fonte(rel);
    const inicio = src.indexOf(`function ${nome}(`);
    if (inicio < 0) throw new Error(`${rel} não declara ${nome}`);
    let profundidade = 0;
    let fim = src.indexOf('{', inicio);
    for (; fim < src.length; fim++) {
        if (src[fim] === '{') profundidade++;
        if (src[fim] === '}' && --profundidade === 0) break;
    }
    // eslint-disable-next-line no-new-func
    return new Function(`${src.slice(inicio, fim + 1)}\nreturn ${nome};`)();
}

/** Nenhum elemento do container ganhou handler de evento nem atributo extra. */
function semAtributoInjetado(container) {
    for (const el of container.querySelectorAll('*')) {
        for (const attr of el.getAttributeNames()) {
            expect(attr).not.toBe('onerror');
            expect(attr).not.toBe('data-x');
        }
    }
}

afterEach(() => {
    delete window.__xss;
    document.body.innerHTML = '';
});

describe('escapeAttr / escAttr', () => {
    const COPIAS = [
        'js/app.js',
        'js/selecionar.js',
        'js/cadastro-aluno.js',
        'js/gerenciar-salas.js',
        'js/perfil.js',
        'js/autorizacoes-alunos.js',
        'js/chatbot-ia.js',
    ];

    beforeAll(() => {
        require(path.join(RAIZ, 'js/escape-html.js'));
    });

    const casos = [
        ['aspas duplas', 'a"b', 'a&quot;b'],
        ['aspas simples', "a'b", 'a&#39;b'],
        ['menor e maior', '<b>', '&lt;b&gt;'],
        ['crase', 'a`b', 'a&#96;b'],
        ['& já codificado pelo servidor fica intacto', NOME_COM_E, NOME_COM_E],
        ['nulo vira vazio', null, ''],
        ['número', 7, '7'],
    ];

    it.each(casos)('escapeAttr global: %s', (_nome, entrada, esperado) => {
        expect(window.escapeAttr(entrada)).toBe(esperado);
    });

    it.each(COPIAS)('a cópia local em %s escapa igual ao escapeAttr', (rel) => {
        const escAttr = extrairFuncao(rel, 'escAttr');
        for (const [, entrada, esperado] of casos) {
            expect(escAttr(entrada)).toBe(esperado);
        }
    });

    it('valor escapado num atributo volta igual ao que o servidor mandou', () => {
        for (const valor of [NOME_MALICIOSO, NOME_APOSTROFO, NOME_COM_E]) {
            const div = document.createElement('div');
            div.innerHTML = `<input value="${window.escapeAttr(valor)}">`;
            const input = div.querySelector('input');
            expect(input.getAttributeNames()).toEqual(['value']);
            // O navegador decodifica `&amp;` no atributo — como já fazia antes.
            expect(input.value).toBe(valor.replace('&amp;', '&'));
        }
    });
});

describe('attrHtml do chatbot (rótulo em data-*, Issue #618)', () => {
    let attrHtml;
    beforeAll(() => {
        attrHtml = extrairFuncao('js/chatbot-ia.js', 'attrHtml');
    });

    it.each([
        ['aspas duplas', 'Ana "Bia" Souza'],
        ['aspa simples', "Maria D'Ávila"],
        ['tentativa de fechar o atributo', NOME_MALICIOSO],
        ['entidade crua que decodificaria para aspa', 'x&quot; onerror=&quot;window.__xss=1'],
        ['& já codificado pelo servidor', NOME_COM_E],
        ['barra invertida', 'a\\b'],
    ])('%s chega intacto pelo dataset e não cria atributo', (_nome, valor) => {
        const div = document.createElement('div');
        div.innerHTML = `<button class="chatbot-option-btn" data-rotulo="${attrHtml(valor)}"></button>`;
        document.body.appendChild(div);
        const botao = div.querySelector('button');
        expect(botao.getAttributeNames()).toEqual(['class', 'data-rotulo']);
        expect(botao.dataset.rotulo).toBe(valor);
        expect(window.__xss).toBeUndefined();
    });
});

describe('telas que interpolavam valor do banco em atributo', () => {
    it('gerenciar-salas: nome e foto do professor não criam atributo', () => {
        document.body.innerHTML = '<div id="salasGrid"></div>';
        // biome-ignore lint/security/noGlobalEval: avalia o script como a página avalia (escopo global), para chamar a função de render real.
        window.eval(
            `${fonte('js/gerenciar-salas.js')}
            window.__salas = { definir: (l) => { todosProfessores = l; }, renderizarSalas };`
        );
        window.__salas.definir([
            {
                _id: 'p1',
                nome: NOME_MALICIOSO,
                foto: 'gridfs:000000000000000000000000" onerror="window.__xss=1',
                salaPrincipal: '1ºA',
            },
        ]);
        window.__salas.renderizarSalas();

        const grid = document.getElementById('salasGrid');
        semAtributoInjetado(grid);
        const img = grid.querySelector('.professor-avatar img');
        expect(img.getAttribute('alt')).toBe(NOME_MALICIOSO);
        delete window.__salas;
    });

    it('cadastro-aluno: pessoa autorizada a retirar não cria atributo e mantém o valor', () => {
        document.body.innerHTML = '<div id="listaAutorizadosRetirada"></div>';
        // biome-ignore lint/security/noGlobalEval: avalia o script como a página avalia (escopo global), para chamar a função de render real.
        window.eval(
            `${fonte('js/cadastro-aluno.js')}
            window.__cadastro = { addPessoaAutorizada };`
        );
        window.__cadastro.addPessoaAutorizada({
            nome: NOME_MALICIOSO,
            parentesco: NOME_APOSTROFO,
            telefone: '(11) 9" onfocus="window.__xss=1',
            documento: NOME_COM_E,
        });

        const lista = document.getElementById('listaAutorizadosRetirada');
        for (const input of lista.querySelectorAll('input')) {
            expect(input.hasAttribute('onfocus')).toBe(false);
        }
        semAtributoInjetado(lista);
        const [nome, parentesco, telefone, documento] = lista.querySelectorAll('input');
        expect(nome.value).toBe(NOME_MALICIOSO);
        expect(parentesco.value).toBe(NOME_APOSTROFO);
        expect(telefone.value).toBe('(11) 9" onfocus="window.__xss=1');
        expect(documento.value).toBe('Pedro & Maria');
        delete window.__cadastro;
    });
});
