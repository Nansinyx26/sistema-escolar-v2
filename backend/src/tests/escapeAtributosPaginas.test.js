/**
 * @jest-environment jsdom
 */

/**
 * escapeAtributosPaginas.test.js — Issue #583
 *
 * Mesmo problema da #582, nas páginas de detalhes, direção e admin:
 *   - detalhes/alunos.js: o nome do documento enviado pelo responsável entrava
 *     num onclick só com `'` trocado por `\'` — a `"` fechava o atributo no
 *     navegador da secretaria — e voltava cru no title/alt da pré-visualização;
 *   - html/admin/auditoria.html: `dispositivo` é o cabeçalho
 *     `sec-ch-ua-platform`, que qualquer cliente HTTP manda como quiser, e ia
 *     cru para o innerHTML da auditoria do admin;
 *   - html/admin/usuarios.html: o e-mail entrava em onclick entre aspas simples.
 *     Desde o épico #612 (Issue #616) os argumentos vão em atributos `data-*`,
 *     escapados por `attrHtml`; o caso abaixo cobre a mesma garantia.
 * Desde o épico #612 (Issue #618) os argumentos de detalhes/alunos.js também
 * vão em `data-*` com `attrHtml`. Sem handler inline em nenhuma das duas
 * páginas, o caso do `argJs` saiu.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const NOME_MALICIOSO = 'RG" onerror="window.__xss=1" data-x="';
const NOME_APOSTROFO = "Certidão D'Ávila.pdf";
const NOME_COM_E = 'Pedro &amp; Maria';

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

/**
 * Monta as funções nomeadas do arquivo num escopo isolado e devolve a última.
 * Serve também para ES module (detalhes/alunos.js), que não dá para avaliar
 * inteiro fora do navegador.
 */
function extrairFuncao(rel, ...nomes) {
    const corpo = nomes.map((n) => textoDaFuncao(rel, n)).join('\n');
    // eslint-disable-next-line no-new-func
    return new Function(`${corpo}\nreturn ${nomes[nomes.length - 1]};`)();
}

afterEach(() => {
    delete window.__xss;
    document.body.innerHTML = '';
});

describe('cópias locais de escAttr', () => {
    const casos = [
        ['aspas duplas', 'a"b', 'a&quot;b'],
        ['aspas simples', "a'b", 'a&#39;b'],
        ['menor e maior', '<b>', '&lt;b&gt;'],
        ['& já codificado pelo servidor fica intacto', NOME_COM_E, NOME_COM_E],
        ['nulo vira vazio', null, ''],
    ];

    it.each([
        'detalhes/alunos.js',
        'detalhes/turmas.js',
        'direcao/direcao-notificacoes.js',
        'html/admin/auditoria.html',
    ])('%s escapa como o escapeAttr', (rel) => {
        const escAttr = extrairFuncao(rel, 'escAttr');
        for (const [, entrada, esperado] of casos) {
            expect(escAttr(entrada)).toBe(esperado);
        }
    });
});

describe('attrHtml de html/admin/usuarios.html (argumento em data-*, Issue #616)', () => {
    let attrHtml;
    beforeAll(() => {
        attrHtml = extrairFuncao('html/admin/usuarios.html', 'attrHtml');
    });

    it.each([
        ['aspas duplas', NOME_MALICIOSO],
        ['aspa simples', "x' data-acao='outra"],
        ['entidade crua que decodificaria para aspa', 'x&quot; data-acao=&quot;outra'],
        ['e-mail com apóstrofo', "o'brien@exemplo.test"],
    ])('%s chega intacto pelo dataset e não cria atributo', (_nome, valor) => {
        const div = document.createElement('div');
        div.innerHTML = `<button data-acao="excluirUsuario" data-email="${attrHtml(valor)}"></button>`;
        document.body.appendChild(div);
        const botao = div.querySelector('button');
        expect(botao.getAttributeNames()).toEqual(['data-acao', 'data-email']);
        expect(botao.dataset.acao).toBe('excluirUsuario');
        expect(botao.dataset.email).toBe(valor);
        expect(window.__xss).toBeUndefined();
    });
});

