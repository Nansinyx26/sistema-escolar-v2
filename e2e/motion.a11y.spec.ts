/**
 * motion.a11y.spec.ts — o contrato de interface do AGENTS.md §8, verificado.
 *
 * Roda em dois projetos do Playwright:
 *   • chromium         → movimento ligado
 *   • reduced-motion   → `prefers-reduced-motion: reduce`
 *
 * Por que existe: `prefers-reduced-motion` é o tipo de regra que entra no CSS,
 * ninguém exercita, e quebra em silêncio na primeira refatoração. O risco real
 * não é a animação continuar rodando — é o conteúdo ficar preso no estado
 * inicial invisível e a página aparecer vazia para quem pediu menos movimento.
 */

import { expect, test } from '@playwright/test';

test.describe('lazy loading', () => {
    test('imagens abaixo da dobra são lazy; as de topo não', async ({ page }) => {
        await page.goto('/', { waitUntil: 'load' });

        const imagens = await page.evaluate(() =>
            Array.from(document.images).map((img, indice) => ({
                indice,
                loading: img.getAttribute('loading'),
                decoding: img.getAttribute('decoding'),
            }))
        );

        test.skip(imagens.length === 0, 'a landing não tem <img>');

        // Toda imagem decodifica fora da thread principal.
        for (const img of imagens) {
            expect(img.decoding, `img[${img.indice}] sem decoding`).toBe('async');
        }

        // Atrasar a imagem de topo pioraria o LCP — ela tem que ser eager.
        expect(imagens[0].loading).toBe('eager');

        // Da terceira em diante, lazy.
        for (const img of imagens.slice(2)) {
            expect(img.loading, `img[${img.indice}] deveria ser lazy`).toBe('lazy');
        }
    });
});

test.describe('sistema de motion', () => {
    test('a API pública está disponível', async ({ page }) => {
        await page.goto('/', { waitUntil: 'load' });

        const api = await page.evaluate(() => {
            const M = (window as any).Motion;
            if (!M) return null;
            return {
                temSkeleton: typeof M.skeleton === 'function',
                temReady: typeof M.ready === 'function',
                temProgress: typeof M.progress?.start === 'function',
                temBusy: typeof M.busy === 'function',
                temReveal: typeof M.reveal === 'function',
                enabled: M.enabled,
            };
        });

        expect(api).not.toBeNull();
        expect(api?.temSkeleton).toBe(true);
        expect(api?.temReady).toBe(true);
        expect(api?.temProgress).toBe(true);
        expect(api?.temBusy).toBe(true);
        expect(api?.temReveal).toBe(true);
    });

    test('skeleton entra e sai, devolvendo o conteúdo real', async ({ page }) => {
        await page.goto('/', { waitUntil: 'load' });

        const resultado = await page.evaluate(async () => {
            const M = (window as any).Motion;

            const alvo = document.createElement('div');
            alvo.id = 'alvo-teste';
            alvo.innerHTML = '<p>conteúdo original</p>';
            document.body.appendChild(alvo);

            M.skeleton(alvo, { preset: 'list', count: 3 });

            const durante = {
                loading: alvo.getAttribute('data-loading'),
                ariaBusy: alvo.getAttribute('aria-busy'),
                skeletons: alvo.querySelectorAll('.skeleton').length,
                // Skeleton não pode ser lido como conteúdo por leitor de tela.
                ocultoParaLeitor: !!alvo.querySelector('[aria-hidden="true"]'),
            };

            M.ready(alvo, '<p>conteúdo carregado</p>');

            const depois = {
                loading: alvo.getAttribute('data-loading'),
                ariaBusy: alvo.getAttribute('aria-busy'),
                skeletons: alvo.querySelectorAll('.skeleton').length,
                texto: alvo.textContent?.trim(),
            };

            alvo.remove();
            return { durante, depois };
        });

        expect(resultado.durante.loading).toBe('true');
        expect(resultado.durante.ariaBusy).toBe('true');
        expect(resultado.durante.skeletons).toBeGreaterThan(0);
        expect(resultado.durante.ocultoParaLeitor).toBe(true);

        expect(resultado.depois.loading).toBe('false');
        expect(resultado.depois.ariaBusy).toBe('false');
        expect(resultado.depois.skeletons).toBe(0);
        expect(resultado.depois.texto).toBe('conteúdo carregado');
    });

    test('só se anima transform, opacity, filter e clip-path', async ({ page }) => {
        await page.goto('/', { waitUntil: 'load' });

        // Varre as regras de motion.css procurando propriedade que causa
        // reflow numa transição. Ver AGENTS.md §8 regra 5.
        const proibidas = await page.evaluate(() => {
            const PROIBIDAS = [
                'width',
                'height',
                'top',
                'left',
                'right',
                'bottom',
                'margin',
                'padding',
            ];
            const achados: string[] = [];

            for (const folha of Array.from(document.styleSheets)) {
                let regras: CSSRuleList;
                try {
                    regras = folha.cssRules;
                } catch {
                    continue; // folha cross-origin
                }
                if (!folha.href?.includes('motion.css')) continue;

                for (const regra of Array.from(regras)) {
                    const estilo = (regra as CSSStyleRule).style;
                    if (!estilo) continue;

                    const prop = estilo.transitionProperty || '';
                    for (const proibida of PROIBIDAS) {
                        // Casa a propriedade inteira, não "width" dentro de "line-width".
                        if (new RegExp(`(^|[\\s,])${proibida}([\\s,]|$)`).test(prop)) {
                            achados.push(`${(regra as CSSStyleRule).selectorText}: ${prop}`);
                        }
                    }
                }
            }
            return achados;
        });

        expect(proibidas, 'transição em propriedade que causa reflow').toEqual([]);
    });
});

test.describe('prefers-reduced-motion', () => {
    test('conteúdo com data-reveal fica visível, não preso invisível', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/', { waitUntil: 'load' });

        const visibilidade = await page.evaluate(() => {
            const alvo = document.createElement('div');
            alvo.setAttribute('data-reveal', '');
            alvo.textContent = 'conteúdo revelável';
            document.body.appendChild(alvo);

            (window as any).Motion.reveal(document.body);

            const estilo = getComputedStyle(alvo);
            const resultado = {
                opacity: Number(estilo.opacity),
                filtro: estilo.filter,
            };
            alvo.remove();
            return resultado;
        });

        // A falha que este teste existe para pegar: opacity 0 permanente.
        expect(visibilidade.opacity).toBe(1);
        expect(visibilidade.filtro === 'none' || visibilidade.filtro === '').toBe(true);
    });

    test('o brilho do skeleton para, mas o placeholder continua', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/', { waitUntil: 'load' });

        const estado = await page.evaluate(() => {
            const el = document.createElement('div');
            el.className = 'skeleton skeleton-line';
            document.body.appendChild(el);

            const antes = getComputedStyle(el, '::after').animationName;
            const visivel = getComputedStyle(el).backgroundColor;

            el.remove();
            return { animacao: antes, fundo: visivel };
        });

        // Movimento em loop é justamente o que incomoda quem pediu redução.
        expect(estado.animacao === 'none' || estado.animacao === '').toBe(true);
        // Mas o placeholder precisa continuar indicando carregamento.
        expect(estado.fundo).not.toBe('rgba(0, 0, 0, 0)');
    });

    test('a página segue navegável com o movimento desligado', async ({ page }) => {
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto('/html/login.html', { waitUntil: 'load' });

        // Nada essencial pode depender de animação para aparecer.
        const camposVisiveis = await page.locator('input:visible, button:visible').count();

        expect(camposVisiveis).toBeGreaterThan(0);
    });
});
