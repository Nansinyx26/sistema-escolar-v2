/** escolher-perfil-events.js — substitui onclick do escolher-perfil.html */
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const perfil = this.dataset.action;
            if (typeof selecionarPerfil === 'function') selecionarPerfil(perfil);
        });
    });
    const btnLogout = document.getElementById('btn-logout-perfil');
    if (btnLogout) btnLogout.addEventListener('click', function () {
        if (typeof logout === 'function') logout();
    });
});
