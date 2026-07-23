/**
 * dashboard-events.js
 * Listeners de eventos do dashboard.html
 * Substitui todos os atributos onclick= removidos do HTML.
 * CSP-compatível: zero JavaScript inline.
 */
document.addEventListener('DOMContentLoaded', function () {

    // ── Sino de Notificações ────────────────────────────────────────────────
    const notifBtn = document.getElementById('notif-btn');
    if (notifBtn) {
        notifBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (typeof toggleNotifPanel === 'function') toggleNotifPanel();
        });
    }

    // Marcar todas as notificações como lidas
    const btnMarcarLidas = document.querySelector('#notif-panel .notif-header button');
    if (btnMarcarLidas) {
        btnMarcarLidas.addEventListener('click', function () {
            if (typeof marcarTodasLidas === 'function') marcarTodasLidas();
        });
    }

    // ── Botão Sair ───────────────────────────────────────────────────────────
    const btnSair = document.querySelector('.header-right .btn-secondary[data-action="sair"]');
    if (btnSair) {
        btnSair.addEventListener('click', function () {
            if (typeof sair === 'function') sair();
        });
    }

    // ── Painel de Segurança — mostrar/ocultar código secreto ─────────────────
    const btnToggleCode = document.getElementById('btn-toggle-secret');
    if (btnToggleCode) {
        btnToggleCode.addEventListener('click', function () {
            if (typeof toggleSecretVisibility === 'function') {
                toggleSecretVisibility('dashboardDailyCode', this);
            }
        });
    }

    // ── Navegação via data-href ───────────────────────────────────────────────
    // Cobre todos os botões de cards que têm data-href configurado
    document.querySelectorAll('[data-href]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            window.location.href = this.dataset.href;
        });
    });

    // ── Botões por data-action ────────────────────────────────────────────────
    document.querySelectorAll('[data-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const action = this.dataset.action;
            const fnMap = {
                'irParaTurmas':     () => typeof irParaTurmas    === 'function' && irParaTurmas(),
                'verPerfil':        () => typeof verPerfil        === 'function' && verPerfil(),
                'verRelatorios':    () => typeof verRelatorios    === 'function' && verRelatorios(),
                'abrirFerramentas': () => typeof abrirFerramentas === 'function' && abrirFerramentas(),
                'sair':             () => typeof sair             === 'function' && sair(),
            };
            if (fnMap[action]) fnMap[action]();
        });
    });
});
