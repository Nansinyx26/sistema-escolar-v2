/**
 * pwa-install.js
 * Gerencia a instalação do Progressive Web App (PWA) no Android e iOS.
 */
(function() {
    'use strict';

    let deferredPrompt;

    // Detecta se é iOS
    const isIOS = () => {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    };

    // Detecta se já está rodando como standalone (instalado)
    const isStandalone = () => {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    };

    // Escuta o evento de instalação do Chrome/Edge (Android/Desktop)
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        showInstallButton();
    });

    function showInstallButton() {
        if (isStandalone() || document.getElementById('pwa-install-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'pwa-install-btn';
        btn.innerHTML = '<i class="bi bi-download"></i> Instalar Aplicativo';
        btn.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;background:#10b981;color:#fff;border:none;padding:12px 20px;border-radius:24px;box-shadow:0 4px 12px rgba(0,0,0,0.3);cursor:pointer;font-weight:600;display:flex;align-items:center;gap:8px;font-family:Inter,sans-serif;';

        btn.onclick = async () => {
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                if (outcome === 'accepted') {
                    btn.remove();
                }
                deferredPrompt = null;
            } else if (isIOS()) {
                alert("Para instalar no iPhone/iPad:\n1. Toque no ícone de Compartilhar (quadrado com seta para cima).\n2. Selecione 'Adicionar à Tela de Início'.");
            }
        };

        document.body.appendChild(btn);
    }

    // Se for iOS e não estiver instalado, mostra o botão com instruções
    window.addEventListener('load', () => {
        if (isIOS() && !isStandalone()) {
            setTimeout(showInstallButton, 2000);
        }
    });

    // Registra o Service Worker globalmente
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js').then((reg) => {
                console.log('Service Worker registrado:', reg.scope);
            }).catch((err) => {
                console.error('Falha ao registrar Service Worker:', err);
            });
        });
    }
})();
