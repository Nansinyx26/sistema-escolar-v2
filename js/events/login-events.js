/**
 * login-events.js
 * Listeners de eventos do index.html (tela de login)
 * Substitui todos os atributos onclick= removidos do HTML.
 * CSP-compatível: zero JavaScript inline.
 */
document.addEventListener('DOMContentLoaded', function () {

    // ── Modal "Esqueci a Senha" ───────────────────────────────────────────────

    // Botão X (fechar modal)
    const btnCloseForgot = document.querySelector('#forgotPasswordModal .modal-close');
    if (btnCloseForgot) {
        btnCloseForgot.addEventListener('click', function () {
            if (typeof closeForgotPasswordModal === 'function') closeForgotPasswordModal();
        });
    }

    // Backdrop do modal de esqueci a senha
    const backdropForgot = document.querySelector('#forgotPasswordModal .backdrop');
    if (backdropForgot) {
        backdropForgot.addEventListener('click', function () {
            if (typeof closeForgotPasswordModal === 'function') closeForgotPasswordModal();
        });
    }

    // Botão "Cancelar" dentro do modal (step 1)
    const btnCancelarForgot = document.querySelector('#requestCodeForm .btn-secondary');
    if (btnCancelarForgot) {
        btnCancelarForgot.addEventListener('click', function () {
            if (typeof closeForgotPasswordModal === 'function') closeForgotPasswordModal();
        });
    }

    // Botão "Voltar" no step 2
    const btnVoltar = document.querySelector('#step2 .btn-secondary');
    if (btnVoltar) {
        btnVoltar.addEventListener('click', function () {
            if (typeof backToStep1 === 'function') backToStep1();
        });
    }

    // ── Modal "Política de Privacidade" ──────────────────────────────────────

    // Link "Políticas de Privacidade" dentro do label de consentimento
    const linkPrivacy = document.querySelector('label[for="registerConsent"] a');
    if (linkPrivacy) {
        linkPrivacy.addEventListener('click', function (e) {
            if (typeof openPrivacyModal === 'function') openPrivacyModal(e);
        });
    }

    // Backdrop do modal de privacidade
    const backdropPrivacy = document.querySelector('#privacyModal .backdrop');
    if (backdropPrivacy) {
        backdropPrivacy.addEventListener('click', function () {
            if (typeof closePrivacyModal === 'function') closePrivacyModal();
        });
    }

    // Botão X do modal de privacidade
    const btnClosePrivacy = document.querySelector('#privacyModal .modal-close');
    if (btnClosePrivacy) {
        btnClosePrivacy.addEventListener('click', function () {
            if (typeof closePrivacyModal === 'function') closePrivacyModal();
        });
    }

    // Botão "Entendi e Aceito"
    const btnAceitarPrivacy = document.querySelector('#privacyModal .modal-footer .btn-primary');
    if (btnAceitarPrivacy) {
        btnAceitarPrivacy.addEventListener('click', function () {
            if (typeof closePrivacyModal === 'function') closePrivacyModal();
        });
    }
});
