/**
 * Realtime System Client
 * Socket.IO + Avaliações + Reações + Notificações
 * Funciona sem reload de página
 */

(function () {
    'use strict';

    const API = window.API_BASE_URL || (
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:3001/api'
            : window.location.origin + '/api'
    );

    const SOCKET_URL = API.replace('/api', '');
    const EMOJIS = [
        '👍', '👎', '❤️', '💙', '💚', '💛', '🧡', '💜',
        '😂', '🤣', '😆', '😄', '😊', '😍', '😘',
        '😮', '🤯', '😲', '😱',
        '😢', '😭', '🥺',
        '👏', '🙌', '🤝',
        '🔥', '💯', '⭐', '✨',
        '🎉', '🎊', '🏆',
        '🤔', '🤨', '😎',
        '🙏', '💪', '🚀',
        '📚', '✏️', '🎓'
    ];

    let socket = null;
    let currentUser = null;

    // =============================================
    // SOCKET.IO CONNECTION
    // =============================================
    function connectSocket() {
        // 1. If already connected, do nothing
        if (socket && socket.connected) return;
        // 2. If socket exists but is currently connecting, do nothing
        if (socket && (socket.connecting || socket.io?.readyState === 'opening')) return;

        // 3. If window.io already exists, just initialize socket directly
        if (window.io) {
            initSocketConnection();
            return;
        }

        // 4. Prevent duplicate script loading
        if (document.getElementById('socket-io-script')) return;

        const scriptEl = document.createElement('script');
        scriptEl.id = 'socket-io-script';
        scriptEl.src = SOCKET_URL + '/socket.io/socket.io.js';
        scriptEl.onload = () => {
            initSocketConnection();
        };
        document.head.appendChild(scriptEl);
    }

    function initSocketConnection() {
        if (socket) {
            if (socket.connected) return;
            socket.connect(); // Reconnect if disconnected
            return;
        }

        socket = io(SOCKET_URL, {
            withCredentials: true,
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionAttempts: 10
        });

        window.socket = socket; // Expor globalmente para outros componentes (ex: Feed)

        socket.on('connect', () => {
            console.log('🔌 [Realtime] Conectado ao servidor Socket.IO');
        });

        // === REVIEW EVENTS ===
        socket.on('review:new', (data) => updateReviewUI(data));
        socket.on('review:update', (data) => updateReviewUI(data));
        socket.on('review:remove', (data) => {
            if (data.stats) renderReviewStats(data.stats);
        });

        // === REACTION EVENTS ===
        socket.on('reaction:add', (data) => updateReactionUI(data));
        socket.on('reaction:update', (data) => updateReactionUI(data));
        socket.on('reaction:remove', (data) => updateReactionUI(data));

        // === NOTIFICATION EVENTS ===
        socket.on('notification:new', (data) => {
            addNotificationToUI(data.notification);
            updateNotifBadge(data.unreadCount);
            showNotifPopup(data.notification);
        });
        socket.on('notification:count', (data) => {
            updateNotifBadge(data.unreadCount);
        });

        socket.on('disconnect', () => {
            console.log('❌ [Realtime] Desconectado do servidor');
        });
    }

    // =============================================
    // REVIEW SYSTEM — Card no Dashboard
    // =============================================
    // Helper to fetch with timeout
    async function fetchWithTimeout(url, options = {}, timeout = 8000) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(id);
            return response;
        } catch (error) {
            clearTimeout(id);
            throw error;
        }
    }

    // =============================================
    // REVIEW SYSTEM — Card no Dashboard
    // =============================================
    function initReviewCard() {
        const formEl = document.getElementById('reviewForm');
        const statsEl = document.getElementById('reviewStats');
        const listEl = document.getElementById('reviewList');

        // Set local skeletons on nested target elements to avoid deleting elements
        if (formEl) {
            formEl.innerHTML = `<div class="skeleton" style="width:100%;height:140px;border-radius:12px;"></div>`;
        }
        if (statsEl) {
            statsEl.innerHTML = `
                <div class="review-stats skeleton" style="height:100px;border:none;"></div>
            `;
        }
        if (listEl) {
            listEl.innerHTML = `
                <div class="skeleton" style="width:100%;height:80px;border-radius:10px;margin-bottom:8px;"></div>
                <div class="skeleton" style="width:100%;height:80px;border-radius:10px;"></div>
            `;
        }

        loadReviews();
        loadMyReview();
    }

    async function loadReviews() {
        const statsEl = document.getElementById('reviewStats');
        const listEl = document.getElementById('reviewList');
        try {
            const res = await fetchWithTimeout(`${API}/reviews`, { credentials: 'include' }, 8000);
            const json = await res.json();
            if (json.success) {
                renderReviewStats(json.stats);
                renderReviewList(json.data);
            } else {
                throw new Error(json.error || 'Falha ao processar dados de avaliações');
            }
        } catch (err) {
            console.error('[Realtime] Erro ao carregar avaliações:', err);
            if (statsEl) {
                statsEl.innerHTML = `
                    <div class="review-stats" style="flex-direction:column;gap:0.5rem;align-items:center;background:rgba(239,68,68,0.04);border-color:rgba(239,68,68,0.15);">
                        <span style="font-size:0.8rem;color:#f87171;font-weight:600;"><i class="bi bi-exclamation-triangle-fill"></i> Erro ao carregar dados</span>
                        <button class="btn btn-outline btn-xs" onclick="window.RealtimeSystem.loadReviews()" style="font-size:0.7rem;padding:2px 8px;border-color:rgba(239,68,68,0.3);color:#f87171;background:transparent;"><i class="bi bi-arrow-clockwise"></i> Repetir</button>
                    </div>
                `;
            }
            if (listEl) {
                listEl.innerHTML = '<p style="text-align:center;color:#ef4444;font-size:0.75rem;padding:0.5rem;">Falha ao carregar as avaliações recentes.</p>';
            }
        }
    }

    async function loadMyReview() {
        const formEl = document.getElementById('reviewForm');
        try {
            const res = await fetchWithTimeout(`${API}/reviews/mine`, { credentials: 'include' }, 8000);
            const json = await res.json();
            if (json.success && json.data) {
                renderMyReviewForm(json.data);
            } else {
                renderMyReviewForm(null);
            }
        } catch (err) {
            console.error('[Realtime] Erro ao carregar minha avaliação:', err);
            if (formEl) {
                formEl.innerHTML = `
                    <div style="padding:1rem;text-align:center;background:rgba(239,68,68,0.03);border:1px dashed rgba(239,68,68,0.15);border-radius:12px;margin-bottom:0.75rem;">
                        <span style="font-size:0.78rem;color:#f87171;display:block;margin-bottom:0.4rem;">Não foi possível carregar seu formulário.</span>
                        <button class="btn btn-outline btn-xs" onclick="window.RealtimeSystem.loadMyReview()" style="font-size:0.7rem;padding:2px 8px;border-color:rgba(239,68,68,0.3);color:#f87171;background:transparent;"><i class="bi bi-arrow-clockwise"></i> Tentar Novamente</button>
                    </div>
                `;
            }
        }
    }

    function renderReviewStats(stats) {
        const el = document.getElementById('reviewStats');
        if (!el || !stats) return;

        const starsHtml = Array.from({ length: 5 }, (_, i) =>
            `<i class="bi bi-star${i < Math.round(stats.average) ? '-fill' : ''}"></i>`
        ).join('');

        const distHtml = [5, 4, 3, 2, 1].map(n => {
            const count = stats.distribution?.[n] || 0;
            const pct = stats.total > 0 ? (count / stats.total * 100) : 0;
            return `<div class="dist-row">
                <span class="dist-label">${n}</span>
                <div class="dist-bar"><div class="dist-fill" style="width:${pct}%"></div></div>
                <span class="dist-count">${count}</span>
            </div>`;
        }).join('');

        el.innerHTML = `
            <div class="review-stats">
                <div class="review-stats-big">
                    <div class="avg-number">${stats.average || '0.0'}</div>
                    <div class="avg-stars">${starsHtml}</div>
                    <div class="avg-total">${stats.total} avaliação${stats.total !== 1 ? 'ões' : ''}</div>
                </div>
                <div class="review-distribution">${distHtml}</div>
            </div>
        `;
    }

    function renderReviewList(reviews) {
        const el = document.getElementById('reviewList');
        if (!el) return;

        if (!reviews || reviews.length === 0) {
            el.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem 1rem;background:rgba(255,255,255,0.01);border:1px dashed rgba(255,255,255,0.05);border-radius:12px;text-align:center;">
                    <i class="bi bi-chat-left-heart" style="font-size:1.8rem;color:var(--text-tertiary,#64748b);margin-bottom:0.5rem;opacity:0.6;"></i>
                    <p style="margin:0;color:var(--text-secondary,#94a3b8);font-size:0.8rem;font-weight:500;">Nenhuma avaliação ainda.</p>
                    <p style="margin:4px 0 0;color:var(--text-tertiary,#64748b);font-size:0.72rem;">Seja o primeiro a deixar um comentário sobre o portal!</p>
                </div>
            `;
            return;
        }

        el.innerHTML = reviews.map(r => {
            const initials = r.userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const stars = Array.from({ length: 5 }, (_, i) =>
                `<i class="bi bi-star${i < r.rating ? '-fill' : ''}"></i>`
            ).join('');
            const timeAgo = formatTimeAgo(r.updatedAt || r.createdAt);

            return `<div class="review-item">
                <div class="review-avatar type-${r.userType}">${initials}</div>
                <div class="review-content">
                    <div class="review-header">
                        <span class="review-name">${r.userName}</span>
                        <span class="review-date">${timeAgo}</span>
                    </div>
                    <div class="review-stars-small">${stars}</div>
                    <p class="review-text">${escapeHtml(r.comment)}</p>
                </div>
            </div>`;
        }).join('');
    }

    function renderMyReviewForm(existingReview) {
        const el = document.getElementById('reviewForm');
        if (!el) return;

        let selectedRating = existingReview?.rating || 0;

        const starsHtml = Array.from({ length: 5 }, (_, i) => {
            const idx = i + 1;
            const activeClass = idx <= selectedRating ? 'active' : '';
            return `<span class="star ${activeClass}" data-rating="${idx}">★</span>`;
        }).join('');

        el.innerHTML = `
            <div style="margin-bottom:0.75rem;">
                <label style="font-size:0.82rem;font-weight:600;color:var(--text-primary,#edf2fa);margin-bottom:0.4rem;display:block;">
                    ${existingReview ? '✏️ Editar sua avaliação' : '⭐ Deixe sua avaliação'}
                </label>
                <div class="star-rating" id="starRatingPicker">${starsHtml}</div>
            </div>
            <textarea id="reviewComment" class="form-textarea" placeholder="O que você achou do sistema?" 
                rows="2" maxlength="500" style="margin-bottom:0.6rem;font-size:0.82rem;resize:none;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px 12px;width:100%;color:var(--text-primary);">${existingReview?.comment || ''}</textarea>
            <div style="display:flex;gap:0.5rem;align-items:center;">
                <button id="btnSubmitReview" class="btn btn-primary btn-sm" style="background:linear-gradient(135deg,#fbbf24,#f59e0b);border:none;color:#111;font-weight:700;border-radius:8px;padding:6px 16px;display:flex;align-items:center;gap:6px;">
                    <i class="bi bi-send-fill"></i> ${existingReview ? 'Atualizar' : 'Enviar'}
                </button>
                ${existingReview ? '<button id="btnDeleteReview" class="btn btn-outline btn-sm" style="border-color:#ef4444;color:#ef4444;font-size:0.75rem;padding:6px 10px;border-radius:8px;background:transparent;"><i class="bi bi-trash"></i></button>' : ''}
                <span id="reviewCharCount" style="font-size:0.7rem;color:var(--text-secondary,#94a3b8);margin-left:auto;">0/500</span>
            </div>
        `;

        // Star picker logic
        const picker = document.getElementById('starRatingPicker');
        const starEls = picker.querySelectorAll('.star');

        starEls.forEach(star => {
            star.addEventListener('mouseenter', () => {
                const r = parseInt(star.dataset.rating);
                starEls.forEach((s, i) => {
                    s.classList.toggle('hover-preview', i + 1 <= r && i + 1 > selectedRating);
                });
            });

            star.addEventListener('click', () => {
                selectedRating = parseInt(star.dataset.rating);
                starEls.forEach((s, i) => {
                    s.classList.toggle('active', i + 1 <= selectedRating);
                    s.classList.remove('hover-preview');
                });
            });
        });

        picker.addEventListener('mouseleave', () => {
            starEls.forEach(s => s.classList.remove('hover-preview'));
        });

        // Char count
        const textarea = document.getElementById('reviewComment');
        const charCount = document.getElementById('reviewCharCount');
        if (textarea && charCount) {
            charCount.textContent = `${textarea.value.length}/500`;
            textarea.addEventListener('input', () => {
                charCount.textContent = `${textarea.value.length}/500`;
            });
        }

        // Submit
        document.getElementById('btnSubmitReview')?.addEventListener('click', async () => {
            const comment = textarea.value.trim();
            if (selectedRating === 0) return showToast?.('Selecione de 1 a 5 estrelas', 'warning');
            if (!comment) return showToast?.('Escreva um comentário', 'warning');

            const btn = document.getElementById('btnSubmitReview');
            btn.disabled = true;
            btn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Salvando...';

            try {
                const res = await fetchWithTimeout(`${API}/reviews`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ rating: selectedRating, comment })
                }, 8000);
                const json = await res.json();
                if (json.success) {
                    showToast?.('Avaliação salva com sucesso! ⭐', 'success');
                    loadMyReview();
                    loadReviews();
                } else {
                    showToast?.(json.error || 'Erro ao salvar', 'error');
                }
            } catch (err) {
                showToast?.('Erro de conexão ou timeout', 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = `<i class="bi bi-send-fill"></i> ${existingReview ? 'Atualizar' : 'Enviar'}`;
            }
        });

        // Delete
        document.getElementById('btnDeleteReview')?.addEventListener('click', async () => {
            if (!confirm('Tem certeza que deseja remover sua avaliação?')) return;
            try {
                const res = await fetchWithTimeout(`${API}/reviews`, { method: 'DELETE', credentials: 'include' }, 8000);
                const json = await res.json();
                if (json.success) {
                    showToast?.('Avaliação removida', 'info');
                    loadMyReview();
                    loadReviews();
                } else {
                    showToast?.(json.error || 'Erro ao remover', 'error');
                }
            } catch (err) {
                showToast?.('Erro ao remover devido a falha na rede', 'error');
            }
        });
    }

    function updateReviewUI(data) {
        if (data.stats) renderReviewStats(data.stats);
        if (data.recentReviews) renderReviewList(data.recentReviews);
    }

    // =============================================
    // REACTION SYSTEM
    // =============================================
    function createReactionBar(messageId, existingReactions) {
        const summary = existingReactions || {};
        const userId = currentUser?.id || currentUser?._id;

        let html = '<div class="reaction-bar" data-message-id="' + messageId + '">';
        EMOJIS.forEach(emoji => {
            const data = summary[emoji] || { count: 0, users: [] };
            const isSelected = data.users?.some(u => u.name === currentUser?.nome);
            const tooltipContent = data.users?.map(u => `${u.name} reagiu ${emoji}`).join('\n') || '';

            html += `<span class="reaction-emoji ${isSelected ? 'selected' : ''}" data-emoji="${emoji}" data-message="${messageId}">
                ${emoji}
                ${data.count > 0 ? `<span class="reaction-count">${data.count}</span>` : ''}
                ${data.count > 0 ? `<span class="reaction-tooltip">${escapeHtml(tooltipContent)}</span>` : ''}
            </span>`;
        });
        html += '</div>';
        return html;
    }

    function updateReactionUI(data) {
        const bars = document.querySelectorAll(`.reaction-bar[data-item-id="${data.messageId}"], .reaction-bar[data-message-id="${data.messageId}"]`);
        bars.forEach(bar => {
            if (window.renderBarWithData) {
                window.renderBarWithData(bar, data.messageId, data.summary);
            } else {
                bar.outerHTML = createReactionBar(data.messageId, data.summary);
                attachReactionListeners();
            }
        });
    }

    function attachReactionListeners() {
        document.querySelectorAll('.reaction-emoji').forEach(el => {
            el.removeEventListener('click', handleReactionClick);
            el.addEventListener('click', handleReactionClick);
        });
    }

    async function handleReactionClick(e) {
        const el = e.currentTarget;
        const emoji = el.dataset.emoji;
        const messageId = el.dataset.message;

        el.classList.add('emoji-pop');
        setTimeout(() => el.classList.remove('emoji-pop'), 300);

        try {
            if (el.classList.contains('selected')) {
                // Remove reaction
                await fetch(`${API}/reactions/${messageId}`, {
                    method: 'DELETE', credentials: 'include'
                });
            } else {
                // Add/update reaction
                await fetch(`${API}/reactions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ messageId, emoji })
                });
            }
        } catch (err) {
            console.error('[Realtime] Erro na reação:', err);
        }
    }

    // =============================================
    // NOTIFICATION SYSTEM
    // =============================================
    function initNotifications() {
        const bell = document.getElementById('notifBell');
        if (!bell) return;

        bell.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = document.getElementById('notifDropdown');
            dropdown?.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            const dropdown = document.getElementById('notifDropdown');
            if (dropdown && !dropdown.contains(e.target) && e.target.id !== 'notifBell') {
                dropdown.classList.remove('open');
            }
        });

        document.getElementById('markAllRead')?.addEventListener('click', markAllRead);
        loadNotifications();
    }

    async function loadNotifications() {
        try {
            const res = await fetch(`${API}/notifications/realtime`, { credentials: 'include' });
            const json = await res.json();
            if (json.success) {
                renderNotificationList(json.data);
                updateNotifBadge(json.unreadCount);
            }
        } catch (err) { /* silent */ }
    }

    function renderNotificationList(notifications) {
        const list = document.getElementById('notifList');
        if (!list) return;

        if (!notifications || notifications.length === 0) {
            list.innerHTML = '<div class="notif-empty"><i class="bi bi-bell-slash" style="font-size:1.5rem;display:block;margin-bottom:0.5rem;"></i>Nenhuma notificação</div>';
            return;
        }

        list.innerHTML = notifications.map(n => `
            <div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n._id}" onclick="window.RealtimeSystem.markRead('${n._id}')">
                <div class="notif-icon">${n.icon || '🔔'}</div>
                <div class="notif-body">
                    <div class="notif-title">${escapeHtml(n.title)}</div>
                    <div class="notif-message">${escapeHtml(n.message)}</div>
                    <div class="notif-time">${formatTimeAgo(n.createdAt)}</div>
                </div>
            </div>
        `).join('');
    }

    function addNotificationToUI(notification) {
        const list = document.getElementById('notifList');
        if (!list) return;

        // Remove empty state
        const empty = list.querySelector('.notif-empty');
        if (empty) empty.remove();

        const html = `<div class="notif-item unread" data-id="${notification._id}" onclick="window.RealtimeSystem.markRead('${notification._id}')" style="animation: reviewSlideIn 0.3s ease;">
            <div class="notif-icon">${notification.icon || '🔔'}</div>
            <div class="notif-body">
                <div class="notif-title">${escapeHtml(notification.title)}</div>
                <div class="notif-message">${escapeHtml(notification.message)}</div>
                <div class="notif-time">agora</div>
            </div>
        </div>`;

        list.insertAdjacentHTML('afterbegin', html);
    }

    function updateNotifBadge(count) {
        const badge = document.getElementById('notifBadge');
        const bell = document.getElementById('notifBell');
        if (!badge) return;

        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'flex';
            bell?.classList.add('has-unread');
        } else {
            badge.style.display = 'none';
            bell?.classList.remove('has-unread');
        }
    }

    function showNotifPopup(notification) {
        // Toast notification
        if (typeof showToast === 'function') {
            showToast(`${notification.icon || '🔔'} ${notification.title}`, 'info');
        }
    }

    async function markRead(id) {
        try {
            await fetch(`${API}/notifications/realtime/read/${id}`, {
                method: 'PUT', credentials: 'include'
            });
            const item = document.querySelector(`.notif-item[data-id="${id}"]`);
            item?.classList.remove('unread');
            loadNotifications();
        } catch (err) { /* silent */ }
    }

    async function markAllRead() {
        try {
            await fetch(`${API}/notifications/realtime/read-all`, {
                method: 'PUT', credentials: 'include'
            });
            document.querySelectorAll('.notif-item.unread').forEach(el => el.classList.remove('unread'));
            updateNotifBadge(0);
        } catch (err) { /* silent */ }
    }

    // =============================================
    // UTILITIES
    // =============================================
    function formatTimeAgo(dateStr) {
        const diff = Date.now() - new Date(dateStr).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'agora';
        if (mins < 60) return `${mins}min`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours}h`;
        const days = Math.floor(hours / 24);
        if (days < 30) return `${days}d`;
        return new Date(dateStr).toLocaleDateString('pt-BR');
    }

    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // =============================================
    // INITIALIZATION
    // =============================================
    function init() {
        // Get current user from auth
        if (window.auth) {
            currentUser = window.auth.getCurrentUser?.();
        }

        connectSocket();
        initReviewCard();
        initNotifications();
        attachReactionListeners();
    }

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
    } else {
        setTimeout(init, 500);
    }

    // Public API
    window.RealtimeSystem = {
        init,
        createReactionBar,
        attachReactionListeners,
        markRead,
        markAllRead,
        loadReviews,
        loadMyReview,
        loadNotifications
    };
})();
