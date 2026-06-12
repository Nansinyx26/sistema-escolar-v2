/** lista-prof-events.js — substitui onclick do lista-professores.html */
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-href]').forEach(function (btn) {
        btn.addEventListener('click', function () { window.location.href = this.dataset.href; });
    });
    const btnSalvar = document.getElementById('btn-salvar-prof');
    if (btnSalvar) btnSalvar.addEventListener('click', function () {
        if (typeof salvarAlteracoes === 'function') salvarAlteracoes();
    });
    const btnAdd = document.getElementById('btn-adicionar-prof');
    if (btnAdd) btnAdd.addEventListener('click', function () {
        if (typeof adicionarProfessor === 'function') adicionarProfessor();
    });
    const btnPdf = document.getElementById('btn-gerar-pdf');
    if (btnPdf) btnPdf.addEventListener('click', function () {
        if (typeof gerarPDF === 'function') gerarPDF();
    });
    // Delegação de evento para botões "Remover linha" gerados dinamicamente
    document.addEventListener('click', function (e) {
        if (e.target.closest('.btn-remover-linha')) {
            const btn = e.target.closest('.btn-remover-linha');
            if (typeof removerLinha === 'function') removerLinha(btn);
        }
    });
});
