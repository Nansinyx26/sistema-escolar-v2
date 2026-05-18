/**
 * vendor.js — Carregador seguro de bibliotecas externas
 * ─────────────────────────────────────────────────────
 * Carrega via CDN (sem build step):
 *   • GSAP 3        — animações avançadas de alto nível
 *   • Anime.js 3    — micro-animações e keyframes
 *   • Three.js r134 — gráficos e efeitos 3D
 *
 * Tailwind CSS e React/Framer Motion são injetados via
 * tags <script> estáticas no <head> de cada página para
 * garantir ordem de carregamento correta.
 *
 * Importante: Tailwind é configurado com preflight: false
 * para NÍO resetar os estilos existentes do sistema.
 */
(function () {
    'use strict';

    var CDN_SCRIPTS = [
        // GSAP 3 — TimelineMax, ScrollTrigger, etc.
        'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js',
        // Anime.js — micro-animações CSS e SVG
        'https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js',
        // Three.js — WebGL / 3D
        'https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js'
    ];

    function loadScript(src) {
        var s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onerror = function () {
            console.warn('[vendor.js] Falha ao carregar: ' + src);
        };
        document.head.appendChild(s);
    }

    CDN_SCRIPTS.forEach(loadScript);

    console.log('%c📦 Vendor libs carregando: GSAP | Anime.js | Three.js',
        'color:#6366f1;font-weight:bold;');
})();
