/**
 * acessibilidade.a11y.spec.ts — varredura automática WCAG 2.2 A/AA (Issue #536).
 *
 * Roda o axe-core nas páginas públicas — as que abrem sem sessão — e reprova
 * qualquer violação. São os critérios que a ABNT NBR 17225:2025 adota (ela é
 * baseada na WCAG 2.2), e a regressão mais comum aqui é silenciosa: um
 * `<label>` sem `for`, um botão só com ícone, um cinza "elegante" que cai
 * abaixo de 4,5:1.
 *
 * O QUE ESTE TESTE NÃO É: não é o laudo. O axe pega por volta de um terço dos
 * problemas de acessibilidade — o resto (ordem de leitura, sentido do texto
 * alternativo, uso com leitor de tela real) só aparece com gente testando.
 * Ver docs/CONFORMIDADE-LEGAL.md §3.
 *
 * As páginas autenticadas foram varridas na Issue #536 com sessão de cada
 * perfil; aqui entram só as públicas porque o e2e não tem usuário semeado.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const PAGINAS_PUBLICAS = [
    '/',
    '/html/login.html',
    '/html/login-professor.html',
    '/html/login-secretaria.html',
    '/html/login-diretor.html',
    '/html/politica-privacidade.html',
    '/html/primeiro-acesso.html',
    '/html/404.html',
    '/html/offline.html',
    '/html/pages/cadastro-docente.html',
    '/html/pages/cadastro-responsavel.html',
];

const CRITERIOS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// Na primeira visita o service worker assume o controle e a página recarrega
// (`controllerchange`): a splash volta depois de o teste já ter visto ela sair,
// e o axe mede o login através dela. O que se mede aqui é a página, não o PWA.
test.use({ serviceWorkers: 'block' });

for (const caminho of PAGINAS_PUBLICAS) {
    test(`${caminho} sem violação WCAG 2.2 A/AA`, async ({ page }) => {
        await page.goto(caminho, { waitUntil: 'load' });

        // A splash sai depois do `load`; medir com ela na tela é medir a
        // transição, não a página — o contraste sairia contra o véu dela.
        // Com a máquina carregada (CI, dois workers) a splash passa de 8 s;
        // medir com ela ainda saindo dá contraste falso em metade da página.
        await page.waitForFunction(() => !document.getElementById('splashScreen'), null, {
            timeout: 20_000,
        });

        // Entrada animada do conteúdo (motion.css): no meio do fade, o texto
        // está com opacidade parcial e o contraste medido é falso. Espera as
        // animações FINITAS acabarem — tempo fixo não serve, porque com a
        // máquina carregada (CI, dois workers) a entrada atrasa. As infinitas
        // (indicador de carregamento) ficam de fora, senão nunca terminaria.
        await page.evaluate(() =>
            Promise.race([
                Promise.all(
                    document
                        .getAnimations()
                        .filter(
                            (a) => a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY
                        )
                        .map((a) => a.finished.catch(() => undefined))
                ),
                new Promise((resolve) => setTimeout(resolve, 5000)),
            ])
        );

        const resultado = await new AxeBuilder({ page }).withTags(CRITERIOS).analyze();

        const resumo = resultado.violations.map((v) => ({
            regra: v.id,
            elementos: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
        }));
        expect(resumo, `violações em ${caminho}`).toEqual([]);
    });
}
