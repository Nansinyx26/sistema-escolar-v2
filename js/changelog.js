/**
 * changelog.js — Sistema de Notificações Dinâmicas (Dashboard Docente/Diretor)
 * Busca notificações reais do banco de dados via /api/notificacoes
 * e renderiza no painel do sininho com contagem de não-lidas.
 *
 * Substitui completamente a versão anterior que usava um array CHANGELOG estático.
 */

(function () {
    'use strict';

    // ── Configuração ──────────────────────────────────────────────────────────
    const POLL_INTERVAL_MS = 60000; // Atualiza a cada 60 segundos
    let _cachedNotifs = [];
    let _pollTimer = null;

    /**
     * Descobre a URL base da API (mesma lógica de react-stats.js)
     */
    function getBaseUrl() {
        const origin = window.location.origin;
        if (origin.includes('3000') || origin.includes('5173') || origin.includes('5174')) {
            return 'http://localhost:3001/api';
        }
        return '/api';
    }

    // ── Mapeamento de tipo → ícone Bootstrap ──────────────────────────────────
    const iconMap = {
        aviso: { icon: 'bi-megaphone-fill', bg: 'rgba(14,165,233,0.15)', color: '#38bdf8' },
        alerta: {
            icon: 'bi-exclamation-triangle-fill',
            bg: 'rgba(239,68,68,0.12)',
            color: '#f87171',
        },
        informacao: { icon: 'bi-info-circle-fill', bg: 'rgba(99,102,241,0.15)', color: '#818cf8' },
        cadastro: { icon: 'bi-person-plus-fill', bg: 'rgba(34,197,94,0.12)', color: '#4ade80' },
        sistema: { icon: 'bi-gear-fill', bg: 'rgba(245,158,11,0.12)', color: '#fbbf24' },
        seguranca: { icon: 'bi-shield-lock-fill', bg: 'rgba(239,68,68,0.12)', color: '#f87171' },
        mural: { icon: 'bi-clipboard2-fill', bg: 'rgba(168,85,247,0.12)', color: '#c084fc' },
        frequencia: {
            icon: 'bi-calendar-check-fill',
            bg: 'rgba(16,185,129,0.12)',
            color: '#34d399',
        },
        nota: { icon: 'bi-bar-chart-line-fill', bg: 'rgba(59,130,246,0.12)', color: '#60a5fa' },
        default: { icon: 'bi-bell-fill', bg: 'rgba(255,255,255,0.06)', color: '#94a3b8' },
    };

    /**
     * Busca notificações do backend
     */
    async function fetchNotificacoes() {
        try {
            const baseUrl = getBaseUrl();
            const res = await fetch(`${baseUrl}/notificacoes`, { credentials: 'include' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
                _cachedNotifs = json.data;
            }
        } catch (err) {
            console.warn('[Notif] Erro ao buscar notificações:', err.message);
        }
    }

    /**
     * Atualiza o badge com a contagem de não-lidas
     */
    function atualizarBadge() {
        const badge = document.getElementById('notif-badge');
        if (!badge) return;

        const naoLidas = _cachedNotifs.filter((n) => !n.lidoPorMim).length;
        badge.textContent = naoLidas > 99 ? '99+' : naoLidas;
        badge.style.display = naoLidas > 0 ? 'flex' : 'none';
        badge.setAttribute('aria-hidden', 'true');

        // O número do badge é só visual; o leitor de tela ouve pelo rótulo.
        const btn = document.getElementById('notif-btn');
        if (btn) {
            btn.setAttribute(
                'aria-label',
                naoLidas > 0
                    ? `Notificações, ${naoLidas} não ${naoLidas === 1 ? 'lida' : 'lidas'}`
                    : 'Notificações'
            );
        }
    }

    /**
     * Formata data ISO para exibição amigável
     */
    function formatDate(isoStr) {
        if (!isoStr) return '';
        try {
            const d = new Date(isoStr);
            const now = new Date();
            const diffMs = now - d;
            const diffMin = Math.floor(diffMs / 60000);
            const diffHour = Math.floor(diffMs / 3600000);
            const diffDay = Math.floor(diffMs / 86400000);

            if (diffMin < 1) return 'Agora';
            if (diffMin < 60) return `${diffMin}min atrás`;
            if (diffHour < 24) return `${diffHour}h atrás`;
            if (diffDay < 7) return `${diffDay}d atrás`;

            return d.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
            });
        } catch {
            return '';
        }
    }

    /**
     * Verifica se o texto é longo o suficiente para truncar
     */
    function isLongText(text, maxLen = 140) {
        if (!text) return false;
        return text.length > maxLen;
    }

    /**
     * Renderiza a lista de notificações no painel
     */
    function renderNotificacoes() {
        const container = document.getElementById('notif-list');
        if (!container) return;

        if (_cachedNotifs.length === 0) {
            container.innerHTML = `
            <div class="notif-vazio" role="status">
                <i class="bi bi-bell-slash" aria-hidden="true"></i>
                <p>Nenhuma notificação no momento</p>
            </div>`;
            return;
        }

        container.innerHTML = _cachedNotifs
            .map((n) => {
                const tipo = iconMap[n.tipo] || iconMap.default;
                const isLida = n.lidoPorMim;
                const dataStr = formatDate(n.dataCriacao || n.dataEnvio);
                const notifId = n.id || n._id;
                const mensagem = n.mensagem || '';
                const mensagemHtml = n.corpoHtml || escapeHtml(mensagem).replace(/\n/g, '<br>');
                const longMessage = isLongText(stripHtml(mensagemHtml), 140);

                return `
            <div class="notif-item${isLida ? ' lida' : ''}${longMessage ? ' notif-collapsed' : ''}" data-id="${notifId}" tabindex="0" role="article" aria-label="Notificação: ${escapeHtml(n.titulo)}">
                <div class="notif-icon-wrap" style="background: ${tipo.bg}; color: ${tipo.color};" aria-hidden="true">
                    <i class="bi ${tipo.icon}"></i>
                </div>
                <div class="notif-body">
                    <div class="notif-top">
                        <span class="notif-tag" style="background: ${tipo.bg}; color: ${tipo.color};">
                            ${capitalize(n.tipo || 'aviso')}
                        </span>
                        <span class="notif-data">${dataStr}</span>
                    </div>
                    <strong class="notif-titulo">${escapeHtml(n.titulo)}</strong>
                    <div class="notif-desc-wrap">
                        <div class="notif-desc${longMessage ? ' notif-desc-clamped' : ''}">${mensagemHtml}</div>
                        ${longMessage ? `<button type="button" class="notif-mais-btn" data-action="toggle-expand" aria-expanded="false">Mais</button>` : ''}
                    </div>
                    ${n.comunicadoId ? `<button type="button" class="notif-comentar-btn" data-comunicado-id="${n.comunicadoId}" data-action="open-feed"><i class="bi bi-chat-left-text"></i> Comentar</button>` : ''}
                </div>
                ${!isLida ? '<div class="notif-dot" aria-hidden="true"></div>' : ''}
            </div>`;
            })
            .join('');

        bindNotifItemEvents(container);
    }

    function stripHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }

    function bindNotifItemEvents(container) {
        container.querySelectorAll('.notif-mais-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const item = btn.closest('.notif-item');
                const desc = item?.querySelector('.notif-desc');
                if (!item || !desc) return;

                const expanded = item.classList.toggle('notif-expanded');
                desc.classList.toggle('notif-desc-clamped', !expanded);
                btn.textContent = expanded ? 'Menos' : 'Mais';
                btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            });
        });

        container.querySelectorAll('.notif-comentar-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const feed = document.getElementById('feedSection');
                if (feed) {
                    feed.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                fecharNotifPanel();
            });
        });

        container.querySelectorAll('.notif-item:not(.lida)').forEach((el) => {
            el.addEventListener('click', (e) => {
                if (
                    e.target.closest('[data-action="toggle-expand"]') ||
                    e.target.closest('[data-action="open-feed"]')
                )
                    return;
                marcarComoLida(el.dataset.id, el);
            });
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    if (
                        e.target.closest('[data-action="toggle-expand"]') ||
                        e.target.closest('[data-action="open-feed"]')
                    )
                        return;
                    e.preventDefault();
                    marcarComoLida(el.dataset.id, el);
                }
            });
        });
    }

    /**
     * Marca uma notificação individual como lida (via API)
     */
    async function marcarComoLida(notifId, el) {
        try {
            const baseUrl = getBaseUrl();
            const csrf = getCsrfToken();
            const headers = { 'Content-Type': 'application/json' };
            if (csrf) headers['X-CSRF-Token'] = csrf;

            const res = await fetch(`${baseUrl}/notificacoes/${notifId}/ler`, {
                method: 'PUT',
                credentials: 'include',
                headers,
            });
            // Sem a confirmação do servidor o item voltaria como não lido no
            // próximo polling — então não finge que marcou.
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            // Atualiza cache local
            const idx = _cachedNotifs.findIndex((n) => (n.id || n._id) === notifId);
            if (idx >= 0) _cachedNotifs[idx].lidoPorMim = true;

            if (el) {
                el.classList.add('lida');
                const dot = el.querySelector('.notif-dot');
                if (dot) dot.remove();
            }
            atualizarBadge();
        } catch (err) {
            console.warn('[Notif] Erro ao marcar como lida:', err.message);
        }
    }

    /**
     * Marca TODAS as notificações como lidas (via API)
     */
    async function marcarTodasLidas() {
        try {
            const baseUrl = getBaseUrl();
            const csrf = getCsrfToken();
            const headers = { 'Content-Type': 'application/json' };
            if (csrf) headers['X-CSRF-Token'] = csrf;

            const res = await fetch(`${baseUrl}/notificacoes/marcar-todas-lidas`, {
                method: 'PUT',
                credentials: 'include',
                headers,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            // Atualiza cache local
            _cachedNotifs.forEach((n) => {
                n.lidoPorMim = true;
            });

            // Atualiza visualmente
            document.querySelectorAll('#notif-list .notif-item').forEach((el) => {
                el.classList.add('lida');
                const dot = el.querySelector('.notif-dot');
                if (dot) dot.remove();
            });
            atualizarBadge();
        } catch (err) {
            console.warn('[Notif] Erro ao marcar todas como lidas:', err.message);
        }
    }

    /**
     * Abre/fecha o painel de notificações
     */
    function toggleNotifPanel() {
        const panel = document.getElementById('notif-panel');
        if (!panel) return;
        const isOpen = panel.classList.toggle('open');
        document.getElementById('notif-btn')?.setAttribute('aria-expanded', String(isOpen));
        if (isOpen) {
            renderNotificacoes();
        }
    }

    /**
     * Fecha o painel. Com `devolverFoco`, o foco volta ao sino — usado pelo
     * botão fechar e pelo Esc, para quem navega por teclado não se perder.
     */
    function fecharNotifPanel(devolverFoco = false) {
        const panel = document.getElementById('notif-panel');
        if (!panel || !panel.classList.contains('open')) return;
        panel.classList.remove('open');
        const btn = document.getElementById('notif-btn');
        btn?.setAttribute('aria-expanded', 'false');
        if (devolverFoco) btn?.focus();
    }

    // ── Utilitários ───────────────────────────────────────────────────────────
    // Escapa texto E atributo — a versão com textContent→innerHTML não escapa
    // aspas, logo não protegia interpolação dentro de atributo.
    // Ver js/escape-html.js.
    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"'`]/g, function (c) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
                '`': '&#96;',
            }[c];
        });
    }

    function capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function getCsrfToken() {
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    }

    // ── Fechar painel ao clicar fora ──────────────────────────────────────────
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('notif-panel');
        const btn = document.getElementById('notif-btn');
        if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
            fecharNotifPanel();
        }
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') fecharNotifPanel(true);
    });

    // ── Inicialização ─────────────────────────────────────────────────────────
    async function atualizarTudo() {
        await fetchNotificacoes();
        atualizarBadge();
        // Se painel estiver aberto, re-renderiza
        const panel = document.getElementById('notif-panel');
        if (panel && panel.classList.contains('open')) {
            renderNotificacoes();
        }
    }

    function iniciarPolling() {
        clearInterval(_pollTimer);
        _pollTimer = setInterval(atualizarTudo, POLL_INTERVAL_MS);
    }

    async function init() {
        await fetchNotificacoes();
        atualizarBadge();
        iniciarPolling();
    }

    // Aba em segundo plano (ou celular com a tela apagada) não precisa
    // consultar o servidor a cada minuto. Ao voltar, atualiza na hora — assim
    // o que chegou enquanto a aba dormia aparece sem esperar o próximo ciclo.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            clearInterval(_pollTimer);
            _pollTimer = null;
        } else {
            atualizarTudo();
            iniciarPolling();
        }
    });

    document.addEventListener('DOMContentLoaded', init);

    // Tempo real: js/realtime.js repassa o aviso do mural que chega pelo socket.
    // Sem isto o sino só mudava no próximo polling, até 60 s depois.
    document.addEventListener('notificacao:nova', atualizarTudo);

    // ── Exporta funções globais (usadas por dashboard-events.js) ──────────────
    window.toggleNotifPanel = toggleNotifPanel;
    window.fecharNotifPanel = fecharNotifPanel;
    window.marcarTodasLidas = marcarTodasLidas;
    window.atualizarBadge = atualizarBadge;
})();
