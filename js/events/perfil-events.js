/** perfil-events.js — substitui onclick do perfil.html */
document.addEventListener('DOMContentLoaded', function () {
    // Botões podem ter id duplicado (voltarDashboard aparece em 2 lugares)
    document.querySelectorAll('[id="btn-voltar-dashboard"], #btn-voltar-dashboard').forEach(function (btn) {
        btn.addEventListener('click', function () {
            if (typeof voltarDashboard === 'function') voltarDashboard();
        });
    });
    const btnFerr = document.getElementById('btn-ferramentas');
    if (btnFerr) btnFerr.addEventListener('click', function () {
        if (typeof abrirFerramentas === 'function') abrirFerramentas();
    });
    const btnSair = document.getElementById('btn-sair-perfil');
    if (btnSair) btnSair.addEventListener('click', function () {
        if (typeof sair === 'function') sair();
    });
});
