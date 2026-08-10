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
        /\/api\//i,

        // Falha de carregamento de recurso vem ao console SEM a URL — só
        // "Failed to load resource: the server responded with a status of 401".
        // Várias destas páginas carregam auth.js/api-config.js, que consultam a
        // sessão assim que abrem; sem login, 401/403/404 são a resposta CORRETA
        // do servidor, não defeito. Filtrar por status evita transformar o
        // smoke num teste de autenticação — que é papel de outro arquivo.
        /Failed to load resource.*status of (401|403|404)/i,
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

// Um teste POR PÁGINA, e não um laço dentro de um teste só.
//
// Com o laço, uma página que redireciona via JS (auth.js manda para o login
// quando não há sessão) abortava o `goto` da página seguinte — net::ERR_ABORTED
// — e derrubava a verificação das outras sete. Cada teste com o seu próprio
// contexto elimina a interferência e diz exatamente qual página falhou.
for (const pagina of PAGINAS_PUBLICAS) {
    test(`${pagina.nome} carrega o sistema de motion`, async ({ page }) => {
        const resposta = await page.goto(pagina.caminho, { waitUntil: 'load' });

        expect(resposta?.status(), `status de ${pagina.caminho}`).toBeLessThan(400);

        // Se a página redirecionar durante o evaluate, o contexto é destruído.
        // Uma tentativa extra depois da navegação assentar resolve, e o motion
        // acaba conferido na página onde o usuário de fato termina.
        let carregado: boolean;
        try {
            carregado = await page.evaluate(() => typeof (window as any).Motion !== 'undefined');
        } catch {
            await page.waitForLoadState('load');
            carregado = await page.evaluate(() => typeof (window as any).Motion !== 'undefined');
        }

        const onde = new URL(page.url()).pathname;
        const destino = onde === pagina.caminho ? '' : ` (redirecionou para ${onde})`;

        expect(carregado, `window.Motion indefinido em ${pagina.caminho}${destino}`).toBe(true);
    });
}

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
