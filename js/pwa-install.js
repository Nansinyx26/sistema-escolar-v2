/**
 * pwa-install.js
 * Registro do Service Worker, atualização inteligente e instalação do PWA
 * (Android/Chrome/Edge/Samsung Internet e instruções para iOS/Safari).
 */
(function () {
    'use strict';

    if (window.__pwaInstallLoaded) return;
    window.__pwaInstallLoaded = true;

    var DISMISS_KEY = 'pwa_install_dismissed_at';
    var DISMISS_DAYS = 7;
    var deferredPrompt = null;

    var isIOS = function () {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    };

    var isStandalone = function () {
        return window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true ||
            document.referrer.startsWith('android-app://');
    };

    var wasDismissedRecently = function () {
        try {
            var at = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
            if (!at) return false;
            return (Date.now() - at) < DISMISS_DAYS * 24 * 60 * 60 * 1000;
        } catch (e) {
            return false;
        }
    };

    // ---------- ESTILOS ----------
    function injectStyles() {
        if (document.getElementById('pwa-install-styles')) return;
        var style = document.createElement('style');
        style.id = 'pwa-install-styles';
        style.textContent = [
            '.pwa-install-bar{position:fixed;left:50%;transform:translateX(-50%) translateY(140%);',
            'bottom:calc(1rem + env(safe-area-inset-bottom));z-index:1200;display:flex;align-items:center;gap:.75rem;',
            'max-width:min(440px,calc(100vw - 2rem));padding:.7rem .7rem .7rem 1rem;border-radius:16px;',
            'background:#0a0a0c;border:1px solid rgba(16,185,129,.28);box-shadow:0 16px 40px rgba(0,0,0,.55);',
            'font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#fafafa;',
            'transition:transform 300ms cubic-bezier(.16,1,.3,1),opacity 300ms;opacity:0}',
            '.pwa-install-bar.show{transform:translateX(-50%) translateY(0);opacity:1}',
            '.pwa-install-bar__icon{width:38px;height:38px;flex-shrink:0;border-radius:10px;display:flex;',
            'align-items:center;justify-content:center;background:rgba(16,185,129,.12);color:#10b981;font-size:1.2rem}',
            '.pwa-install-bar__text{flex:1;min-width:0;line-height:1.35}',
            '.pwa-install-bar__title{display:block;font-size:.86rem;font-weight:600}',
            '.pwa-install-bar__sub{display:block;font-size:.74rem;color:#a1a1aa}',
            '.pwa-install-bar__btn{min-height:40px;padding:.5rem 1rem;border:none;border-radius:10px;',
            'background:#10b981;color:#04140e;font:inherit;font-size:.82rem;font-weight:700;cursor:pointer;',
            'transition:background-color 200ms}',
            '.pwa-install-bar__btn:hover{background:#0ea472}',
            '.pwa-install-bar__close{width:34px;height:34px;flex-shrink:0;border:none;border-radius:9px;',
            'background:rgba(255,255,255,.05);color:#a1a1aa;cursor:pointer;font-size:1rem;',
            'display:flex;align-items:center;justify-content:center;transition:background-color 200ms,color 200ms}',
            '.pwa-install-bar__close:hover{background:rgba(255,255,255,.1);color:#fafafa}',
            '.pwa-install-bar__btn:focus-visible,.pwa-install-bar__close:focus-visible{outline:2px solid #10b981;outline-offset:2px}',
            '@media (max-width:420px){.pwa-install-bar{left:1rem;right:1rem;transform:translateY(140%);max-width:none}',
            '.pwa-install-bar.show{transform:translateY(0)}}',
            '@media (prefers-reduced-motion:reduce){.pwa-install-bar{transition:none}}'
        ].join('');
        document.head.appendChild(style);
    }

    // ---------- BANNER DE INSTALAÇÃO ----------
    function showInstallBar() {
        if (isStandalone() || wasDismissedRecently()) return;
        if (document.getElementById('pwa-install-bar')) return;
        if (!document.body) return;

        injectStyles();

        var ios = isIOS();
        var bar = document.createElement('div');
        bar.id = 'pwa-install-bar';
        bar.className = 'pwa-install-bar';
        bar.setAttribute('role', 'region');
        bar.setAttribute('aria-label', 'Instalar aplicativo');
        bar.innerHTML =
            '<span class="pwa-install-bar__icon" aria-hidden="true"><i class="bi bi-phone"></i></span>' +
            '<span class="pwa-install-bar__text">' +
            '<strong class="pwa-install-bar__title">Instalar o Sistema Escolar</strong>' +
            '<span class="pwa-install-bar__sub">' +
            (ios ? 'Compartilhar → Adicionar à Tela de Início' : 'Acesso rápido, em tela cheia e offline') +
            '</span></span>' +
            '<button type="button" class="pwa-install-bar__btn" id="pwaInstallAction">' +
            (ios ? 'Como fazer' : 'Instalar') + '</button>' +
            '<button type="button" class="pwa-install-bar__close" id="pwaInstallClose" aria-label="Dispensar">' +
            '<i class="bi bi-x-lg" aria-hidden="true"></i></button>';

        document.body.appendChild(bar);
        requestAnimationFrame(function () { bar.classList.add('show'); });

        function hide(persist) {
            bar.classList.remove('show');
            if (persist) {
                try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (e) { /* noop */ }
            }
            setTimeout(function () { bar.remove(); }, 320);
        }

        document.getElementById('pwaInstallClose').addEventListener('click', function () { hide(true); });

        document.getElementById('pwaInstallAction').addEventListener('click', function () {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                deferredPrompt.userChoice.then(function (choice) {
                    if (choice && choice.outcome === 'accepted') hide(false);
                }).catch(function () { /* noop */ });
                deferredPrompt = null;
                return;
            }
            if (ios) showIosInstructions();
        });
    }

    function showIosInstructions() {
        var msg = 'Para instalar no iPhone/iPad:\n\n' +
            '1. Toque no botão Compartilhar (quadrado com seta para cima) na barra do Safari.\n' +
            '2. Role a lista e toque em "Adicionar à Tela de Início".\n' +
            '3. Confirme em "Adicionar".';
        if (window.Swal && typeof window.Swal.fire === 'function') {
            window.Swal.fire({
                title: 'Instalar aplicativo',
                html: msg.replace(/\n/g, '<br>'),
                icon: 'info',
                background: '#0a0a0c',
                color: '#fafafa',
                confirmButtonColor: '#10b981'
            });
        } else {
            alert(msg);
        }
    }

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferredPrompt = e;
        showInstallBar();
    });

    window.addEventListener('appinstalled', function () {
        deferredPrompt = null;
        var bar = document.getElementById('pwa-install-bar');
        if (bar) bar.remove();
    });

    // iOS não dispara beforeinstallprompt: mostra as instruções por conta própria.
    window.addEventListener('load', function () {
        if (isIOS() && !isStandalone()) setTimeout(showInstallBar, 2500);
    });

    // ---------- SERVICE WORKER + ATUALIZAÇÃO ----------
    function notifyUpdate(worker) {
        injectStyles();
        if (document.getElementById('pwa-update-bar')) return;

        var bar = document.createElement('div');
        bar.id = 'pwa-update-bar';
        bar.className = 'pwa-install-bar';
        bar.setAttribute('role', 'status');
        bar.innerHTML =
            '<span class="pwa-install-bar__icon" aria-hidden="true"><i class="bi bi-arrow-clockwise"></i></span>' +
            '<span class="pwa-install-bar__text">' +
            '<strong class="pwa-install-bar__title">Nova versão disponível</strong>' +
            '<span class="pwa-install-bar__sub">Recarregue para aplicar a atualização</span></span>' +
            '<button type="button" class="pwa-install-bar__btn" id="pwaUpdateAction">Atualizar</button>' +
            '<button type="button" class="pwa-install-bar__close" id="pwaUpdateClose" aria-label="Agora não">' +
            '<i class="bi bi-x-lg" aria-hidden="true"></i></button>';

        document.body.appendChild(bar);
        requestAnimationFrame(function () { bar.classList.add('show'); });

        document.getElementById('pwaUpdateClose').addEventListener('click', function () {
            bar.classList.remove('show');
            setTimeout(function () { bar.remove(); }, 320);
        });
        document.getElementById('pwaUpdateAction').addEventListener('click', function () {
            if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
            else window.location.reload();
        });
    }

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('/service-worker.js').then(function (reg) {
                // Já existe uma versão nova aguardando ativação.
                if (reg.waiting && navigator.serviceWorker.controller) notifyUpdate(reg.waiting);

                reg.addEventListener('updatefound', function () {
                    var incoming = reg.installing;
                    if (!incoming) return;
                    incoming.addEventListener('statechange', function () {
                        // 'installed' + controller existente = atualização (não primeira instalação).
                        if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
                            notifyUpdate(incoming);
                        }
                    });
                });

                // Procura atualizações ao voltar para a aba (no máximo 1x por hora).
                var lastCheck = Date.now();
                document.addEventListener('visibilitychange', function () {
                    if (document.visibilityState !== 'visible') return;
                    if (Date.now() - lastCheck < 60 * 60 * 1000) return;
                    lastCheck = Date.now();
                    reg.update().catch(function () { /* noop */ });
                });
            }).catch(function (err) {
                console.error('Falha ao registrar Service Worker:', err);
            });

            var refreshing = false;
            navigator.serviceWorker.addEventListener('controllerchange', function () {
                if (refreshing) return;
                refreshing = true;
                window.location.reload();
            });
        });
    }
})();
