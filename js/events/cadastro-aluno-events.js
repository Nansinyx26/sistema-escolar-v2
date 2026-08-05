/** cadastro-aluno-events.js — substitui onclick do cadastro-aluno.html */
// cadastro-aluno.html tinha onclick genéricos removidos via regex.
// Este arquivo serve como ponto centralizado para novos listeners se necessário.
document.addEventListener('DOMContentLoaded', function () {
    // Delegação de navegação via data-href
    document.querySelectorAll('[data-href]').forEach(function (btn) {
        btn.addEventListener('click', function () { window.location.href = this.dataset.href; });
    });
    // Delegação de ações via data-action
    document.querySelectorAll('[data-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const fn = window[this.dataset.action];
            if (typeof fn === 'function') fn.call(this);
        });
    });
});
