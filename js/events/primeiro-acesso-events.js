/** primeiro-acesso-events.js — substitui onclick do primeiro-acesso.html */
document.addEventListener('DOMContentLoaded', function () {
    const btnNew = document.getElementById('btn-toggle-new-pass');
    if (btnNew) btnNew.addEventListener('click', function () {
        if (typeof togglePass === 'function') togglePass('newPassword', this);
    });
    const btnConfirm = document.getElementById('btn-toggle-confirm-pass');
    if (btnConfirm) btnConfirm.addEventListener('click', function () {
        if (typeof togglePass === 'function') togglePass('confirmPassword', this);
    });
});
