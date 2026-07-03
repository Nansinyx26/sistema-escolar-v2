/** grade-horaria-events.js — substitui onclick do grade-horaria-admin.html */
document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-href]').forEach(function (btn) {
        btn.addEventListener('click', function () { window.location.href = this.dataset.href; });
    });
    const btnSalvar = document.getElementById('btn-salvar-grade');
    if (btnSalvar) btnSalvar.addEventListener('click', function () {
        if (typeof showToast === 'function') showToast('Grade salva com sucesso!', 'success');
        setTimeout(() => window.location.reload(), 1000);
    });
});
