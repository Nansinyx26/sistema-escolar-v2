/**
 * smoke.spec.ts — as páginas públicas sobem sem erro.
 *
 * É o teste mais barato que existe e pega a classe de defeito mais comum neste
 * projeto: caminho relativo quebrado, script 404, erro de JS na carga. Com 66
 * páginas servidas por caminhos diferentes (raiz, html/, html/secretaria/,
 * html/admin/), errar um `../` é fácil e passa despercebido até alguém abrir.
 */

import { expect, type Page, test } from '@playwright/test';

/** Páginas públicas — não passam pelo `protegerAreasRestritas`. */
const PAGINAS_PUBLICAS = [
    { caminho: '/', nome: 'landing' },
    { caminho: '/html/login.html', nome: 'login do aluno' },
    { caminho: '/html/login-professor.html', nome: 'login do professor' },
    { caminho: '/html/login-secretaria.html', nome: 'login da secretaria' },
    { caminho: '/html/login-diretor.html', nome: 'login da direção' },
    { caminho: '/html/escolher-perfil.html', nome: 'escolha de perfil' },
    { caminho: '/html/politica-privacidade.html', nome: 'política de privacidade' },
    { caminho: '/html/404.html', nome: 'página 404' },
];

/**
 * Coleta erros de console e falhas de rede da página.
 * Ignora ruído conhecido que não indica defeito.
 */
function coletarProblemas(page: Page) {
    const erros: string[] = [];

    const IGNORAR = [
        /favicon/i,
        /ResizeObserver loop/i,
        /Failed to load resource.*(analytics|gtag|fonts\.googleapis)/i,
        // Sem backend de verdade, chamadas de API falham — esperado no smoke.
        /\/api\//i,
    ];

    const relevante = (texto: string) => !IGNORAR.some((re) => re.test(texto));

    page.on('console', (msg) => {
        if (msg.type() === 'error' && relevante(msg.text())) {
            erros.push(`console: ${msg.text()}`);
        }
    });

    page.on('pageerror', (err) => {
        if (relevante(err.message)) erros.push(`pageerror: ${err.message}`);
    });

    page.on('requestfailed', (req) => {
        const url = req.url();
        // Só recursos locais: falha de CDN externo não é defeito nosso.
        if (relevante(url) && url.includes('127.0.0.1')) {
            erros.push(`requestfailed: ${url}`);
        }
    });

    return erros;
}

for (const pagina of PAGINAS_PUBLICAS) {
    test(`${pagina.nome} carrega sem erro de console`, async ({ page }) => {
        const problemas = coletarProblemas(page);

        const resposta = await page.goto(pagina.caminho, { waitUntil: 'domcontentloaded' });

        expect(resposta?.status(), `status de ${pagina.caminho}`).toBeLessThan(400);

        // `domcontentloaded` não garante que o defer já rodou.
        await page.waitForLoadState('load');

        expect(problemas, `problemas em ${pagina.caminho}`).toEqual([]);
    });
}

test('o sistema de motion carrega em toda página pública', async ({ page }) => {
    for (const pagina of PAGINAS_PUBLICAS) {
        await page.goto(pagina.caminho, { waitUntil: 'load' });

        const carregado = await page.evaluate(() => typeof (window as any).Motion !== 'undefined');

        expect(carregado, `Motion ausente em ${pagina.caminho}`).toBe(true);
    }
});

test('o coletor de erros de frontend carrega antes do motion', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });

    // A ordem importa: os dois são `defer`, então executam na ordem do
    // documento. O coletor precisa estar escutando antes do motion rodar.
    const ordem = await page.evaluate(() => {
        const srcs = Array.from(document.querySelectorAll('script[src]')).map(
            (s) => (s as HTMLScriptElement).src
        );
        return {
            observability: srcs.findIndex((s) => s.includes('observability.js')),
            motion: srcs.findIndex((s) => s.includes('motion.js')),
        };
    });

    expect(ordem.observability).toBeGreaterThanOrEqual(0);
    expect(ordem.motion).toBeGreaterThanOrEqual(0);
    expect(ordem.observability).toBeLessThan(ordem.motion);
});

test('página inexistente devolve 404 e não vaza stack', async ({ page }) => {
    const resposta = await page.goto('/html/pagina-que-nao-existe.html');

    expect(resposta?.status()).toBe(404);

    const corpo = await page.content();
    expect(corpo).not.toMatch(/at\s+\w+\s+\(.*:\d+:\d+\)/); // stack trace
    expect(corpo).not.toContain('node_modules');
});
