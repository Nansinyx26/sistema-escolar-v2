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
    // escolher-perfil.html NÃO entra aqui: exige sessão e redireciona para o
    // login quando não há. Tratá-la como pública fazia o teste medir a página
    // errada. A cobertura dela pertence a um fluxo autenticado (Issue #14).
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

        // `waitForFunction` em vez de um `evaluate` único: ele reavalia até dar
        // certo e sobrevive a navegação, o que um evaluate solto não faz — se a
        // página redireciona ou o script `defer` ainda não rodou, o evaluate
        // falha por temporização e não por ausência do motion.
        let carregado = true;
        try {
            await page.waitForFunction(() => typeof (window as any).Motion !== 'undefined', null, {
                timeout: 8000,
            });
        } catch {
            carregado = false;
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

// O caminho saiu de `/html/...` para a raiz por causa da Issue #213: o gate de
// páginas passou a fechar por omissão DENTRO de `/html`, `/detalhes`,
// `/direcao` e `/graficos`, então um caminho inexistente sob um desses prefixos
// leva o anônimo ao login antes de chegar ao 404.
//
// Isso é de propósito, e é o mesmo raciocínio que já fazia o gate responder 404
// em vez de 403 nas áreas restritas: se "não existe" respondesse diferente de
// "existe e você não pode ver", a resposta viraria um oráculo de quais páginas
// o sistema tem. Uniformizar em redirecionamento fecha esse canal.
//
// A raiz não é prefixo de página, então continua exercitando exatamente o que
// este teste sempre guardou: o catch-all devolve o 404 amigável, sem stack.
test('página inexistente devolve 404 e não vaza stack', async ({ page }) => {
    const resposta = await page.goto('/qualquer-coisa-invalida.html');

    expect(resposta?.status()).toBe(404);

    const corpo = await page.content();
    expect(corpo).not.toMatch(/at\s+\w+\s+\(.*:\d+:\d+\)/); // stack trace
    expect(corpo).not.toContain('node_modules');
});

test('caminho inexistente sob /html não revela que a página não existe', async ({ page }) => {
    // Mesma resposta que uma página que EXISTE e é restrita — é essa igualdade
    // que impede enumerar o sistema pela diferença entre 404 e redirecionamento.
    await page.goto('/html/pagina-que-nao-existe.html');

    await expect(page).toHaveURL(/\/html\/login\.html$/);
});
