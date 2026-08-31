/**
 * paginasDeErroAssets.test.js — Issue #116
 *
 * `html/404.html` e `html/500.html` referenciavam os assets por caminho
 * relativo (`../css/...`). O Express devolve esses arquivos para QUALQUER URL
 * não resolvida, e o `../` é resolvido pelo navegador contra a URL DA
 * REQUISIÇÃO, não contra o caminho do arquivo no disco:
 *
 *     /html/qualquer-coisa   -> /css/base.css        ✅
 *     /a/b/c/qualquer-coisa  -> /a/b/css/base.css    ❌ 404
 *
 * Ou seja: a página de erro aparecia sem estilo nenhum justamente quando a
 * pessoa já estava numa situação ruim.
 */
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const RAIZ = path.join(__dirname, '../../..');
const PAGINAS = ['404.html', '500.html'];

describe('assets das páginas de erro (Issue #116)', () => {
    test.each(PAGINAS)('%s não tem nenhum caminho relativo de asset', (arquivo) => {
        const html = fs.readFileSync(path.join(RAIZ, 'html', arquivo), 'utf8');

        expect(html).not.toMatch(/href="\.\.\//);
        expect(html).not.toMatch(/src="\.\.\//);
    });

    test.each(PAGINAS)('todo asset de %s existe no caminho absoluto declarado', (arquivo) => {
        const html = fs.readFileSync(path.join(RAIZ, 'html', arquivo), 'utf8');
        const referencias = [...html.matchAll(/(?:href|src)="(\/[^"?]+)/g)].map((m) => m[1]);

        expect(referencias.length).toBeGreaterThan(0);
        const ausentes = referencias.filter((rel) => !fs.existsSync(path.join(RAIZ, rel)));
        expect(ausentes).toEqual([]);
    });

    test('a 404 servida numa URL profunda referencia os assets a partir da raiz', async () => {
        const app = require('../app');

        // A URL profunda é o caso que quebrava: com `../`, o navegador pediria
        // `/a/b/css/base.css`.
        const res = await request(app).get('/a/b/c/pagina-que-nao-existe');

        expect(res.status).toBe(404);
        expect(res.text).not.toMatch(/(?:href|src)="\.\.\//);
        expect(res.text).toMatch(/(?:href|src)="\/css\//);
    });
});
