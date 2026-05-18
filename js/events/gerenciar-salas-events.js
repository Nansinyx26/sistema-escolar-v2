/** gerenciar-salas-events.js — substitui onclick do gerenciar-salas.html */
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-href]').forEach(function (btn) {
        btn.addEventListener('click', function () { window.location.href = this.dataset.href; });
    });
    const btnFechar = document.getElementById('btn-fechar-modal-salas');
    if (btnFechar) btnFechar.addEventListener('click', function () {
        if (typeof fecharModal === 'function') fecharModal();
    });
    const btnSalvar = document.getElementById('btn-salvar-atribuicao');
    if (btnSalvar) btnSalvar.addEventListener('click', function () {
        if (typeof salvarAtribuicao === 'function') salvarAtribuicao();
    });
});
