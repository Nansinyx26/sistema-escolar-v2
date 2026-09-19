/**
 * ui-painel.js — Comportamento do esqueleto dos painéis (épico #370)
 *
 * - Botão de tema do cabeçalho ([data-ui-tema]): o estado vive no
 *   ThemeManager de js/settings-drawer.js; aqui só se liga o clique.
 * - Menu da conta ([data-ui-menu]): abre e fecha por clique, Esc e clique
 *   fora; setas movem o foco entre os itens.
 * - Estado da barra lateral no botão hambúrguer (aria-expanded).
 *
 * Nome e cargo do cabeçalho vêm de window.PainelUI.preencherConta, chamado
 * por js/dashboard.js com a mesma leitura que escreve a barra lateral.
 */
(function () {
    'use strict';

    function ligarTema() {
        var botoes = document.querySelectorAll('[data-ui-tema]');
        if (!botoes.length) return;

        function rotular() {
            var claro = document.documentElement.getAttribute('data-theme') === 'light';
            botoes.forEach(function (b) {
                b.setAttribute('aria-pressed', String(claro));
                b.setAttribute('aria-label', claro ? 'Usar tema escuro' : 'Usar tema claro');
            });
        }

        botoes.forEach(function (b) {
            b.addEventListener('click', function () {
                if (window.ThemeManager) window.ThemeManager.toggle();
            });
        });
        window.addEventListener('themechange', rotular);
        rotular();
    }

    function ligarMenu(raiz) {
        var botao = raiz.querySelector('[aria-haspopup="menu"]');
        var menu = raiz.querySelector('[role="menu"]');
        if (!botao || !menu) return;

        function itens() {
            return Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]'));
        }

        function fechar(devolverFoco) {
            if (menu.hidden) return;
            menu.hidden = true;
            botao.setAttribute('aria-expanded', 'false');
            if (devolverFoco) botao.focus();
        }

        function abrir() {
            menu.hidden = false;
            botao.setAttribute('aria-expanded', 'true');
            var primeiro = itens()[0];
            if (primeiro) primeiro.focus();
        }

        botao.addEventListener('click', function (e) {
            e.stopPropagation();
            if (menu.hidden) abrir();
            else fechar(false);
        });

        menu.addEventListener('keydown', function (e) {
            var lista = itens();
            var i = lista.indexOf(document.activeElement);
            if (e.key === 'Escape') {
                e.preventDefault();
                fechar(true);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                lista[(i + 1) % lista.length].focus();
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                lista[(i - 1 + lista.length) % lista.length].focus();
            } else if (e.key === 'Tab') {
                fechar(false);
            }
        });

        menu.addEventListener('click', function () {
            fechar(false);
        });

        document.addEventListener('click', function (e) {
            if (!raiz.contains(e.target)) fechar(false);
        });
    }

    function ligarHamburguer() {
        var botao = document.getElementById('headerHamburger');
        var barra = document.getElementById('mainSidebar');
        if (!botao || !barra || !window.MutationObserver) return;
        new MutationObserver(function () {
            var aberta = barra.classList.contains('mobile-open');
            botao.setAttribute('aria-expanded', String(aberta));
            botao.setAttribute('aria-label', aberta ? 'Fechar menu' : 'Abrir menu');
        }).observe(barra, { attributes: true, attributeFilter: ['class'] });
    }

    // Cartão "Instalar o Sistema Escolar": o botão só aparece quando o
    // navegador oferece a instalação (js/pwa-install.js, window.PwaInstall).
    function ligarInstalar() {
        var botao = document.getElementById('pnInstalarBtn');
        var desc = document.getElementById('pnInstalarDesc');
        if (!botao || !desc) return;

        function atualizar() {
            var api = window.PwaInstall;
            if (api && api.instalado()) {
                botao.hidden = true;
                desc.textContent = 'O Sistema Escolar já está instalado neste aparelho.';
            } else if (api && api.disponivel()) {
                botao.hidden = false;
                desc.textContent = 'Acesso rápido, em tela cheia e sem depender do navegador.';
            } else {
                botao.hidden = true;
                desc.textContent =
                    'Para instalar, abra o sistema no Chrome, no Edge ou no Safari do celular.';
            }
        }

        botao.addEventListener('click', function () {
            if (window.PwaInstall) window.PwaInstall.instalar().then(atualizar);
        });
        window.addEventListener('pwa:disponivel', atualizar);
        window.addEventListener('pwa:instalado', atualizar);
        atualizar();
    }

    window.PainelUI = {
        preencherConta: function (nome, cargo) {
            document.querySelectorAll('[data-pn-nome]').forEach(function (el) {
                el.textContent = nome || '';
            });
            document.querySelectorAll('[data-pn-cargo]').forEach(function (el) {
                el.textContent = cargo || '';
            });
        },
    };

    function iniciar() {
        ligarTema();
        document.querySelectorAll('[data-ui-menu]').forEach(ligarMenu);
        ligarHamburguer();
        ligarInstalar();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
