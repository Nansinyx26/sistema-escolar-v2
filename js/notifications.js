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
            script.src = `${SOCKET_URL}/socket.io/socket.io.js`;
            script.onload = () => {
                console.log('[WS] Socket.IO client carregado do backend. Conectando...');
                initSocket();
            };
            // Não há fallback para CDN, e isso é intencional. O que existia
            // aqui baixava a BIBLIOTECA de cdn.socket.io e em seguida chamava
            // io(SOCKET_URL) — o mesmo backend que acabou de falhar em servir
            // um arquivo estático. Servidor que não entrega um .js também não
            // aceita WebSocket, então o fallback resolvia a metade errada do
            // problema. (Além disso o CSP do app não permite cdn.socket.io,
            // então o script era bloqueado e a falha ficava silenciosa.)
            script.onerror = () => {
                console.error(
                    '[WS] Não foi possível carregar o Socket.IO de ' +
                        SOCKET_URL +
                        '. As notificações em tempo real ficarão indisponíveis nesta sessão.'
                );
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
            reconnectionAttempts: 10,
        });

        socket.on('connect', () => {
            console.log('🔌 [WS] Conectado ao servidor em tempo real:', socket.id);
        });

        socket.on('disconnect', (reason) => {
            console.log('❌ [WS] Desconectado:', reason);
        });

        // Escola bloqueada pelo super admin (Issue #463).
        socket.on('escola:bloqueada', () => {
            if (typeof window.tratarEscolaBloqueada === 'function') window.tratarEscolaBloqueada();
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
     *
     * Montado com createElement/textContent: título e nome do autor chegam
     * pelo socket e não podem entrar como HTML.
     */
    function showRealtimeToast(message, data) {
        // Mesmo timbre de aviso usado pelo mural (js/som-notificacao.js).
        window.SomNotificacao?.aviso();

        let container = document.getElementById('ws-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'ws-toast-container';
            container.setAttribute('role', 'region');
            container.setAttribute('aria-label', 'Notificações em tempo real');
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'ws-toast';
        toast.setAttribute('role', 'status');
        toast.setAttribute('aria-live', 'polite');

        const autor = data && typeof data.criadoPor === 'object' ? data.criadoPor : null;
        const fotoUrl = autor ? autor.foto || autor.fotoGoogle : '';

        if (fotoUrl) {
            const img = document.createElement('img');
            img.className = 'ws-toast-avatar';
            img.src = window.getPhotoUrl ? window.getPhotoUrl(fotoUrl) : fotoUrl;
            img.alt = '';
            img.decoding = 'async';
            toast.appendChild(img);
        } else {
            const avatar = document.createElement('div');
            avatar.className = 'ws-toast-avatar ws-toast-avatar-iniciais';
            avatar.setAttribute('aria-hidden', 'true');
            avatar.textContent = window.utils ? window.utils.getInitials(autor?.nome || 'U') : 'U';
            toast.appendChild(avatar);
        }

        const corpo = document.createElement('div');
        corpo.className = 'ws-toast-corpo';
        const titulo = document.createElement('div');
        titulo.className = 'ws-toast-titulo';
        titulo.textContent = message;
        const meta = document.createElement('div');
        meta.className = 'ws-toast-meta';
        meta.textContent = autor?.nome || 'Sistema';
        if (data && data.horario) {
            const hora = document.createElement('span');
            hora.className = 'ws-toast-hora';
            hora.textContent = data.horario;
            meta.append(' · ', hora);
        }
        corpo.append(titulo, meta);
        toast.appendChild(corpo);

        const fechar = document.createElement('button');
        fechar.type = 'button';
        fechar.className = 'ws-toast-fechar';
        fechar.setAttribute('aria-label', 'Fechar notificação');
        fechar.title = 'Fechar';
        fechar.innerHTML =
            '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
        toast.appendChild(fechar);

        container.appendChild(toast);

        let timer = null;
        const remover = () => {
            clearTimeout(timer);
            if (toast.classList.contains('ws-toast-saindo')) return;
            toast.classList.add('ws-toast-saindo');
            // Sem animação (reduced motion) o animationend não dispara.
            const reduzir = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
            if (reduzir) toast.remove();
            else toast.addEventListener('animationend', () => toast.remove(), { once: true });
        };
        const agendar = () => {
            clearTimeout(timer);
            timer = setTimeout(remover, 6000);
        };

        fechar.addEventListener('click', remover);
        // Pausa enquanto o usuário lê ou foca o toast.
        toast.addEventListener('mouseenter', () => clearTimeout(timer));
        toast.addEventListener('mouseleave', agendar);
        toast.addEventListener('focusin', () => clearTimeout(timer));
        toast.addEventListener('focusout', agendar);
        agendar();
    }

    /**
     * Incrementa visualmente o badge de notificações na barra de navegação.
     */
    function incrementBadge() {
        // Com o painel do sino (js/changelog.js) na página, ele é o dono do
        // badge: pede a contagem real ao servidor em vez de somar 1 aqui, que
        // brigava com o polling e deixava o número errado até o próximo ciclo.
        if (typeof window.atualizarBadge === 'function') {
            document.dispatchEvent(new CustomEvent('notificacao:nova'));
            return;
        }
        const badge = document.querySelector(
            '.notification-badge, #notifBadge, [data-notif-badge], #notif-badge'
        );
        if (badge) {
            const current = parseInt(badge.textContent, 10) || 0;
            badge.textContent = current + 1;
            badge.style.display = 'flex';
        }
    }

    // ── Injeta o CSS do toast ─────────────────────────────────────────────
    // Usa os tokens do tema (ui-base.css) com fallback escuro para as páginas
    // que ainda não carregam a base nova.
    const style = document.createElement('style');
    style.textContent = `
        #ws-toast-container {
            position: fixed;
            top: calc(16px + env(safe-area-inset-top, 0px));
            right: 16px;
            z-index: 99999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            width: min(380px, calc(100vw - 32px));
            pointer-events: none;
        }
        .ws-toast {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 10px 12px 12px;
            border: 1px solid var(--ui-line-strong, rgba(255, 255, 255, 0.12));
            border-left: 3px solid var(--ui-accent, #6366f1);
            border-radius: 14px;
            background: var(--ui-surface, rgba(15, 23, 42, 0.96));
            color: var(--ui-text, #ffffff);
            font-family: var(--ui-font, 'Inter', sans-serif);
            box-shadow: var(--ui-shadow-pop, 0 12px 32px rgba(0, 0, 0, 0.35));
            box-sizing: border-box;
            pointer-events: auto;
            animation: wsToastIn 320ms var(--ui-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
        }
        .ws-toast.ws-toast-saindo {
            animation: wsToastOut 180ms var(--ui-ease-in, cubic-bezier(0.4, 0, 1, 1)) forwards;
        }
        .ws-toast-avatar {
            width: 40px;
            height: 40px;
            flex-shrink: 0;
            border-radius: 50%;
            object-fit: cover;
            border: 2px solid var(--ui-accent-line, rgba(99, 102, 241, 0.6));
        }
        .ws-toast-avatar-iniciais {
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--ui-accent-soft, #6366f1);
            color: var(--ui-accent, #ffffff);
            font-size: 0.85rem;
            font-weight: 700;
        }
        .ws-toast-corpo { flex: 1; min-width: 0; }
        .ws-toast-titulo {
            margin-bottom: 2px;
            font-size: 0.9rem;
            font-weight: 600;
            line-height: 1.35;
            overflow-wrap: anywhere;
        }
        .ws-toast-meta { font-size: 0.78rem; color: var(--ui-text-3, #94a3b8); }
        .ws-toast-hora { font-weight: 700; color: var(--ui-text-2, #ffffff); }
        .ws-toast-fechar {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            align-self: flex-start;
            width: 28px;
            height: 28px;
            flex-shrink: 0;
            padding: 0;
            border: 1px solid transparent;
            border-radius: 8px;
            background: transparent;
            color: var(--ui-text-3, #94a3b8);
            cursor: pointer;
            transition: background-color 140ms var(--ui-ease-out, cubic-bezier(0.16, 1, 0.3, 1)),
                color 140ms var(--ui-ease-out, cubic-bezier(0.16, 1, 0.3, 1));
        }
        .ws-toast-fechar:hover {
            background: var(--ui-surface-2, rgba(255, 255, 255, 0.08));
            border-color: var(--ui-line, rgba(255, 255, 255, 0.1));
            color: var(--ui-text, #ffffff);
        }
        .ws-toast-fechar:focus-visible {
            outline: 2px solid var(--ui-accent, #6366f1);
            outline-offset: 2px;
        }
        @keyframes wsToastIn {
            from { transform: translateY(-8px) scale(0.98); opacity: 0; filter: blur(4px); }
            to   { transform: translateY(0) scale(1); opacity: 1; filter: blur(0); }
        }
        @keyframes wsToastOut {
            from { transform: translateX(0); opacity: 1; }
            to   { transform: translateX(12px); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
            .ws-toast, .ws-toast.ws-toast-saindo { animation: none; }
            .ws-toast-fechar { transition: none; }
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
