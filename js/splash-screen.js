/**
 * splash-screen.js
 * Professional PWA Splash Screen Controller
 * Manages the splash screen lifecycle with progress simulation
 */
(function () {
    'use strict';

    // Don't run if no splash element
    const splash = document.getElementById('splashScreen');
    if (!splash) return;

    const progressBar = splash.querySelector('.splash-progress-bar');
    const progressText = splash.querySelector('.splash-progress-text');
    const messages = [
        'Inicializando sistema...',
        'Carregando módulos...',
        'Preparando interface...',
        'Conectando serviços...',
        'Quase pronto...'
    ];

    let progress = 0;
    let msgIndex = 0;

    function updateProgress(value) {
        progress = Math.min(value, 100);
        if (progressBar) progressBar.style.width = progress + '%';

        // Update message based on progress
        const newMsgIndex = Math.min(Math.floor(progress / 25), messages.length - 1);
        if (newMsgIndex !== msgIndex && progressText) {
            msgIndex = newMsgIndex;
            progressText.textContent = messages[msgIndex];
        }
    }

    // Simulate progress
    let interval = setInterval(function () {
        if (progress < 70) {
            updateProgress(progress + Math.random() * 12 + 3);
        } else if (progress < 90) {
            updateProgress(progress + Math.random() * 3 + 1);
        }
    }, 200);

    // Complete and hide splash
    function hideSplash() {
        clearInterval(interval);
        updateProgress(100);

        setTimeout(function () {
            splash.classList.add('splash-hidden');

            // Remove from DOM after animation
            setTimeout(function () {
                if (splash.parentNode) {
                    splash.parentNode.removeChild(splash);
                }
            }, 700);
        }, 400);
    }

    // Hide when page is fully loaded
    if (document.readyState === 'complete') {
        // Page already loaded
        setTimeout(hideSplash, 300);
    } else {
        window.addEventListener('load', function () {
            // Give a minimum display time of 1.2s for the splash to feel premium
            var elapsed = performance.now();
            var minTime = 1200;
            var remaining = Math.max(0, minTime - elapsed);
            setTimeout(hideSplash, remaining);
        });
    }

    // Safety: force hide after 5 seconds no matter what
    setTimeout(function () {
        if (splash && !splash.classList.contains('splash-hidden')) {
            hideSplash();
        }
    }, 5000);
})();
