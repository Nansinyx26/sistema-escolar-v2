/**
 * js/theme.js
 * Controle de tema (Escuro / Claro) para todo o sistema.
 *
 * - Injeta a folha de estilo do tema claro (css/themes/light.css) em QUALQUER
 *   página, mesmo as que não carregam variables.css (ex.: a landing). Assim o
 *   modo claro funciona no sistema inteiro.
 * - Aplica o tema salvo o mais cedo possível para evitar "flash".
 * - Padrão: escuro. A escolha é persistida em localStorage.theme.
 * - Renderiza um botão flutuante (🌙 / ☀️).
 * - Troca o logo pela versão de modo claro quando aplicável.
 * - Idempotente: seguro se incluído/injetado mais de uma vez.
 */
(function () {
    'use strict';

    if (window.__themeControllerLoaded) return;
    window.__themeControllerLoaded = true;

    var STORAGE_KEY = 'theme';
    var DEFAULT_THEME = 'dark';

    // Caminho do próprio script, para resolver os assets relativos.
    // Fallbacks: base passada pelo click-sound.js → <script> existente → 'js/'.
    var meSrc = (document.currentScript && document.currentScript.src) || '';
    var jsDir = meSrc ? meSrc.replace(/[^/]*$/, '') : '';
    if (!jsDir && window.__assetJsBase) jsDir = window.__assetJsBase;
    if (!jsDir) {
        var known = document.querySelector(
            'script[src*="theme.js"], script[src*="click-sound.js"], script[src*="/js/"]'
        );
        if (known && known.src) jsDir = known.src.replace(/[^/]*$/, '');
    }
    if (!jsDir) jsDir = 'js/';
    var lightCssHref = jsDir + '../css/themes/light.css';
    var lightLogoHref = jsDir + '../img/logo-jaguari-light.svg';

    // ── 1. Garante a folha de estilo do tema claro na página ──────────────────
    (function ensureLightStylesheet() {
        // Já presente? (via @import não conta como <link>, então checamos <link>)
        var links = document.querySelectorAll('link[rel="stylesheet"]');
        for (var i = 0; i < links.length; i++) {
            if ((links[i].href || '').indexOf('themes/light.css') !== -1) return;
        }
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = 'theme-light-css';
        link.href = lightCssHref;
        (document.head || document.documentElement).appendChild(link);
    })();

    // ── 2. Aplicar / persistir tema ───────────────────────────────────────────
    function getSaved() {
        try {
            var v = localStorage.getItem(STORAGE_KEY);
            if (v === 'light' || v === 'dark') return v;
        } catch (e) {}
        return DEFAULT_THEME;
    }

    function current() {
        return document.documentElement.getAttribute('data-theme') || DEFAULT_THEME;
    }

    function apply(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) {}
        updateToggleUI();
        swapLogos(theme);
    }

    function toggle() {
        apply(current() === 'light' ? 'dark' : 'light');
    }

    // Aplica imediatamente (antes do DOM terminar) para não piscar.
    apply(getSaved());

    // ── 3. Troca de logo para o modo claro ────────────────────────────────────
    function swapLogos(theme) {
        var imgs = document.querySelectorAll('img[src*="logo-jaguari"]');
        imgs.forEach(function (img) {
            if (img.hasAttribute('data-logo-fixed')) return; // opt-out por imagem
            if (theme === 'light') {
                if (!img.dataset.logoDark) img.dataset.logoDark = img.getAttribute('src');
                img.setAttribute('src', lightLogoHref);
            } else if (img.dataset.logoDark) {
                img.setAttribute('src', img.dataset.logoDark);
            }
        });
    }

    // ── 4. Botão flutuante ────────────────────────────────────────────────────
    var toggleBtn = null;

    function updateToggleUI() {
        if (!toggleBtn) return;
        var light = current() === 'light';
        toggleBtn.textContent = light ? '🌙' : '☀️';
        var label = light ? 'Mudar para tema escuro' : 'Mudar para tema claro';
        toggleBtn.setAttribute('aria-label', label);
        toggleBtn.title = label;
    }

    // Estilos do botão via <style> injetado → permite media queries (mobile)
    // e respeita a safe-area (notch). Injetado uma única vez.
    function injectStyles() {
        if (document.getElementById('theme-toggle-style')) return;
        var st = document.createElement('style');
        st.id = 'theme-toggle-style';
        st.textContent = [
            '#theme-toggle-btn{',
            '  position:fixed;',
            /* fica à esquerda do botão de som (right:16 no click-sound.js),
               deslocado pela safe-area em telas com notch */
            '  top:calc(env(safe-area-inset-top,0px) + 12px);',
            '  right:calc(env(safe-area-inset-right,0px) + 60px);',
            '  z-index:2147483000;',
            '  width:44px;height:44px;',
            '  border-radius:50%;',
            '  border:1px solid var(--glass-border, rgba(255,255,255,0.15));',
            '  background:var(--glass-bg, rgba(20,20,25,0.6));',
            '  color:var(--text-primary, #fff);',
            '  font-size:20px;line-height:1;padding:0;',
            '  cursor:pointer;',
            '  display:flex;align-items:center;justify-content:center;',
            '  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);',
            '  box-shadow:var(--shadow-md, 0 2px 8px rgba(0,0,0,0.3));',
            '  opacity:0.72;',
            '  transition:opacity .2s, transform .15s;',
            '  -webkit-tap-highlight-color:transparent;',
            '  touch-action:manipulation;',
            '}',
            /* Hover só onde há mouse (desktop) */
            '@media (hover:hover){',
            '  #theme-toggle-btn:hover{opacity:1;transform:scale(1.08);}',
            '}',
            /* Feedback de toque no mobile */
            '#theme-toggle-btn:active{transform:scale(0.92);opacity:1;}',
            /* Celular: alvo de toque maior e sempre bem visível */
            '@media (max-width:640px){',
            '  #theme-toggle-btn{',
            '    width:46px;height:46px;font-size:22px;opacity:0.9;',
            '    top:calc(env(safe-area-inset-top,0px) + 10px);',
            '    right:calc(env(safe-area-inset-right,0px) + 58px);',
            '  }',
            '}',
            /* Movimento reduzido: sem escala */
            '@media (prefers-reduced-motion:reduce){',
            '  #theme-toggle-btn{transition:opacity .2s;}',
            '  #theme-toggle-btn:active,#theme-toggle-btn:hover{transform:none;}',
            '}'
        ].join('\n');
        (document.head || document.documentElement).appendChild(st);
    }

    function createToggle() {
        if (toggleBtn) return;
        injectStyles();
        toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.id = 'theme-toggle-btn';
        toggleBtn.setAttribute('data-click-sound', 'off');
        toggleBtn.addEventListener('click', toggle);

        document.body.appendChild(toggleBtn);
        updateToggleUI();
    }

    function onReady() {
        createToggle();
        swapLogos(current()); // aplica troca de logo quando o DOM já existe
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }

    // API pública.
    window.ThemeManager = {
        get: current,
        set: apply,
        toggle: toggle
    };
})();
