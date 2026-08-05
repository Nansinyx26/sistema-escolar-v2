/**
 * Parallax Mouse Effect - Sistema Escolar
 * Efeito de profundidade baseado no movimento do mouse
 */

(function () {
    'use strict';

    // Detecta se é touch device (desabilita parallax em mobile)
    const isTouchDevice = () => window.matchMedia('(pointer: coarse)').matches;

    // Configurações de intensidade por camada
    const LAYERS = {
        slow: 0.015,
        mid: 0.03,
        fast: 0.06,
        orb1: 0.025,
        orb2: -0.02,
        orb3: 0.018,
    };

    let mouseX = 0;
    let mouseY = 0;
    let currentX = 0;
    let currentY = 0;
    let ticking = false;

    // Elementos do parallax
    const orb1 = document.querySelector('.orb-1');
    const orb2 = document.querySelector('.orb-2');
    const orb3 = document.querySelector('.orb-3');
    const grid = document.querySelector('.parallax-grid');
    const loginCard = document.querySelector('.login-card');

    // Injeta orbs extras se ainda não existirem
    const loginBg = document.querySelector('.login-background');
    if (loginBg) {
        if (!document.querySelector('.orb-4')) {
            const orb4 = document.createElement('div');
            orb4.className = 'gradient-orb orb-4';
            loginBg.appendChild(orb4);
        }
        if (!document.querySelector('.orb-5')) {
            const orb5 = document.createElement('div');
            orb5.className = 'gradient-orb orb-5';
            loginBg.appendChild(orb5);
        }
    }

    // Smooth lerp (linear interpolation)
    function lerp(start, end, factor) {
        return start + (end - start) * factor;
    }

    // Aplica transform com GPU acceleration
    function applyTransform(el, x, y, factor) {
        if (!el) return;
        const tx = x * factor;
        const ty = y * factor;
        el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    }

    // Loop de animação suave
    function animateParallax() {
        // Smooth interpolation
        currentX = lerp(currentX, mouseX, 0.06);
        currentY = lerp(currentY, mouseY, 0.06);

        // Normaliza em relação ao centro da tela
        const hw = window.innerWidth / 2;
        const hh = window.innerHeight / 2;
        const nx = currentX - hw;
        const ny = currentY - hh;

        // Aplica movimento em cada orb (direções opostas criam profundidade)
        applyTransform(orb1, nx, ny, LAYERS.orb1);
        applyTransform(orb2, nx, ny, LAYERS.orb2);
        applyTransform(orb3, nx, ny, LAYERS.orb3);

        // Grid se move muito sutilmente
        if (grid) {
            applyTransform(grid, nx, ny, LAYERS.slow);
        }

        // Login card tilt: disabled per user request
        // if (loginCard) { ... }

        ticking = false;
        requestAnimationFrame(animateParallax);
    }

    // Listener de mouse (throttled via rAF)
    function onMouseMove(e) {
        mouseX = e.clientX;
        mouseY = e.clientY;
    }

    // Gyroscope para mobile (opcional)
    function onDeviceOrientation(e) {
        if (e.gamma === null) return;
        mouseX = window.innerWidth / 2 + (e.gamma / 45) * (window.innerWidth / 2);
        mouseY = window.innerHeight / 2 + (e.beta / 45) * (window.innerHeight / 4);
    }

    // Inicia tudo quando o DOM estiver pronto
    function init() {
        // Injeta grade de pontos
        if (!document.querySelector('.parallax-grid')) {
            const gridEl = document.createElement('div');
            gridEl.className = 'parallax-grid';
            document.body.prepend(gridEl);
        }

        // Injeta linha de destaque no topo
        if (!document.querySelector('.parallax-accent-line')) {
            const accentLine = document.createElement('div');
            accentLine.className = 'parallax-accent-line';
            document.body.prepend(accentLine);
        }

        if (!isTouchDevice()) {
            window.addEventListener('mousemove', onMouseMove, { passive: true });
        } else {
            // Mobile: usa giroscópio se disponível
            if (window.DeviceOrientationEvent) {
                window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
            }
        }

        // Inicia o loop de animação
        requestAnimationFrame(animateParallax);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
