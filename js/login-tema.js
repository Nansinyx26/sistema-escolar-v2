/**
 * login-tema.js — Botão de tema claro/escuro dos logins novos (#366)
 * O estado vive em js/theme.js (ThemeManager); aqui só se liga o clique.
 */
(function () {
    'use strict';

    function iniciar() {
        var botao = document.getElementById('lgTema');
        if (!botao) return;

        function rotular() {
            var claro = document.documentElement.getAttribute('data-theme') === 'light';
            botao.setAttribute('aria-pressed', String(claro));
            botao.setAttribute('aria-label', claro ? 'Usar tema escuro' : 'Usar tema claro');
        }

        botao.addEventListener('click', function () {
            if (window.ThemeManager) window.ThemeManager.toggle();
        });
        window.addEventListener('themechange', rotular);
        rotular();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
