/**
 * splash-guarda.spec.ts — a tela de carregamento sobrevive ao guarda de acesso.
 *
 * Nas páginas restritas, `js/guarda-acesso.js` esconde o `<html>` inteiro
 * enquanto confere a sessão em `/api/auth/me`. A splash mora dentro do `<html>`
 * e sumia junto: sem perfil no `sessionStorage` (aba nova, PWA reaberto) e com
 * a API lenta, ela nunca aparecia (Issue #442).
 *
 * O servidor não entrega página restrita sem sessão, então o HTML do dashboard
 * vem do disco. O guard e a splash são os arquivos que o servidor serve de
 * verdade. `/api/auth/me` nunca responde: o guard só sai de "verificando" pelo
 * próprio prazo, que é o cenário da API lenta levado ao limite.
 *
 * O teste não mede tempo. Um amostrador registra, a cada frame, o estado do
 * guard e da splash — assim o resultado não depende da velocidade da máquina.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Route, test } from '@playwright/test';

const PAGINA = '/html/dashboard.html';
const HTML = readFileSync(path.resolve('html', 'dashboard.html'), 'utf8');

type Amostra = { guarda: string | null; splashVisivel: boolean; corpoVisivel: boolean };

// O service worker recarrega a página ao assumir o controle, e a recarga
// levaria embora a página que o teste observa.
test.use({ serviceWorkers: 'block' });

test('a splash fica visível enquanto o guard verifica e só sai depois do veredito', async ({
    page,
}) => {
    await page.route(`**${PAGINA}`, (route) =>
        route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML })
    );

    // Só o guard e a splash rodam. Os demais scripts da tela (auth.js e cia.)
    // mandam para o login quando não há sessão — e a navegação levaria embora
    // a página que o teste observa antes do veredito.
    await page.route('**/*.js*', (route) => {
        const url = new URL(route.request().url());
        if (/\/js\/(guarda-acesso|splash-screen)\.js$/.test(url.pathname)) return route.continue();
        return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
    });

    let presa: Route | undefined;
    await page.route('**/api/auth/me', (route) => {
        presa = route;
    });

    await page.addInitScript(() => {
        const w = window as unknown as {
            __amostras: Amostra[];
            __guardaNaSaida: string | null | undefined;
        };
        w.__amostras = [];
        w.__guardaNaSaida = undefined;

        const amostrar = () => {
            const splash = document.getElementById('splashScreen');
            // Antes do splash-screen.css chegar o navegador não pinta nada (o
            // CSS do <head> bloqueia a renderização), então esses frames não
            // contam: `position: fixed` marca que o estilo da splash já vale.
            if (splash && document.body && getComputedStyle(splash).position === 'fixed') {
                const guarda = document.documentElement.getAttribute('data-guarda-acesso');
                w.__amostras.push({
                    guarda,
                    splashVisivel: getComputedStyle(splash).visibility === 'visible',
                    corpoVisivel: getComputedStyle(document.body).visibility === 'visible',
                });
                if (w.__guardaNaSaida === undefined && splash.classList.contains('splash-hidden')) {
                    w.__guardaNaSaida = guarda;
                }
            }
            if (w.__guardaNaSaida === undefined) requestAnimationFrame(amostrar);
        };
        requestAnimationFrame(amostrar);
    });

    await page.goto(PAGINA, { waitUntil: 'commit' });

    // O guard revela sozinho no prazo dele; a splash sai em seguida.
    await expect(page.locator('html')).toHaveAttribute('data-guarda-acesso', 'liberado', {
        timeout: 15_000,
    });
    await expect(page.locator('#splashScreen')).toBeHidden({ timeout: 15_000 });

    const { amostras, guardaNaSaida } = await page.evaluate(() => {
        const w = window as unknown as {
            __amostras: Amostra[];
            __guardaNaSaida: string | null | undefined;
        };
        return { amostras: w.__amostras, guardaNaSaida: w.__guardaNaSaida };
    });

    const verificando = amostras.filter((a) => a.guarda === 'verificando');
    expect(verificando.length, 'nenhum frame amostrado durante a verificação').toBeGreaterThan(0);

    // Durante a verificação: splash na tela, resto da página escondido.
    expect(verificando.filter((a) => !a.splashVisivel)).toEqual([]);
    expect(verificando.filter((a) => a.corpoVisivel)).toEqual([]);

    // A splash não começou a sair antes do veredito.
    expect(guardaNaSaida).toBe('liberado');

    await presa?.abort();
});
