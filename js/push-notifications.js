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
    const DISMISS_KEY = 'push_prompt_dismissed';

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

    const isSupported = () =>
        'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    // iOS/iPadOS só entrega push quando o site está instalado (Adicionar à Tela
    // de Início) e rodando em modo standalone (iOS 16.4+).
    const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = () =>
        window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

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
            credentials: 'include'
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
                'X-CSRF-Token': getCsrfToken() || ''
            },
            credentials: 'include',
            body: JSON.stringify(subscription)
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

        const registration = await getRegistration();
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
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
    function showBanner() {
        if (document.getElementById('push-enable-banner')) return;
        if (localStorage.getItem(DISMISS_KEY) === '1') return;
        if (isIOS() && !isStandalone()) return; // sem instalar não adianta

        const banner = document.createElement('div');
        banner.id = 'push-enable-banner';
        banner.style.cssText = [
            'position:fixed', 'left:50%', 'bottom:20px', 'transform:translateX(-50%)',
            'z-index:99999', 'max-width:420px', 'width:calc(100% - 32px)',
            'display:flex', 'align-items:center', 'gap:12px',
            'padding:14px 16px', 'border-radius:14px',
            'background:#111827', 'color:#f9fafb',
            'border:1px solid rgba(16,185,129,0.35)',
            'box-shadow:0 12px 40px rgba(0,0,0,0.45)',
            'font-family:inherit', 'font-size:0.9rem',
            'animation:pushBannerUp .35s ease'
        ].join(';');

        banner.innerHTML =
            '<div style="font-size:1.6rem;line-height:1">📱</div>' +
            '<div style="flex:1;line-height:1.35">' +
            '<strong style="display:block;color:#34d399;margin-bottom:2px">Notificações no celular</strong>' +
            '<span style="color:#cbd5e1;font-size:0.82rem">Receba avisos da escola mesmo com o app fechado.</span>' +
            '</div>' +
            '<button id="push-enable-btn" style="background:#10b981;color:#04150f;border:none;border-radius:10px;padding:9px 14px;font-weight:700;cursor:pointer;white-space:nowrap">Ativar</button>' +
            '<button id="push-dismiss-btn" aria-label="Dispensar" style="background:transparent;color:#94a3b8;border:none;font-size:1.3rem;cursor:pointer;line-height:1;padding:0 4px">&times;</button>';

        if (!document.getElementById('push-banner-style')) {
            const style = document.createElement('style');
            style.id = 'push-banner-style';
            style.textContent =
                '@keyframes pushBannerUp{from{opacity:0;transform:translate(-50%,20px)}to{opacity:1;transform:translate(-50%,0)}}';
            document.head.appendChild(style);
        }

        document.body.appendChild(banner);

        document.getElementById('push-enable-btn').addEventListener('click', async () => {
            const btn = document.getElementById('push-enable-btn');
            btn.disabled = true;
            btn.textContent = 'Ativando...';
            const ok = await enable();
            if (ok) {
                // Salvo no banco: NÃO some — mostra o estado confirmado.
                markBannerActivated();
            } else {
                btn.disabled = false;
                btn.textContent = 'Ativar';
            }
        });
        document.getElementById('push-dismiss-btn').addEventListener('click', () => {
            localStorage.setItem(DISMISS_KEY, '1');
            removeBanner();
        });
    }

    // Após ativar e o backend confirmar o salvamento, transforma o aviso num
    // estado de confirmação que PERMANECE na tela (não desaparece sozinho).
    function markBannerActivated() {
        const banner = document.getElementById('push-enable-banner');
        if (!banner) return;
        banner.style.borderColor = 'rgba(16,185,129,0.6)';
        banner.innerHTML =
            '<div style="font-size:1.6rem;line-height:1">✅</div>' +
            '<div style="flex:1;line-height:1.35">' +
            '<strong style="display:block;color:#34d399;margin-bottom:2px">Notificações ativadas</strong>' +
            '<span style="color:#cbd5e1;font-size:0.82rem">Preferência salva no sistema. Você receberá os avisos da escola neste dispositivo.</span>' +
            '</div>' +
            '<button id="push-dismiss-btn" aria-label="Fechar" style="background:transparent;color:#94a3b8;border:none;font-size:1.3rem;cursor:pointer;line-height:1;padding:0 4px">&times;</button>';
        document.getElementById('push-dismiss-btn').addEventListener('click', removeBanner);
    }

    function removeBanner() {
        const b = document.getElementById('push-enable-banner');
        if (b) b.remove();
    }

    function isEnabled() {
        return isSupported() && Notification.permission === 'granted';
    }

    async function init() {
        if (!isSupported()) return;
        // Não roda nas telas de login (usuário ainda não autenticado)
        if (/login/i.test(window.location.pathname)) return;

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
