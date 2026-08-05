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

    // Obter o caminho base onde o vendor.js está hospedado para carregar scripts locais na mesma pasta
    var scriptFolder = '';
    var currentScript = document.currentScript;
    if (currentScript && currentScript.src) {
        scriptFolder = currentScript.src.substring(0, currentScript.src.lastIndexOf('/') + 1);
    } else {
        scriptFolder = 'js/';
    }

    var LOCAL_SCRIPTS = [
        scriptFolder + 'gsap.min.js',
        scriptFolder + 'anime.min.js',
        scriptFolder + 'three.min.js'
    ];

    function loadScript(src) {
        var s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onerror = function () {
            console.warn('[vendor.js] Falha ao carregar script local: ' + src);
        };
        document.head.appendChild(s);
    }

    LOCAL_SCRIPTS.forEach(loadScript);

    console.log('%c📦 Vendor libs carregando: GSAP | Anime.js | Three.js (Locais)',
        'color:#6366f1;font-weight:bold;');
})();
