/**
 * login-events.js
 * Listeners de eventos do login.html (tela de login)
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

    // ── Lógica do Modal 2FA (Roadmap #1) ──────────────────────────────────────
    window._2fa = { userId: null, countdownTimer: null };

    // Abre o modal 2FA após o backend retornar requires2FA=true
    window.abrirModal2FA = function(userId, emailMascarado, redirectTo) {
        window._2fa.userId = userId;
        window._2fa.redirectTo = redirectTo || null;
        const modal = document.getElementById('modal2FA');
        const emailDisplay = document.getElementById('twofa-email-display');
        const codeInput = document.getElementById('twofa-code-input');
        const errorMsg = document.getElementById('twofa-error-msg');

        if (emailDisplay) emailDisplay.textContent = DOMPurify.sanitize(emailMascarado);
        if (codeInput) codeInput.value = '';
        if (errorMsg) errorMsg.style.display = 'none';
        if (modal) modal.classList.remove('hidden');
        if (codeInput) codeInput.focus();
        iniciarContagem2FA();
    };

    // Fecha o modal 2FA
    window.fecharModal2FA = function() {
        const modal = document.getElementById('modal2FA');
        if (modal) modal.classList.add('hidden');
        clearInterval(window._2fa.countdownTimer);
        window._2fa.userId = null;
    };

    // Contador regressivo de 5 minutos
    function iniciarContagem2FA() {
        clearInterval(window._2fa.countdownTimer);
        let segundos = 5 * 60;
        const countdownEl = document.getElementById('twofa-countdown');

        window._2fa.countdownTimer = setInterval(() => {
            segundos--;
            const m = Math.floor(segundos / 60);
            const s = segundos % 60;
            if (countdownEl) countdownEl.textContent = `${m}:${s.toString().padStart(2,'0')}`;
            if (segundos <= 0) {
                clearInterval(window._2fa.countdownTimer);
                if (countdownEl) countdownEl.textContent = 'Expirado';
                const submitBtn = document.getElementById('twofa-submit-btn');
                if (submitBtn) submitBtn.disabled = true;
            }
        }, 1000);
    }

    // Verifica o código 2FA
    async function verificarCodigo2FA() {
        const userId = window._2fa.userId;
        const codeInput = document.getElementById('twofa-code-input');
        const code = codeInput ? codeInput.value.trim() : '';
        const errorMsg = document.getElementById('twofa-error-msg');
        const btn = document.getElementById('twofa-submit-btn');

        if (!code || code.length !== 6) {
            if (errorMsg) {
                errorMsg.textContent = 'Digite o código de 6 dígitos.';
                errorMsg.style.display = 'block';
            }
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Verificando...';
        }
        if (errorMsg) errorMsg.style.display = 'none';

        try {
            const baseUrl = window.API_BASE_URL || (
                (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                    ? 'http://localhost:3001/api'
                    : 'https://sistema-escolar-bfty.onrender.com/api'
            );

            const res = await fetch(`${baseUrl}/auth/2fa/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ userId, codigo: code })
            });

            const data = await res.json();

            if (!data.success) {
                if (errorMsg) {
                    errorMsg.textContent = DOMPurify.sanitize(data.error || 'Código inválido.');
                    errorMsg.style.display = 'block';
                }
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = '<i class="bi bi-check-lg"></i> Verificar Código';
                }
                return;
            }

            fecharModal2FA();
            clearInterval(window._2fa.countdownTimer);

            const usuario = data.usuario || data.user;
            if (usuario) {
                sessionStorage.setItem('currentUser', JSON.stringify(usuario));
                if (usuario.deveMudarSenha) sessionStorage.setItem('forcePasswordChange', 'true');
            }

            const redirect = data.redirect_to || window._2fa.redirectTo || (usuario && usuario.deveMudarSenha ? 'mudar-senha.html' : 'escolher-perfil.html');
            window.location.href = redirect;

        } catch (err) {
            if (errorMsg) {
                errorMsg.textContent = 'Erro de conexão. Tente novamente.';
                errorMsg.style.display = 'block';
            }
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="bi bi-check-lg"></i> Verificar Código';
            }
        }
    }

    // Reenviar código
    async function reenviarCodigo2FA() {
        const userId = window._2fa.userId;
        if (!userId) return;

        try {
            const baseUrl = window.API_BASE_URL || (
                (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
                    ? 'http://localhost:3001/api'
                    : 'https://sistema-escolar-bfty.onrender.com/api'
            );
            await fetch(`${baseUrl}/auth/2fa/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });
            iniciarContagem2FA();
            const submitBtn = document.getElementById('twofa-submit-btn');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="bi bi-check-lg"></i> Verificar Código';
            }
        } catch(e) { /* silent */ }
    }

    const submitBtn = document.getElementById('twofa-submit-btn');
    const resendBtn = document.getElementById('twofa-resend-btn');
    const codeInput = document.getElementById('twofa-code-input');

    if (submitBtn) submitBtn.addEventListener('click', verificarCodigo2FA);
    if (resendBtn) resendBtn.addEventListener('click', reenviarCodigo2FA);

    if (codeInput) {
        codeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') verificarCodigo2FA();
        });
        codeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '');
            if (e.target.value.length === 6) verificarCodigo2FA();
        });
    }

    // PWA: Registro do Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then(reg => console.log('✅ PWA Service Worker registrado', reg.scope))
                .catch(err => console.log('⚠️ Erro ao registrar Service Worker:', err));
        });
    }
});
