/**
 * notifications.js — Cliente WebSocket (Socket.IO) para notificações em tempo real.
 *
 * Conecta-se ao servidor via Socket.IO e escuta eventos como:
 *   - 'new-registration'  → Novo docente ou responsável cadastrado
 *   - 'new-notice'        → Novo aviso do mural
 *
 * Exibe um toast na tela e atualiza o badge de notificações sem necessidade de reload.
 */
(function () {
    'use strict';

    // Determina a URL do servidor Socket.IO (usa a mesma base da API)
    const SOCKET_URL = (window.API_BASE_URL || '').replace('/api', '');

    let socket = null;

    /**
     * Conecta ao servidor WebSocket.
     */
    function connect() {
        // Só tenta conectar se o Socket.IO client já foi carregado
        if (typeof io === 'undefined') {
            console.warn('[WS] Socket.IO client não carregado. Carregando dinamicamente...');
            const script = document.createElement('script');
            // Tenta carregar do backend, se falhar usa CDN
            script.src = `${SOCKET_URL}/socket.io/socket.io.js`;
            script.onload = () => {
                console.log('[WS] Socket.IO client carregado do backend. Conectando...');
                initSocket();
            };
            script.onerror = () => {
                console.warn('[WS] Falha ao carregar Socket.IO do backend. Tentando CDN...');
                const cdnScript = document.createElement('script');
                cdnScript.src = 'https://cdn.socket.io/4.7.2/socket.io.min.js';
                cdnScript.onload = () => {
                    console.log('[WS] Socket.IO client carregado via CDN. Conectando...');
                    initSocket();
                };
                document.head.appendChild(cdnScript);
            };
            document.head.appendChild(script);
            return;
        }
        initSocket();
    }

    function initSocket() {
        if (socket && socket.connected) return;
        if (!SOCKET_URL) {
            console.error('[WS] Erro: API_BASE_URL não definida.');
            return;
        }

        socket = io(SOCKET_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionAttempts: 10
        });

        socket.on('connect', () => {
            console.log('🔌 [WS] Conectado ao servidor em tempo real:', socket.id);
        });

        socket.on('disconnect', (reason) => {
            console.log('❌ [WS] Desconectado:', reason);
        });

        // ── Evento: Novo Cadastro ────────────────────────────────────────
        socket.on('new-registration', (data) => {
            console.log('📢 [WS] Novo cadastro recebido:', data);

            // data = { nome, perfil, data, horario }
            const msg = `Novo ${data.perfil.toLowerCase()} cadastrado às ${data.horario}`;
            showRealtimeToast(msg, data);

            // Incrementa o badge de notificações (se existir na página)
            incrementBadge();
        });

        // ── Evento: Novo Aviso ───────────────────────────────────────────
        socket.on('new-notice', (data) => {
            console.log('📢 [WS] Novo aviso recebido:', data);
            const msg = data.titulo || 'Novo aviso publicado';
            showRealtimeToast(msg, data);
            incrementBadge();
        });
    }

    /**
     * Exibe um toast de notificação em tempo real no canto superior direito.
     */
    function showRealtimeToast(message, data) {
        // Cria o container se não existir
        let container = document.getElementById('ws-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'ws-toast-container';
            container.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 99999;
                display: flex;
                flex-direction: column;
                gap: 10px;
                pointer-events: none;
            `;
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.style.cssText = `
            background: rgba(15, 23, 42, 0.9);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(99, 102, 241, 0.3);
            border-radius: 14px;
            padding: 1rem 1.5rem;
            color: #ffffff;
            font-family: 'Plus Jakarta Sans', 'Inter', sans-serif;
            font-size: 0.95rem;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.3);
            display: flex;
            align-items: center;
            gap: 12px;
            pointer-events: auto;
            animation: wsToastIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            max-width: 380px;
        `;

        const autor = data && typeof data.criadoPor === 'object' ? data.criadoPor : null;
        const fotoUrl = autor ? (autor.foto || autor.fotoGoogle) : '';
        const iniciais = window.utils ? window.utils.getInitials(autor?.nome || 'U') : 'U';
        
        const avatarHtml = fotoUrl 
            ? `<img src="${window.getPhotoUrl ? window.getPhotoUrl(fotoUrl) : fotoUrl}" style="width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 2px solid #6366f1;">`
            : `<div style="width: 42px; height: 42px; border-radius: 50%; background: #6366f1; color: white; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.9rem;">${iniciais}</div>`;

        // Data e hora exibidos em fonte grande e branca (#ffffff) conforme requisito
        const timeDisplay = data && data.horario
            ? `<span style="font-size: 1.1rem; font-weight: 700; color: #ffffff;">${data.horario}</span>`
            : '';

        toast.innerHTML = `
            ${avatarHtml}
            <div style="flex-grow: 1;">
                <div style="font-weight: 600; margin-bottom: 2px;">${message}</div>
                <div style="font-size: 0.8rem; color: #94a3b8;">${autor?.nome || 'Sistema'} • ${timeDisplay}</div>
            </div>
        `;

        container.appendChild(toast);

        // Auto-remove após 6 segundos
        setTimeout(() => {
            toast.style.animation = 'wsToastOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 6000);
    }

    /**
     * Incrementa visualmente o badge de notificações na barra de navegação.
     */
    function incrementBadge() {
        const badge = document.querySelector('.notification-badge, #notifBadge, [data-notif-badge], #notif-badge');
        if (badge) {
            const current = parseInt(badge.textContent) || 0;
            badge.textContent = current + 1;
            badge.style.display = 'flex';
        }
    }

    // ── Injeta CSS de animação ────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
        @keyframes wsToastIn {
            from { transform: translateX(120%); opacity: 0; }
            to   { transform: translateX(0); opacity: 1; }
        }
        @keyframes wsToastOut {
            from { transform: translateX(0); opacity: 1; }
            to   { transform: translateX(120%); opacity: 0; }
        }
    `;
    document.head.appendChild(style);

    // ── Auto-connect ao carregar ─────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', connect);
    } else {
        connect();
    }

    // Exporta para uso programático
    window.NotificationsWS = { connect, showRealtimeToast };
})();
