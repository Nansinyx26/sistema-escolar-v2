/**
 * js/theme.js
 * Controle de tema - Forçado para Modo Escuro (Dark Mode Only)
 */
(function () {
    'use strict';

    if (window.__themeControllerLoaded) return;
    window.__themeControllerLoaded = true;

    // Forçar modo escuro
    document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.setItem('theme', 'dark'); } catch (e) {}

    // API pública stub para evitar quebras se algo chamar ThemeManager.toggle()
    window.ThemeManager = {
        get: function() { return 'dark'; },
        set: function() {},
        toggle: function() {}
    };
})();
