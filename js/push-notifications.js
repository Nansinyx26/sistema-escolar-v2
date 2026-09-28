/**
 * push-notifications.js — "Modo notificações no celular"
 *
 * Garante que TODO aviso/notificação do sistema apareça na barra de
 * notificações do celular (mesmo com o app fechado), via Web Push + Service
 * Worker. Este módulo faz a parte que faltava no cliente:
 *
 *   1. Registra o Service Worker em qualquer página do portal.
 *   2. Se a permissão já foi concedida, reassina silenciosamente e mantém a
 *      inscrição do dispositivo sincronizada com o backend ("sempre ativo").
 *   3. Se a permissão ainda não foi decidida, mostra um aviso discreto com o
 *      botão "Ativar notificações no celular" (o pedido de permissão PRECISA
 *      partir de um clique — exigência de iOS/Safari).
 *
 * Backend usado (requer sessão autenticada):
 *   GET  /api/notifications/realtime/vapid-public-key
 *   POST /api/notifications/realtime/subscribe
 */
window.PushNotifications = (function () {
    'use strict';

    const API_BASE = (window.API_BASE_URL || '/api').replace(/\/$/, '');
    // Guarda ATÉ QUANDO o aviso fica escondido. Antes era '1' para sempre:
    // quem dispensava sem querer nunca mais recebia aviso no celular.
    const DISMISS_KEY = 'push_prompt_adiado_ate';
    const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

    function adiado() {
        try {
            return Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now();
        } catch (_) {
            return false;
        }
    }

    function adiar() {
        try {
            localStorage.setItem(DISMISS_KEY, String(Date.now() + SETE_DIAS_MS));
        } catch (_) {
            /* navegação privada: some só nesta visita */
        }
    }

    function apiUrl(path) {
        return `${API_BASE}${path}`;
    }

    function getCsrfToken() {
        if (window.getCookie) return window.getCookie('csrf_token');
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const output = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
        return output;
    }

    function mesmaChave(buffer, bytes) {
        if (!buffer) return false;
        const atual = new Uint8Array(buffer);
        if (atual.length !== bytes.length) return false;
        for (let i = 0; i < atual.length; i++) if (atual[i] !== bytes[i]) return false;
        return true;
    }

    const isSupported = () =>
        'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    // iOS/iPadOS só entrega push quando o site está instalado (Adicionar à Tela
    // de Início) e rodando em modo standalone (iOS 16.4+).
    // iPadOS 13+ se apresenta como Mac; o toque denuncia.
    const isIOS = () =>
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const isStandalone = () =>
        window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;

    async function getRegistration() {
        // Registra o SW aqui também: em páginas internas ele pode não ter sido
        // registrado ainda (antes só era registrado nas telas de login).
        try {
            await navigator.serviceWorker.register('/service-worker.js');
        } catch (_) {
            /* já registrado ou indisponível — segue para o ready */
        }
        return navigator.serviceWorker.ready;
    }

    async function fetchVapidKey() {
        const res = await fetch(apiUrl('/notifications/realtime/vapid-public-key'), {
            credentials: 'include',
        });
        if (!res.ok) return null; // 401 = sem sessão; não insiste
        const json = await res.json();
        return json && json.success ? json.publicKey : null;
    }

    async function saveSubscription(subscription) {
        const res = await fetch(apiUrl('/notifications/realtime/subscribe'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfToken() || '',
            },
            credentials: 'include',
            body: JSON.stringify(subscription),
        });
        // Confirma que o backend realmente persistiu a inscrição no banco.
        if (!res.ok) {
            throw new Error('O servidor não confirmou o salvamento da inscrição de push.');
        }
        return res.json().catch(() => null);
    }

    // Cria (ou reaproveita) a inscrição do dispositivo e envia ao backend.
    async function subscribeDevice() {
        const publicKey = await fetchVapidKey();
        if (!publicKey) return false;

        const chave = urlBase64ToUint8Array(publicKey);
        const registration = await getRegistration();
        let subscription = await registration.pushManager.getSubscription();

        // Inscrição criada com uma chave VAPID antiga (ex.: deploy que gerou
        // chaves novas) não recebe mais nada, e o servidor não tem como saber.
        // Ao abrir o sistema, o aparelho se reinscreve com a chave atual.
        if (subscription && !mesmaChave(subscription.options.applicationServerKey, chave)) {
            await subscription.unsubscribe().catch(() => undefined);
            subscription = null;
        }

        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: chave,
            });
        }

        await saveSubscription(subscription);
        console.log('📱 [Push] Dispositivo inscrito nas notificações do celular.');
        return true;
    }

    /**
     * Ativa o modo notificações no celular. DEVE ser chamado a partir de um
     * gesto do usuário (clique) para funcionar em iOS/Safari.
     */
    async function enable() {
        if (!isSupported()) {
            alert('Este dispositivo/navegador não suporta notificações push.');
            return false;
        }
        if (isIOS() && !isStandalone()) {
            alert(
                'Para receber notificações no iPhone/iPad, toque em Compartilhar → ' +
                    '"Adicionar à Tela de Início" e abra o app por lá. Depois ative novamente.'
            );
            return false;
        }

        let permission = Notification.permission;
        if (permission === 'default') {
            permission = await Notification.requestPermission();
        }
        if (permission !== 'granted') {
            console.warn('[Push] Permissão de notificação negada pelo usuário.');
            return false;
        }

        try {
            // subscribeDevice() só retorna true depois que o backend confirma
            // que a inscrição foi salva no banco (ver saveSubscription).
            return await subscribeDevice();
        } catch (err) {
            console.error('[Push] Falha ao ativar notificações:', err);
            return false;
        }
    }

    // ── Aviso discreto para ativar (permissão ainda "default") ───────────────
    // Montado com createElement e estilizado pelos tokens do tema (ui-base.css),
    // com fallback escuro para as páginas que ainda não carregam a base nova.
    function injetarEstilo() {
        if (document.getElementById('push-banner-style')) return;
        const style = document.createElement('style');
        style.id = 'push-banner-style';
        style.textContent = `
            #push-enable-banner {
                position: fixed;
                left: 50%;
                bottom: calc(20px + env(safe-area-inset-bottom, 0px));
                transform: translateX(-50%);
                z-index: 99999;
                display: flex;
                align-items: center;
                gap: 12px;
                width: min(440px, calc(100vw - 32px));
                box-sizing: border-box;
                padding: 14px 12px 14px 14px;
                border: 1px solid var(--ui-accent-line, rgba(16, 185, 129, 0.35));
                border-radius: 16px;
                background: var(--ui-surface, #111827);
                color: var(--ui-text, #f9fafb);
                box-shadow: var(--ui-shadow-pop, 0 12px 40px rgba(0, 0, 0, 0.45));
                font-family: var(--ui-font, inherit);
                animation: pushBannerUp 320ms var(--ui-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
            }
            .push-banner-icone {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 40px;
                height: 40px;
                flex-shrink: 0;
                border-radius: 12px;
                background: var(--ui-accent-soft, rgba(16, 185, 129, 0.15));
                color: var(--ui-accent, #34d399);
                font-size: 1.1rem;
            }
            .push-banner-texto { flex: 1; min-width: 0; line-height: 1.35; }
            .push-banner-texto strong { display: block; margin-bottom: 2px; font-size: 0.9rem; }
            .push-banner-texto span { font-size: 0.8rem; color: var(--ui-text-2, #cbd5e1); }
            .push-banner-texto span b { color: var(--ui-text, #f9fafb); }
            #push-enable-btn {
                min-height: 40px;
                padding: 0 16px;
                flex-shrink: 0;
                border: none;
                border-radius: 10px;
                background: var(--ui-accent, #10b981);
                color: var(--ui-accent-ink, #04150f);
                font: inherit;
                font-size: 0.85rem;
                font-weight: 700;
                cursor: pointer;
                white-space: nowrap;
            }
            #push-enable-btn:disabled { opacity: 0.7; cursor: progress; }
            #push-dismiss-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                align-self: flex-start;
                width: 32px;
                height: 32px;
                flex-shrink: 0;
                padding: 0;
                border: 1px solid var(--ui-line-strong, rgba(255, 255, 255, 0.12));
                border-radius: 9px;
                background: transparent;
                color: var(--ui-text-2, #94a3b8);
                cursor: pointer;
                transition: background-color 140ms var(--ui-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
            }
            #push-dismiss-btn:hover { background: var(--ui-surface-2, rgba(255, 255, 255, 0.08)); }
            #push-enable-btn:focus-visible,
            #push-dismiss-btn:focus-visible {
                outline: 2px solid var(--ui-accent, #10b981);
                outline-offset: 2px;
            }
            /* Acima da barra inferior dos painéis no celular. */
            @media (max-width: 768px) {
                #push-enable-banner { bottom: calc(80px + env(safe-area-inset-bottom, 0px)); }
            }
            @keyframes pushBannerUp {
                from { opacity: 0; transform: translate(-50%, 12px); filter: blur(4px); }
                to { opacity: 1; transform: translate(-50%, 0); filter: blur(0); }
            }
            @media (prefers-reduced-motion: reduce) {
                #push-enable-banner { animation: none; }
                #push-dismiss-btn { transition: none; }
            }
        `;
        document.head.appendChild(style);
    }

    const ICONE_FECHAR =
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

    /**
     * Preenche o aviso. Os textos são constantes deste arquivo — nada vindo
     * do usuário ou do servidor passa pelo innerHTML.
     */
    function preencherBanner(banner, { icone, titulo, texto, botaoAtivar, rotuloFechar }) {
        banner.innerHTML =
            `<div class="push-banner-icone" aria-hidden="true"><i class="bi ${icone}"></i></div>` +
            `<div class="push-banner-texto"><strong>${titulo}</strong><span>${texto}</span></div>` +
            (botaoAtivar ? '<button type="button" id="push-enable-btn">Ativar</button>' : '') +
            `<button type="button" id="push-dismiss-btn" aria-label="${rotuloFechar}" title="${rotuloFechar}">${ICONE_FECHAR}</button>`;
    }

    function showBanner() {
        if (document.getElementById('push-enable-banner')) return;
        if (adiado()) return;

        injetarEstilo();
        const banner = document.createElement('div');
        banner.id = 'push-enable-banner';
        banner.setAttribute('role', 'region');
        banner.setAttribute('aria-label', 'Notificações no celular');
        banner.setAttribute('aria-live', 'polite');

        // No iPhone/iPad fora da Tela de Início o push não existe: em vez de
        // esconder o aviso (como antes), ensina o caminho.
        const instalarIOS = isIOS() && !isStandalone();
        preencherBanner(
            banner,
            instalarIOS
                ? {
                      icone: 'bi-phone',
                      titulo: 'Receba os avisos no iPhone',
                      texto: 'Toque em <b>Compartilhar</b> e em <b>Adicionar à Tela de Início</b>. Abra o sistema pelo ícone criado e ative as notificações.',
                      botaoAtivar: false,
                      rotuloFechar: 'Agora não',
                  }
                : {
                      icone: 'bi-bell',
                      titulo: 'Notificações no celular',
                      texto: 'Receba os avisos da escola mesmo com o sistema fechado.',
                      botaoAtivar: true,
                      rotuloFechar: 'Agora não',
                  }
        );

        document.body.appendChild(banner);

        const btnAtivar = document.getElementById('push-enable-btn');
        if (btnAtivar) {
            btnAtivar.addEventListener('click', async () => {
                btnAtivar.disabled = true;
                btnAtivar.textContent = 'Ativando…';
                const ok = await enable();
                if (ok) {
                    markBannerActivated();
                } else {
                    btnAtivar.disabled = false;
                    btnAtivar.textContent = 'Ativar';
                }
            });
        }
        document.getElementById('push-dismiss-btn').addEventListener('click', () => {
            adiar();
            removeBanner();
        });
    }

    // Após ativar e o backend confirmar o salvamento, confirma e some sozinho.
    function markBannerActivated() {
        const banner = document.getElementById('push-enable-banner');
        if (!banner) return;
        preencherBanner(banner, {
            icone: 'bi-check2',
            titulo: 'Notificações ativadas',
            texto: 'Preferência salva. Os avisos da escola vão aparecer neste aparelho.',
            botaoAtivar: false,
            rotuloFechar: 'Fechar',
        });
        document.getElementById('push-dismiss-btn').addEventListener('click', removeBanner);
        setTimeout(removeBanner, 5000);
    }

    function removeBanner() {
        const b = document.getElementById('push-enable-banner');
        if (b) b.remove();
    }

    function isEnabled() {
        return isSupported() && Notification.permission === 'granted';
    }

    async function init() {
        // Não roda nas telas de login (usuário ainda não autenticado)
        if (/login/i.test(window.location.pathname)) return;

        // Safari do iPhone fora da Tela de Início nem expõe PushManager, então
        // esta checagem vem antes da de suporte.
        if (isIOS() && !isStandalone()) {
            const logado = await fetchVapidKey().catch(() => null);
            if (logado) showBanner();
            return;
        }
        if (!isSupported()) return;

        if (Notification.permission === 'granted') {
            // Modo sempre ativo: mantém a inscrição do dispositivo em dia.
            try {
                await subscribeDevice();
            } catch (err) {
                console.warn('[Push] Não foi possível sincronizar a inscrição:', err.message);
            }
            return;
        }

        if (Notification.permission === 'default') {
            // Só oferece se houver sessão ativa (a chave VAPID exige auth).
            const key = await fetchVapidKey();
            if (key) showBanner();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return { enable, isEnabled, subscribeDevice, showBanner };
})();
