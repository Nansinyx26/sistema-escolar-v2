/**
 * js/theme.js
 * Controlador de tema — Dark por padrão, Claro opcional (opt-in).
 *
 * O sistema SEMPRE abre em modo escuro. O modo claro só é aplicado quando o
 * usuário o escolheu explicitamente (salvo em localStorage 'theme'). Como todo
 * o design consome variáveis CSS, alternar data-theme reveste o sistema todo.
 *
 * Observação: a mesma lógica é replicada (idempotente) em settings-drawer.js,
 * que é carregado em todas as páginas — este arquivo cobre as poucas páginas
 * que o incluem diretamente e serve de fonte canônica quando presente.
 */
(function () {
    'use strict';

    var KEY = 'theme';

    // Páginas com identidade fixa (ex.: landing neon-dark) declaram
    // data-theme-lock="dark" no <html>: ignoram a preferência na exibição,
    // mas a preferência salva continua valendo no restante do app.
    function lockedTheme() {
        var l = document.documentElement.getAttribute('data-theme-lock');
        return l === 'dark' || l === 'light' ? l : null;
    }

    function readTheme() {
        var lock = lockedTheme();
        if (lock) return lock;
        try {
            var v = localStorage.getItem(KEY);
            return v === 'light' || v === 'dark' ? v : 'dark';
        } catch (e) {
            return 'dark';
        }
    }

    function setMeta(theme) {
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#10b981');
    }

    function applyTheme(theme, persist) {
        theme = theme === 'light' ? 'light' : 'dark';
        if (persist) {
            try { localStorage.setItem(KEY, theme); } catch (e) {}
        }
        var effective = lockedTheme() || theme;
        document.documentElement.setAttribute('data-theme', effective);
        setMeta(effective);
        window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: effective } }));
        return effective;
    }

    // Aplica assim que o script é avaliado, minimizando o flash inicial.
    var current = readTheme();
    document.documentElement.setAttribute('data-theme', current);
    setMeta(current);

    // API pública. __real sinaliza que é o controlador de verdade, para que o
    // fallback em settings-drawer.js não o sobrescreva.
    if (!(window.ThemeManager && window.ThemeManager.__real)) {
        window.ThemeManager = {
            __real: true,
            get: readTheme,
            set: function (theme) { return applyTheme(theme, true); },
            toggle: function () { return applyTheme(readTheme() === 'light' ? 'dark' : 'light', true); }
        };
    }
})();
