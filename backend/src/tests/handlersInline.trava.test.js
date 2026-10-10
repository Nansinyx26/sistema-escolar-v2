/**
 * handlersInline.trava.test.js — Issues #613 e #619 (épico #612)
 *
 * A CSP tem `script-src-attr 'none'`: um `onclick="..."` no frontend não roda
 * no navegador — o botão fica morto em produção sem erro nenhum no servidor.
 * Esta trava pega o atributo antes do merge.
 */
const request = require('supertest');
const app = require('../app');
const { contar } = require('../../../scripts/handlers-inline');

describe('handlers inline (Issue #619)', () => {
    it('nenhum arquivo do frontend tem handler inline', () => {
        // Use `data-acao` (js/acoes.js) ou addEventListener no lugar do atributo.
        expect(contar()).toEqual({});
    });

    it.each(['/index.html', '/html/login.html', '/api/ping'])(
        '%s traz a CSP que bloqueia atributo de evento',
        async (caminho) => {
            const res = await request(app).get(caminho);

            const csp = res.headers['content-security-policy'];
            expect(csp).toContain("script-src-attr 'none'");
            expect(csp).not.toMatch(/script-src-attr[^;]*'unsafe-inline'/);
            expect(res.headers['content-security-policy-report-only']).toBeUndefined();
        }
    );
});