describe.each(['detalhes/alunos.js'])('attrHtml de %s (argumento em data-*, Issue #618)', (rel) => {
    let attrHtml;
    beforeAll(() => {
        attrHtml = extrairFuncao(rel, 'attrHtml');
    });

    it.each([
        ['aspas duplas', NOME_MALICIOSO],
        ['aspa simples', "x' data-acao='outra"],
        ['entidade crua que decodificaria para aspa', 'x&quot; data-acao=&quot;outra'],
        ['nome de documento com apóstrofo', NOME_APOSTROFO],
        ['& já codificado pelo servidor', NOME_COM_E],
    ])('%s chega intacto pelo dataset e não cria atributo', (_nome, valor) => {
        const div = document.createElement('div');
        div.innerHTML = `<button data-acao="verDocumento" data-nome="${attrHtml(valor)}"></button>`;
        document.body.appendChild(div);
        const botao = div.querySelector('button');
        expect(botao.getAttributeNames()).toEqual(['data-acao', 'data-nome']);
        expect(botao.dataset.acao).toBe('verDocumento');
        expect(botao.dataset.nome).toBe(valor);
        expect(window.__xss).toBeUndefined();
    });
});

describe('detalhes/alunos.js — pré-visualização de documento', () => {
    let abrirVisualizacaoDoc;
    beforeAll(() => {
        abrirVisualizacaoDoc = extrairFuncao(
            'detalhes/alunos.js',
            'escAttr',
            'abrirVisualizacaoDoc'
        );
    });

    function montarModal() {
        document.body.innerHTML = `
            <div id="modalVisualizarDoc" class="hidden">
                <h3 id="previewDocTitulo"></h3>
                <a id="previewDocDownloadBtn"></a>
                <div id="previewDocCorpo"></div>
            </div>`;
        return document.getElementById('previewDocCorpo');
    }

    it.each([
        ['imagem', 'image/png', 'img', 'alt'],
        ['PDF', 'application/pdf', 'iframe', 'title'],
    ])('%s: o nome do documento não cria atributo', (_tipo, mime, tag, attr) => {
        const corpo = montarModal();
        abrirVisualizacaoDoc('65f1a2b3c4d5e6f708192a3b', mime, NOME_MALICIOSO);
        const el = corpo.querySelector(tag);
        expect(el.hasAttribute('onerror')).toBe(false);
        expect(el.hasAttribute('data-x')).toBe(false);
        expect(el.getAttribute(attr)).toBe(NOME_MALICIOSO);
    });

    it('nome com apóstrofo aparece como veio', () => {
        const corpo = montarModal();
        abrirVisualizacaoDoc('65f1a2b3c4d5e6f708192a3b', 'application/pdf', NOME_APOSTROFO);
        expect(corpo.querySelector('iframe').getAttribute('title')).toBe(NOME_APOSTROFO);
    });

    it('o botão de visualizar não leva mais o nome com o escape antigo', () => {
        const src = fonte('detalhes/alunos.js');
        expect(src).not.toMatch(/abrirVisualizacaoDoc\('\$\{/);
        expect(src).not.toMatch(/nomeDocSafe/);
    });
});

describe('html/admin/auditoria.html — tabela de eventos', () => {
    it('todo campo do log interpolado no template passa por escAttr', () => {
        const html = fonte('html/admin/auditoria.html');
        const inicio = html.indexOf('tbody.innerHTML = json.data.map(');
        const fim = html.indexOf(".join('')", inicio);
        const template = html.slice(inicio, fim);
        const interpolacoes = template.match(/\$\{[^}]*log\.[^}]*\}/g) || [];
        expect(interpolacoes.length).toBeGreaterThan(0);
        for (const trecho of interpolacoes) {
            expect(trecho).toMatch(/^\$\{escAttr\(/);
        }
    });
});
