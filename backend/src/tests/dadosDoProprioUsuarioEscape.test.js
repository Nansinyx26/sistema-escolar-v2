/**
 * @jest-environment jsdom
 */

/**
 * dadosDoProprioUsuarioEscape.test.js — Issue #656
 *
 * Self-XSS: telas que punham no innerHTML o nome do arquivo que a própria
 * pessoa escolheu e os dados da própria sessão. Só ela vê, mas a regra do
 * projeto é a mesma — dado não entra cru no innerHTML.
 *
 *   - js/meus-dados.js: sessão, histórico de ações, pedidos LGPD e o toast;
 *   - js/cadastro-aluno.js: o log de auditoria da tela (nome do arquivo e erro
 *     do servidor);
 *   - js/ata.js e html/secretaria/importar-alunos.html: nome do arquivo.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');
const fonte = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const TAG = '<img src=x onerror="window.__xss=1">';

function semElementoDoDado(container) {
    expect(container.querySelector('img, script, svg, iframe')).toBeNull();
    expect(window.__xss).toBeUndefined();
}

async function assentar() {
    for (let i = 0; i < 20; i++) {
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }
}

function corpoDaPagina(rel) {
    const html = fonte(rel);
    const abertura = html.match(/<body[^>]*>/);
    const corpo = html.slice(abertura.index + abertura[0].length, html.indexOf('</body>'));
    return corpo.replace(/<script[\s\S]*?<\/script>/g, '');
}

afterEach(() => {
    delete window.__xss;
    delete global.fetch;
    document.body.innerHTML = '';
    sessionStorage.clear();
});

describe('js/meus-dados.js', () => {
    it('sessão, histórico e pedidos aparecem como texto', async () => {
        document.body.innerHTML = corpoDaPagina('html/meus-dados.html');
        sessionStorage.setItem(
            'currentUser',
            JSON.stringify({
                nome: `${TAG}Ana`,
                email: TAG,
                cpf: TAG,
                telefone: TAG,
                perfil: TAG,
                escola: TAG,
                disciplina: TAG,
            })
        );
        window.API_BASE_URL = '/api';
        global.fetch = jest.fn((url) => {
            const corpo = String(url).endsWith('/meus-dados/pedidos')
                ? { data: [{ protocolo: TAG, tipo: TAG, status: TAG }] }
                : String(url).endsWith('/meus-dados')
                  ? { historicoAcoes: [{ acao: TAG, recurso: TAG, descricao: TAG }] }
                  : { consentimento: {} };
            return Promise.resolve({ ok: true, json: () => Promise.resolve(corpo) });
        });

        jest.isolateModules(() => {
            require('../../../js/meus-dados.js');
        });
        await assentar();

        for (const id of ['dadosGrid', 'auditBody', 'pedidosBody']) {
            const el = document.getElementById(id);
            semElementoDoDado(el);
            expect(el.textContent).toContain(TAG);
        }
        expect(document.getElementById('dadosGrid').textContent).toContain(`${TAG}Ana`);
    });

    it('o toast não põe a mensagem crua no innerHTML', () => {
        expect(fonte('js/meus-dados.js')).not.toMatch(/<\/i> \$\{msg\}`/);
    });
});

describe('js/cadastro-aluno.js — log de auditoria', () => {
    /** Texto de `function nome(...) { ... }`. */
    function textoDaFuncao(rel, nome) {
        const src = fonte(rel);
        const inicio = src.indexOf(`function ${nome}(`);
        let profundidade = 0;
        let fim = src.indexOf('{', inicio);
        for (; fim < src.length; fim++) {
            if (src[fim] === '{') profundidade++;
            if (src[fim] === '}' && --profundidade === 0) break;
        }
        return src.slice(inicio, fim + 1);
    }

    it('nome do arquivo e erro do servidor entram como texto', () => {
        document.body.innerHTML =
            '<span id="auditCount"></span><table><tbody id="auditBody"></tbody></table>';
        const REL = 'js/cadastro-aluno.js';
        // eslint-disable-next-line no-new-func
        const addAudit = new Function(
            `let _auditCount = 0;\n${textoDaFuncao(REL, 'escAttr')}\n${textoDaFuncao(REL, 'addAudit')}\nreturn addAudit;`
        )();

        addAudit('documento adicionado', 'documentos', `${TAG}.pdf`, 'audit-action-edit');
        addAudit('erro no envio', 'formulário', `Erro: ${TAG}`, 'audit-action-edit');

        const tbody = document.getElementById('auditBody');
        semElementoDoDado(tbody);
        expect(tbody.textContent).toContain(`${TAG}.pdf`);
        expect(tbody.textContent).toContain(`Erro: ${TAG}`);
    });
});

describe('nome do arquivo escolhido', () => {
    it.each([
        ['js/ata.js', /<strong>\$\{(file|pdfCarregado)\.name\}<\/strong>/],
        ['html/secretaria/importar-alunos.html', /<\/i> \$\{file\.name\}<\/span>/],
    ])('%s não põe o nome cru no innerHTML', (rel, padrao) => {
        expect(fonte(rel)).not.toMatch(padrao);
    });
});
