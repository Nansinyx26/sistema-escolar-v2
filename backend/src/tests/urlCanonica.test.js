/**
 * urlCanonica.test.js — barras repetidas na URL
 *
 * `https://host//html/<area>/pagina.html` entregava o HTML (o servidor
 * normaliza o caminho), mas o NAVEGADOR não normaliza: os `<link
 * href="../../css/x.css">` sobem dois níveis a partir de `//html/<area>/` e
 * viram `//css/x.css` — protocol-relative, ou seja, OUTRO HOST. A página abria
 * sem estilo nenhum.
 */
const request = require('supertest');
const app = require('../app');

describe('URL canônica: barras repetidas', () => {
    it('redireciona //html/... para /html/...', async () => {
        const res = await request(app).get('//html/dashboard.html');

        expect(res.status).toBe(308);
        expect(res.headers.location).toBe('/html/dashboard.html');
    });

    it('colapsa QUALQUER quantidade de barras, em qualquer posicao', async () => {
        const casos = [
            ['///html/dashboard.html', '/html/dashboard.html'],
            ['/html//dashboard.html', '/html/dashboard.html'],
            ['/html///secretaria//painel.html', '/html/secretaria/painel.html'],
        ];
        for (const [entrada, esperado] of casos) {
            const res = await request(app).get(entrada);
            expect(`${entrada} -> ${res.headers.location}`).toBe(`${entrada} -> ${esperado}`);
        }
    });

    it('preserva a query string', async () => {
        const res = await request(app).get('//html/login.html?next=%2Fhtml%2Fx.html');

        expect(res.headers.location).toBe('/html/login.html?next=%2Fhtml%2Fx.html');
    });

    it('o destino NUNCA e protocol-relative — nao leva para fora do dominio', async () => {
        // Sem o colapso, `Location: //evil.com/x` mandaria a pessoa para outro
        // host. O destino tem de comecar com exatamente uma barra.
        for (const entrada of [
            '//evil.com/x',
            '////evil.com',
            '//attacker.test/html/dashboard.html',
        ]) {
            const res = await request(app).get(entrada);
            const loc = res.headers.location || '';
            expect(`${entrada}: ${loc.slice(0, 2)}`).not.toBe(`${entrada}: //`);
            if (loc) expect(loc.startsWith('/')).toBe(true);
        }
    });

    it('URL sem barra repetida segue intacta', async () => {
        // Página pública de propósito: o que se verifica aqui é que o colapso
        // NÃO age quando não há barra sobrando. Usar uma página com gate de
        // perfil (o dashboard, que este teste usava) misturaria o 302 do
        // controle de acesso com o 308 do colapso — e o teste passaria a falhar
        // por um motivo que não é o dele.
        const res = await request(app).get('/html/login.html');
        expect(res.status).toBe(200);
    });

    it('o gate continua valendo depois do redirect — area restrita nao vaza', async () => {
        // O redirect nao pode virar um caminho alternativo para dentro da area.
        const res = await request(app).get('//html/admin/usuarios.html');

        expect(res.status).toBe(308);
        // Seguindo o redirect, cai no gate normalmente.
        const seguido = await request(app).get(res.headers.location);
        expect([302, 404]).toContain(seguido.status);
        expect(seguido.text || '').not.toContain('Administrador</option>');
    });
});
