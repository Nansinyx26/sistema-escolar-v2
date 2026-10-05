/** perfil-events.js — substitui onclick do perfil.html */
document.addEventListener('DOMContentLoaded', function () {
    // Botões podem ter id duplicado (voltarDashboard aparece em 2 lugares: topo e formulário)
    document
        .querySelectorAll('[id="btn-voltar-dashboard"], #btn-voltar-dashboard')
        .forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                if (e) e.preventDefault();
                if (typeof window.smartBack === 'function') {
                    window.smartBack('dashboard.html');
                } else if (typeof voltarDashboard === 'function') {
                    voltarDashboard();
                } else {
                    window.history.back();
                }
            });
        });
    const btnFerr = document.getElementById('btn-ferramentas');
    if (btnFerr)
        btnFerr.addEventListener('click', function () {
            if (typeof abrirFerramentas === 'function') abrirFerramentas();
        });
    // Era um `onclick` inline (épico #612).
    const btnTutorial = document.getElementById('btn-ver-tutorial');
    if (btnTutorial)
        btnTutorial.addEventListener('click', function () {
            if (window.OnboardingTour) window.OnboardingTour.restart();
        });
    const btnSair = document.getElementById('btn-sair-perfil');
    if (btnSair)
        btnSair.addEventListener('click', function () {
            if (typeof sair === 'function') sair();
        });
});
