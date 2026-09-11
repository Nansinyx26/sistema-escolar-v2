/**
 * paginasCsrfMutacoes.test.js — páginas que escrevem na API mandam o token CSRF.
 *
 * O `csrfValidator` não tem modo tolerante: POST/PUT/DELETE fora das rotas
 * isentas sem `X-CSRF-Token` recebe 403 e nada é gravado. Estas três páginas
 * montavam os headers à mão, sem o token, e não carregavam o helper — oito
 * chamadas quebradas, entre elas a anonimização (LGPD) e a troca obrigatória
 * de senha (Issue #265).
 *
 * Mesmo padrão de `paginaModeracao.test.js`: verifica o shell estático, não o
 * navegador. O que se garante é que nenhuma mutação volte a sair sem o token.
 */

const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '../../..');

const PAGINAS = [
    'html/admin/usuarios.html',
    'html/admin/codigos-escolas.html',
    'html/mudar-senha.html',
];

/** Trechos `fetch(...)` cujo objeto de opções declara um método de escrita. */
function mutacoes(html) {
    const trechos = [];
    for (const m of html.matchAll(/fetch\s*\(/g)) {
        // O objeto de opções termina no primeiro `});` depois do fetch.
        const fim = html.indexOf('});', m.index);
        const trecho = html.slice(m.index, fim === -1 ? undefined : fim + 3);
        if (/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i.test(trecho)) trechos.push(trecho);
    }
    return trechos;
}

describe.each(PAGINAS)('%s', (relativo) => {
    const html = fs.readFileSync(path.join(RAIZ, relativo), 'utf8');

    it('carrega o csrf-helper, e antes do script inline que o usa', () => {
        const helper = html.search(/<script\s+src="[^"]*js\/csrf-helper\.js"/);
        expect(helper).toBeGreaterThan(-1);

        // Primeiro <script> inline (sem src) que dispara fetch.
        const inline = [
            ...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi),
        ].find((b) => b[1].includes('fetch('));
        expect(inline).toBeDefined();
        expect(helper).toBeLessThan(inline.index);
    });

    it('o helper referenciado existe e define window.csrfHeaders', () => {
        const src = html.match(/<script\s+src="([^"]*js\/csrf-helper\.js)"/)[1];
        const arquivo = path.resolve(path.join(RAIZ, path.dirname(relativo)), src);
        expect(fs.existsSync(arquivo)).toBe(true);
        expect(fs.readFileSync(arquivo, 'utf8')).toContain('window.csrfHeaders');
    });

    it('toda mutação envia csrfHeaders() e credentials: include', () => {
        const lista = mutacoes(html);
        expect(lista.length).toBeGreaterThan(0);

        const semToken = lista.filter((t) => !/csrfHeaders\s*\(/.test(t));
        const semCookie = lista.filter((t) => !/credentials:\s*['"]include['"]/.test(t));
        expect(semToken).toEqual([]);
        expect(semCookie).toEqual([]);
    });

    it('não tem fallback silencioso que manda a requisição sem token', () => {
        // `window.csrfHeaders ? ... : { ... }` escondeu o defeito: sem o helper
        // carregado, caía sempre no ramo sem X-CSRF-Token.
        expect(html).not.toMatch(/csrfHeaders\s*\?/);
    });
});
