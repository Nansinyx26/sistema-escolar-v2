/**
 * splashLogo.test.js — toda tela de carregamento mostra a logo do site.
 *
 * Issue #443: 56 páginas mostravam um ícone genérico (chapéu de formatura) com
 * "Sistema Escolar" e o nome da página, em vez da logo e de "Escola Jaguari /
 * Portal Educacional" da index.html. A marcação antiga vinha do
 * `inject-pwa-features.js`, então o teste cobre também o script — senão a
 * próxima injeção traria o ícone de volta.
 *
 * Issue #471: o sistema atende várias escolas, então a splash mostra a marca
 * "Sistema Escolar", não o nome de uma delas.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '../../..');

/** Trecho da splash: do `#splashScreen` até a barra de progresso. */
function blocoSplash(html) {
    const inicio = html.indexOf('<div id="splashScreen">');
    if (inicio < 0) return null;
    const fim = html.indexOf('splash-progress-container', inicio);
    return html.slice(inicio, fim < 0 ? undefined : fim);
}

const paginas = execSync("git ls-files '*.html'", { cwd: RAIZ })
    .toString()
    .trim()
    .split('\n')
    .map((rel) => ({ rel, bloco: blocoSplash(fs.readFileSync(path.join(RAIZ, rel), 'utf8')) }))
    .filter((p) => p.bloco);

describe('splash com a logo do site (Issue #443)', () => {
    it('encontra as páginas com splash', () => {
        expect(paginas.length).toBeGreaterThanOrEqual(62);
    });

    it.each(paginas.map((p) => [p.rel, p.bloco]))('%s mostra a logo', (rel, bloco) => {
        const src = bloco.match(/<div class="splash-logo">\s*<img[^>]*\ssrc="([^"]+)"/)?.[1];
        expect(src).toMatch(/img\/logo\.svg$/);

        // O caminho é resolvido como o navegador resolve, a partir da URL da
        // página: tem de cair num arquivo que existe, em qualquer nível de pasta.
        const { pathname } = new URL(src, `http://escola.test/${rel}`);
        expect(fs.existsSync(path.join(RAIZ, decodeURIComponent(pathname)))).toBe(true);

        expect(bloco).not.toMatch(/class="splash-logo">\s*<i /);
        expect(bloco).toMatch(/<h2 class="splash-title">Sistema Escolar<\/h2>/);
        expect(bloco).toMatch(/<p class="splash-subtitle">Portal Educacional<\/p>/);
    });

    it('o inject-pwa-features.js injeta a mesma marcação', () => {
        const script = fs.readFileSync(path.join(RAIZ, 'inject-pwa-features.js'), 'utf8');
        const bloco = blocoSplash(script);
        expect(bloco).toContain('src="/img/logo.svg"');
        expect(bloco).not.toContain('bi-mortarboard');
        expect(bloco).toContain('<h2 class="splash-title">Sistema Escolar</h2>');
        expect(bloco).toContain('<p class="splash-subtitle">Portal Educacional</p>');
    });
});
