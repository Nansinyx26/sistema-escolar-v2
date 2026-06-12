/**
 * Notification Manager Logic
 * Handles fetching, rendering and marking notifications as read in MongoDB Atlas.
 */

window.NotifManager = (function() {
    'use strict';

    const API_BASE = '/api/notificacoes';
    let notifications = [];

    const getCsrfToken = () => {
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    };

    async function init() {
        const btn = document.getElementById('notif-btn');
        const panel = document.getElementById('notif-panel');
        const markAllBtn = document.getElementById('btn-marcar-lidas');

        if (!btn || !panel) return;

        // Toggle Panel
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = panel.classList.toggle('open');
            if (isOpen) {
                panel.style.display = 'flex';
                fetchNotifications();
            } else {
                panel.style.display = 'none';
            }
        });

        document.addEventListener('click', () => {
            panel.classList.remove('open');
            panel.style.display = 'none';
        });

        panel.addEventListener('click', (e) => e.stopPropagation());

        // Mark All Read
        markAllBtn?.addEventListener('click', markAllAsRead);

        // Initial fetch for badge
        fetchNotifications();
    }

    async function fetchNotifications() {
        try {
            const res = await fetch(API_BASE, { credentials: 'include' });
            const json = await res.json();
            if (json.success) {
                notifications = json.data;
                renderNotifications();
                updateBadge();
            }
        } catch (err) {
            console.error('Error fetching notifications:', err);
        }
    }

    function renderNotifications() {
        const list = document.getElementById('notif-list');
        if (!list) return;

        if (notifications.length === 0) {
            list.innerHTML = `<div style="padding: 2rem; text-align: center; color: #64748b; font-size: 0.8rem;">Nenhuma notificação encontrada.</div>`;
            return;
        }

        const user = window.auth ? window.auth.getCurrentUser() : null;
        const userId = user ? (user._id || user.id) : null;

        list.innerHTML = notifications.map(notif => {
            const isRead = notif.lido && notif.lido.includes(userId);
            const date = new Date(notif.dataCriacao).toLocaleDateString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            const categoria = notif.categoria || 'geral';
            
            return `
                <div class="notif-item ${isRead ? 'lida' : 'unread'}" onclick="NotifManager.markAsRead('${notif._id}')">
                    <div class="notif-icon-wrap">
                        <i class="bi ${getIcon(notif.tipo)}"></i>
                    </div>
                    <div class="notif-body">
                        <div class="notif-top">
                            <span class="notif-tag" style="background: ${getColor(categoria)}">${categoria.toUpperCase()}</span>
                            <span class="notif-data">${date}</span>
                        </div>
                        <span class="notif-titulo">${notif.titulo || ''}</span>
                        <p class="notif-desc">${notif.mensagem || ''}</p>
                    </div>
                    ${!isRead ? '<div class="notif-dot"></div>' : ''}
                </div>
            `;
        }).join('');
    }

    async function markAsRead(id) {
        try {
            const res = await fetch(`${API_BASE}/${id}/ler`, { 
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                credentials: 'include'
            });
            const json = await res.json();
            if (json.success) {
                // Update local state and re-render
                notifications = notifications.map(n => {
                    if (n._id === id) {
                        const user = window.auth.getCurrentUser();
                        const userId = user._id || user.id;
                        if (!n.lido) n.lido = [];
                        if (!n.lido.includes(userId)) n.lido.push(userId);
                    }
                    return n;
                });
                renderNotifications();
                updateBadge();
            }
        } catch (err) {
            console.error('Error marking as read:', err);
        }
    }

    async function markAllAsRead() {
        try {
            const res = await fetch(`${API_BASE}/marcar-todas-lidas`, { 
                method: 'PUT',
                headers: { 
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': getCsrfToken()
                },
                credentials: 'include'
            });
            const json = await res.json();
            if (json.success) {
                fetchNotifications();
            }
        } catch (err) {
            console.error('Error marking all as read:', err);
        }
    }

    function updateBadge() {
        const badge = document.getElementById('notif-badge');
        if (!badge) return;

        const user = window.auth ? window.auth.getCurrentUser() : null;
        const userId = user ? (user._id || user.id) : null;
        
        const unreadCount = notifications.filter(n => !n.lido || !n.lido.includes(userId)).length;
        
        if (unreadCount > 0) {
            badge.textContent = unreadCount;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }

    function getIcon(tipo) {
        switch(tipo) {
            case 'informativo': return 'bi-info-circle';
            case 'alerta': return 'bi-exclamation-triangle';
            case 'urgente': return 'bi-lightning-charge';
            default: return 'bi-bell';
        }
    }

    function getColor(cat) {
        switch(cat) {
            case 'direcao': return 'rgba(59, 130, 246, 0.2)';
            case 'academico': return 'rgba(16, 185, 129, 0.2)';
            case 'financeiro': return 'rgba(245, 158, 11, 0.2)';
            default: return 'rgba(148, 163, 184, 0.2)';
        }
    }

    return { init, markAsRead, fetchNotifications };

})();

document.addEventListener('DOMContentLoaded', NotifManager.init);
