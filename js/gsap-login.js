/**
 * gsap-login.js — Animações de entrada na tela de login
 * Usa GSAP 3 (carregado via vendor.js)
 *
 * SEGURO: Não usa opacity nas animações from() para evitar
 * que elementos fiquem invisíveis caso o GSAP carregue lento.
 * Usa apenas transforms (y, x, scale, rotation) + clearProps.
 */
(function () {
    'use strict';

    function waitForGSAP(cb) {
        if (window.gsap) { cb(); }
        else { setTimeout(function () { waitForGSAP(cb); }, 80); }
    }

    function runAnimations() {
        const gsap = window.gsap;

        gsap.defaults({ ease: 'power3.out' });

        const tl = gsap.timeline({ defaults: { duration: 0.5 } });

        // 1. Login card: sobe com spring
        tl.from('.login-card', {
            y: 50,
            scale: 0.96,
            duration: 0.65,
            ease: 'back.out(1.4)',
            clearProps: 'transform',
        }, 0);

        // 2. Logo: escala + rotação
        tl.from('.login-logo', {
            scale: 0.2,
            rotation: -160,
            duration: 0.55,
            ease: 'back.out(2)',
            clearProps: 'transform',
        }, 0.15);

        // 3. Título
        tl.from('.login-header h1', {
            x: -25,
            duration: 0.4,
            clearProps: 'transform',
        }, 0.35);

        // 4. Subtítulo
        tl.from('.login-header p', {
            x: -18,
            duration: 0.35,
            clearProps: 'transform',
        }, 0.45);

        // 5. Tabs — SEM opacity para não sumir
        tl.from('.login-tab', {
            y: -10,
            stagger: 0.07,
            duration: 0.3,
            ease: 'power2.out',
            clearProps: 'transform',
        }, 0.5);

        // 6. Campos do formulário
        tl.from('#login-tab .form-group', {
            y: 18,
            stagger: 0.08,
            duration: 0.4,
            clearProps: 'transform',
        }, 0.65);

        // 7. Opções (lembrar-me / esqueci)
        tl.from('#login-tab .login-options', {
            y: 8,
            duration: 0.3,
            clearProps: 'transform',
        }, 0.9);

        // 8. Botão submit — SEM opacity
        tl.from('#login-tab .btn-primary', {
            y: 12,
            scale: 0.97,
            duration: 0.35,
            ease: 'back.out(1.5)',
            clearProps: 'transform',
        }, 0.95);

        // 9. Pulso suave no logo (loop)
        tl.add(function () {
            gsap.to('.login-logo', {
                scale: 1.07,
                duration: 2.2,
                ease: 'sine.inOut',
                yoyo: true,
                repeat: -1,
            });
        });

        // Hover nos inputs: lift suave
        document.querySelectorAll('.form-input').forEach(function (input) {
            input.addEventListener('focus', function () {
                var group = this.closest('.input-group');
                if (group) gsap.to(group, { y: -2, duration: 0.2, ease: 'power2.out' });
            });
            input.addEventListener('blur', function () {
                var group = this.closest('.input-group');
                if (group) gsap.to(group, { y: 0, duration: 0.2, ease: 'power2.in' });
            });
        });

        // Hover no botão submit
        var submitBtn = document.querySelector('#login-tab .btn-primary');
        if (submitBtn) {
            submitBtn.addEventListener('mouseenter', function () {
                gsap.to(this, { scale: 1.03, duration: 0.15, ease: 'power2.out' });
            });
            submitBtn.addEventListener('mouseleave', function () {
                gsap.to(this, { scale: 1, duration: 0.15, ease: 'power2.in' });
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { waitForGSAP(runAnimations); });
    } else {
        waitForGSAP(runAnimations);
    }
})();
