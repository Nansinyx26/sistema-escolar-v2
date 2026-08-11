/**
 * cspHashesCrlf.test.js — o hash da CSP não pode depender do fim de linha.
 *
 * Contexto (Issue #27): em checkout Windows o Git grava CRLF. `cspHashes`
 * hasheava os bytes crus do disco, mas o parser HTML converte `\r\n` e `\r`
 * soltos em `\n` ANTES de o conteúdo virar o texto do script — então o browser
 * hasheia o texto já normalizado. Os dois valores divergiam, a CSP bloqueava
 * TODO script inline, e o sistema não abria na máquina de quem desenvolve.
 * Produção (Linux, LF) seguia normal, então o defeito nunca aparecia no CI.
 *
 * POR QUE `calcularHashes` E NÃO `obterHashes`:
 * `obterHashes` mantém um cache de módulo com janela de 2s que NÃO é indexado
 * pela raiz recebida. Duas chamadas seguidas com raízes diferentes devolvem o
 * mesmo resultado. Uma primeira versão destes testes usava `obterHashes` e
 * passava por causa disso — comparando um resultado consigo mesmo, sem
 * exercitar a normalização. Teste que passa pelo motivo errado é pior que
 * teste nenhum, então aqui se chama a função pura.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { calcularHashes } = require('../utils/cspHashes');

const SCRIPT = "const a = 1;\nconsole.log(a);\nif (a) {\n  console.log('ok');\n}";
const PAGINA = (corpo) =>
    `<!doctype html><html><head></head><body>\n<script>${corpo}</script>\n</body></html>`;

describe('hashes da CSP e fim de linha', () => {
    const raizes = [];

    afterAll(() => {
        for (const r of raizes) fs.rmSync(r, { recursive: true, force: true });
    });

    /** Escreve um HTML numa raiz temporária e devolve os hashes calculados. */
    function hashesDe(corpo) {
        const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-crlf-'));
        raizes.push(raiz);
        fs.writeFileSync(path.join(raiz, 'index.html'), PAGINA(corpo), 'utf8');
        return calcularHashes(raiz).hashes;
    }

    test('LF e CRLF produzem o mesmo hash', () => {
        const comLF = hashesDe(SCRIPT);
        const comCRLF = hashesDe(SCRIPT.replace(/\n/g, '\r\n'));

        expect(comLF).toHaveLength(1);
        expect(comCRLF).toHaveLength(1);

        // O coração da Issue #27. Se estes divergirem, a CSP bloqueia todo
        // script inline em qualquer checkout que use CRLF.
        expect(comCRLF).toEqual(comLF);
    });

    test('CR solto (estilo Mac clássico) também converge', () => {
        expect(hashesDe(SCRIPT.replace(/\n/g, '\r'))).toEqual(hashesDe(SCRIPT));
    });

    test('o hash é o do conteúdo normalizado — o mesmo que o browser calcula', () => {
        const esperado = `'sha256-${crypto
            .createHash('sha256')
            .update(SCRIPT, 'utf8')
            .digest('base64')}'`;

        // O browser hasheia o texto DEPOIS da normalização de quebras de linha
        // feita pelo parser (HTML Standard). Conferir contra o valor calculado
        // sobre LF prova que estamos hasheando a mesma coisa que ele.
        expect(hashesDe(SCRIPT.replace(/\n/g, '\r\n'))).toContain(esperado);
    });

    test('normaliza a quebra de linha, mas não apara espaços', () => {
        // Trim continuaria quebrando o match: o browser hasheia o conteúdo
        // exato entre as tags, incluindo indentação e bordas. A normalização
        // precisa ser cirúrgica.
        expect(hashesDe(`  \n${SCRIPT}\n  `)).not.toEqual(hashesDe(SCRIPT));
    });

    test('as páginas reais do projeto geram hashes bem formados', () => {
        // Regressão de integração: se o varredor parar de achar os HTML, a
        // lista vem vazia e a CSP bloqueia tudo — falha silenciosa idêntica
        // à da Issue #27, por outra causa.
        const raizFrontend = path.join(__dirname, '..', '..', '..');
        const { hashes } = calcularHashes(raizFrontend);

        expect(hashes.length).toBeGreaterThan(0);
        for (const h of hashes) {
            expect(h).toMatch(/^'sha256-[A-Za-z0-9+/]+=*'$/);
        }
    });
});
