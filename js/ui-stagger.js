/**
 * ui-stagger.js — Entradas escalonadas (stagger) para listas e grids.
 *
 * Uso: adicione o atributo `data-stagger` no container. Os filhos diretos
 * entram em cascata (fadeInUp) quando o container aparece na tela.
 *
 * Características:
 *  - Sem dependências.
 *  - Funciona para containers escondidos (display:none) que só aparecem via JS:
 *    a animação dispara quando o elemento realmente entra no viewport.
 *  - Re-anima quando o conteúdo é injetado via JS (MutationObserver).
 *  - Sem limite de quantidade de itens (atraso via --stagger-i).
 *  - Respeita `prefers-reduced-motion` e degrada sem JS (CSS em variables.css).
 *
 * Opcional por container:
 *  - data-stagger-step="55"   -> passo do atraso em ms por item (padrão 55)
 *  - data-stagger-max="12"    -> nº máximo de índices antes de repetir (padrão 14)
 */
(function () {
    'use strict';

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Sem JS-gate quando o usuário pede movimento reduzido: nada é escondido.
    if (reduce) return;

    // Sinaliza para a CSS que o JS está presente (habilita o estado inicial oculto).
    document.documentElement.classList.add('stagger-ready');

    var STEP_DEFAULT = 55;
    var MAX_DEFAULT = 14;

    function indexChildren(container) {
        var step = parseInt(container.getAttribute('data-stagger-step'), 10) || STEP_DEFAULT;
        var max = parseInt(container.getAttribute('data-stagger-max'), 10) || MAX_DEFAULT;
        var children = container.children;
        for (var i = 0; i < children.length; i++) {
            // reinicia o passo após `max` itens para não acumular atrasos enormes
            children[i].style.setProperty('--stagger-i', (i % max));
            children[i].style.setProperty('animation-delay', ((i % max) * step) + 'ms');
        }
    }

    function reveal(container) {
        indexChildren(container);
        container.classList.add('in-view');
    }

    var io = ('IntersectionObserver' in window)
        ? new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    reveal(entry.target);
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.08, rootMargin: '0px 0px -5% 0px' })
        : null;

    function watchContent(container) {
        if (!('MutationObserver' in window)) return;
        var mo = new MutationObserver(function () {
            // Reindexa quando filhos são adicionados/removidos via JS.
            // Se já está visível, os novos nós animam na hora (regra .in-view).
            indexChildren(container);
            if (!container.classList.contains('in-view') && isVisible(container)) {
                reveal(container);
            }
        });
        mo.observe(container, { childList: true });
    }

    function isVisible(el) {
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 &&
            r.top < (window.innerHeight || document.documentElement.clientHeight) &&
            r.bottom > 0;
    }

    function register(container) {
        if (container.__staggerReady) return;
        container.__staggerReady = true;
        indexChildren(container);
        watchContent(container);
        if (io) {
            io.observe(container);
        } else {
            reveal(container); // fallback: revela imediatamente
        }
    }

    function scan(root) {
        (root || document).querySelectorAll('[data-stagger]').forEach(register);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { scan(); });
    } else {
        scan();
    }

    // Exposto para páginas que carregam containers dinamicamente depois.
    window.UIStagger = { scan: scan, refresh: register };
})();
