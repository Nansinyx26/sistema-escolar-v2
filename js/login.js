/**
 * Login Page Script
 * Gerencia login, registro e autenticação Google
 */

// === INICIALIZAÇÍO ===
document.addEventListener('DOMContentLoaded', async () => {
    // Inicializa banco e autenticação
    await db.init();
    await auth.init();

    // Se já estiver autenticado, redireciona
    if (auth.isAuthenticated()) {
        if (auth.hasProfile()) {
            window.location.href = 'dashboard.html';
        } else {
            window.location.href = 'escolher-perfil.html';
        }
        return;
    }

    setupTabs();
    setupLoginForm();
    setupRegisterForm();
    // setupGoogleButtons removido
    setupPasswordToggles();
    setupInputMasks();
});

// === TABS ===
function setupTabs() {
    const tabs = document.querySelectorAll('.login-tab');
    const contents = document.querySelectorAll('.login-tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.tab;

            // "Criar Conta" (register) → salva tipo e redireciona para cadastro-docente.html
            if (targetTab === 'register') {
                try {
                    sessionStorage.setItem('primeiroAcessoTipo', 'docente');
                } catch (e) { }

                window.location.href = 'pages/cadastro-docente.html';
                return;
            }

            // Remove active de todos
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            // Adiciona active ao clicado
            tab.classList.add('active');
            document.getElementById(`${targetTab}-tab`).classList.add('active');
        });
    });
}


// === LOGIN FORM ===
function setupLoginForm() {
    const form = document.getElementById('loginForm');
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        // Validação
        if (!isValidEmail(email)) {
            showToast('Email inválido', 'error');
            emailInput.focus();
            return;
        }

        if (!password) {
            showToast('Senha obrigatória', 'error');
            passwordInput.focus();
            return;
        }

        // Loading
        const submitBtn = form.querySelector('button[type="submit"]');
        showLoading(submitBtn);

        try {
            // Tenta fazer login
            const usuario = await auth.loginWithEmail(email, password);

            // Se necessitar de 2FA, interrompe e não redireciona (o modal de 2FA já foi aberto)
            if (usuario && usuario.requires2FA) {
                hideLoading(submitBtn);
                return;
            }

            showToast('Login realizado com sucesso!', 'success');

            // Aguarda um pouco para mostrar o toast
            await sleep(500);

            if (usuario && usuario.redirect_to) {
                window.location.href = usuario.redirect_to;
                return;
            }

            // Fallback raso caso o backend não retorne redirect_to
            if (usuario.perfil && (usuario.perfil === 'admin' || usuario.perfil === 'professor' || usuario.perfil === 'diretor')) {
                window.location.href = 'dashboard.html';
            } else if (usuario.perfilDefinidoEm) {
                window.location.href = 'dashboard.html';
            } else {
                window.location.href = 'escolher-perfil.html';
            }
        } catch (error) {
            console.error('Erro no login:', error);
            showToast(error.message || 'Erro ao fazer login', 'error');
            hideLoading(submitBtn);
        }
    });
}

// === REGISTER FORM ===
function setupRegisterForm() {
    const form = document.getElementById('registerForm');
    const nameInput = document.getElementById('registerNome');
    const emailInput = document.getElementById('registerEmail');
    const codeInput = document.getElementById('registerCode');
    const passwordInput = document.getElementById('registerPassword');
    const confirmInput = document.getElementById('registerPasswordConfirm');

    // Elementos da força da senha
    const strengthWrapper = document.querySelector('.password-strength-wrapper');
    const strengthProgress = document.getElementById('strengthProgress');
    const strengthText = document.getElementById('strengthText');

    // Elementos do código secreto
    const validationIcon = document.getElementById('codeValidationIcon');
    let debounceTimer;

    // Monitora a força da senha
    if (passwordInput && strengthWrapper && strengthProgress && strengthText) {
        passwordInput.addEventListener('input', () => {
            const val = passwordInput.value;
            if (!val) {
                strengthWrapper.style.display = 'none';
                return;
            }
            
            strengthWrapper.style.display = 'block';
            
            let score = 0;
            
            // Critério 1: Comprimento
            if (val.length >= 8) score++;
            
            // Critério 2: Letra maiúscula
            if (/[A-Z]/.test(val)) score++;
            
            // Critério 3: Número
            if (/[0-9]/.test(val)) score++;
            
            // Critério 4: Caractere especial
            if (/[^A-Za-z0-9]/.test(val)) score++;
            
            // Atualiza UI
            let width = '0%';
            let color = '#ef4444'; // Vermelho
            let text = 'Senha muito fraca';
            
            if (val.length < 6) {
                width = '20%';
                color = '#ef4444';
                text = 'Muito curta (mín. 6 caracteres)';
            } else {
                switch (score) {
                    case 0:
                    case 1:
                        width = '25%';
                        color = '#ef4444';
                        text = 'Fraca';
                        break;
                    case 2:
                        width = '50%';
                        color = '#f59e0b'; // Amarelo/Laranja
                        text = 'Média';
                        break;
                    case 3:
                        width = '75%';
                        color = '#3b82f6'; // Azul
                        text = 'Boa';
                        break;
                    case 4:
                        width = '100%';
                        color = '#10b981'; // Verde
                        text = 'Forte';
                        break;
                }
            }
            
            strengthProgress.style.width = width;
            strengthProgress.style.backgroundColor = color;
            strengthText.innerText = `Força da Senha: ${text}`;
            strengthText.style.color = color;
        });
    }

    // Validação ao vivo do código secreto
    if (codeInput && validationIcon) {
        codeInput.addEventListener('input', () => {
            const codigo = codeInput.value.trim();
            
            // Limpa classes e esconde ícone temporariamente
            codeInput.classList.remove('code-valid', 'code-invalid');
            validationIcon.style.display = 'none';
            validationIcon.className = 'bi';
            
            if (!codigo) return;
            
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                try {
                    const response = await fetch(`${window.API_BASE_URL}/auth/validate-code`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ codigo })
                    });
                    const data = await response.json();
                    
                    if (data.success && data.valid) {
                        codeInput.classList.add('code-valid');
                        validationIcon.className = 'bi bi-check-circle-fill code-valid-icon';
                        validationIcon.style.color = '#10b981';
                        validationIcon.style.display = 'block';
                    } else {
                        codeInput.classList.add('code-invalid');
                        validationIcon.className = 'bi bi-x-circle-fill';
                        validationIcon.style.color = '#ef4444';
                        validationIcon.style.display = 'block';
                    }
                } catch (err) {
                    console.error('Erro ao validar código:', err);
                }
            }, 400);
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const nome = nameInput.value.trim();
        const email = emailInput.value.trim();
        const cpf = document.getElementById('registerCPF').value.replace(/\D/g, '');
        const telefone = document.getElementById('registerTelefone').value.replace(/\D/g, '');
        const codigoEscola = codeInput.value.trim();
        const password = passwordInput.value;
        const confirmPassword = confirmInput.value;

        // Validação
        if (!nome || !email || !codigoEscola || !password || !cpf) {
            showToast('Todos os campos são obrigatórios', 'error');
            return;
        }

        if (cpf.length !== 11) {
            showToast('CPF inválido', 'error');
            return;
        }

        if (!isValidEmail(email)) {
            showToast('Email inválido', 'error');
            return;
        }

        if (password.length < 6) {
            showToast('Senha muito curta (mín. 6)', 'error');
            return;
        }

        if (password !== confirmPassword) {
            showToast('Senhas não coincidem', 'error');
            return;
        }

        // Loading
        const submitBtn = form.querySelector('button[type="submit"]');
        showLoading(submitBtn);

        try {
            // Registra via Código Secreto (Backend)
            await auth.registerWithCode(email, password, nome, codigoEscola, cpf, telefone);

            showToast('Conta criada com sucesso! Redirecionando...', 'success');

            // Limpa formulário e informações
            form.reset();
            if (strengthWrapper) strengthWrapper.style.display = 'none';
            if (codeInput) codeInput.classList.remove('code-valid', 'code-invalid');
            if (validationIcon) {
                validationIcon.style.display = 'none';
                validationIcon.className = 'bi';
            }

            // Redireciona para escolha de perfil (já autenticado via cookie JWT)
            window.location.href = 'escolher-perfil.html';
            
        } catch (error) {
            console.error('Erro no registro:', error);
            showToast(error.message || 'Erro ao criar conta', 'error');
        } finally {
            hideLoading(submitBtn);
        }
    });
}

// Google Login Functions removidas

// === PASSWORD TOGGLES ===
function setupPasswordToggles() {
    const toggle = document.getElementById('toggleLoginPassword');
    const passwordInput = document.getElementById('loginPassword');

    if (toggle) {
        toggle.addEventListener('click', () => {
            const type = passwordInput.type === 'password' ? 'text' : 'password';
            passwordInput.type = type;
            toggle.innerHTML = type === 'text'
                ? '<i class="bi bi-eye"></i>'
                : '<i class="bi bi-eye-slash"></i>';
        });
    }

}
// === FORGOT PASSWORD MODAL ===
let recoveryEmail = ''; // Email armazenado entre passos
let recoveryCode = '';  // Código armazenado entre passos
let codeTimerInterval = null;
let resendTimerInterval = null;

// Atualiza os indicadores de passo (dots)
function updateStepDots(activeStep) {
    for (let i = 1; i <= 3; i++) {
        const dot = document.getElementById(`stepDot${i}`);
        if (dot) {
            dot.style.background = i <= activeStep ? 'var(--primary-color)' : 'var(--border-color)';
        }
    }
}

window.openForgotPasswordModal = function () {
    const modal = document.getElementById('forgotPasswordModal');
    if (modal) {
        modal.classList.remove('hidden');
        // Reset para step 1
        document.getElementById('step1').style.display = 'block';
        document.getElementById('step2').style.display = 'none';
        document.getElementById('step3').style.display = 'none';
        document.getElementById('forgotEmail').value = '';
        updateStepDots(1);
        recoveryEmail = '';
        recoveryCode = '';
        clearTimers();
    }
}

// Garante que o link funcione mesmo se o onclick falhar
document.addEventListener('DOMContentLoaded', () => {
    const forgotLink = document.getElementById('forgotPasswordLink');
    if (forgotLink) {
        forgotLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.openForgotPasswordModal();
        });
    }

    // Close forgot modal via X button, cancel button, and backdrop
    const btnCloseForgot = document.getElementById('btn-close-forgot');
    if (btnCloseForgot) {
        btnCloseForgot.addEventListener('click', () => window.closeForgotPasswordModal());
    }
    const btnCancelarForgot = document.getElementById('btn-cancelar-forgot');
    if (btnCancelarForgot) {
        btnCancelarForgot.addEventListener('click', () => window.closeForgotPasswordModal());
    }
    const backdropForgot = document.getElementById('backdrop-forgot');
    if (backdropForgot) {
        backdropForgot.addEventListener('click', () => window.closeForgotPasswordModal());
    }
});

function clearTimers() {
    if (codeTimerInterval) { clearInterval(codeTimerInterval); codeTimerInterval = null; }
    if (resendTimerInterval) { clearInterval(resendTimerInterval); resendTimerInterval = null; }
}

window.closeForgotPasswordModal = function () {
    document.getElementById('forgotPasswordModal').classList.add('hidden');
    document.getElementById('requestCodeForm').reset();
    const verifyForm = document.getElementById('verifyCodeForm');
    if (verifyForm) verifyForm.reset();
    const resetForm = document.getElementById('resetPasswordForm');
    if (resetForm) resetForm.reset();
    document.getElementById('step1').style.display = 'block';
    document.getElementById('step2').style.display = 'none';
    document.getElementById('step3').style.display = 'none';
    updateStepDots(1);
    clearTimers();
    recoveryEmail = '';
    recoveryCode = '';
}

// Inicia countdown de expiração do código (15 minutos)
function startCodeCountdown() {
    let remaining = 15 * 60; // 15 minutos em segundos
    const el = document.getElementById('codeCountdown');
    if (!el) return;

    if (codeTimerInterval) clearInterval(codeTimerInterval);

    const tick = () => {
        const min = Math.floor(remaining / 60);
        const sec = remaining % 60;
        el.textContent = `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;

        if (remaining <= 0) {
            clearInterval(codeTimerInterval);
            el.textContent = '00:00';
            el.style.color = '#ef4444';
        }
        remaining--;
    };
    tick();
    codeTimerInterval = setInterval(tick, 1000);
}

// Inicia countdown de reenvio (60 segundos)
function startResendCountdown() {
    let remaining = 60;
    const btn = document.getElementById('btnResendCode');
    const countdownEl = document.getElementById('resendCountdown');
    const resendTextEl = document.getElementById('resendText');
    if (!btn || !countdownEl) return;

    btn.disabled = true;
    btn.style.cursor = 'not-allowed';
    btn.style.color = 'var(--text-tertiary)';

    if (resendTimerInterval) clearInterval(resendTimerInterval);

    const tick = () => {
        countdownEl.textContent = remaining;
        if (remaining <= 0) {
            clearInterval(resendTimerInterval);
            btn.disabled = false;
            btn.style.cursor = 'pointer';
            btn.style.color = 'var(--primary-color)';
            if (resendTextEl) resendTextEl.textContent = 'Reenviar Código';
        }
        remaining--;
    };
    tick();
    resendTimerInterval = setInterval(tick, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
    // === Step 1: Enviar código de recuperação ===
    const requestCodeForm = document.getElementById('requestCodeForm');
    if (requestCodeForm) {
        requestCodeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('forgotEmail').value.trim();

            if (!isValidEmail(email)) {
                showToast('E-mail inválido', 'error');
                return;
            }

            const submitBtn = document.getElementById('btnEnviarCodigo');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Enviando...';

            try {
                const baseUrl = window.API_BASE_URL;
                const res = await fetch(`${baseUrl}/auth/forgot-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });

                const data = await res.json();

                if (data.success) {
                    recoveryEmail = email;
                    showToast(data.message || 'Código enviado! Verifique seu e-mail.', 'success');

                    // Avança para step 2
                    document.getElementById('step1').style.display = 'none';
                    document.getElementById('step2').style.display = 'block';
                    updateStepDots(2);

                    const emailDisplay = document.getElementById('emailDisplayCode');
                    if (emailDisplay) emailDisplay.textContent = email;

                    // Inicia contadores
                    startCodeCountdown();
                    startResendCountdown();

                    // Foca no campo do código
                    const codeInput = document.getElementById('recoveryCode');
                    if (codeInput) setTimeout(() => codeInput.focus(), 200);
                } else {
                    showToast(data.error || 'Erro ao enviar código', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Erro de conexão com o servidor', 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        });
    }

    // === Reenviar código ===
    const btnResend = document.getElementById('btnResendCode');
    if (btnResend) {
        btnResend.addEventListener('click', async () => {
            if (!recoveryEmail) return;

            btnResend.disabled = true;
            try {
                const baseUrl = window.API_BASE_URL;
                const res = await fetch(`${baseUrl}/auth/forgot-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: recoveryEmail })
                });
                const data = await res.json();
                if (data.success) {
                    showToast('Novo código enviado! Verifique seu e-mail.', 'success');
                    startCodeCountdown();
                    startResendCountdown();
                    const codeInput = document.getElementById('recoveryCode');
                    if (codeInput) { codeInput.value = ''; codeInput.focus(); }
                } else {
                    showToast(data.error || 'Erro ao reenviar código', 'error');
                }
            } catch (err) {
                showToast('Erro de conexão', 'error');
            }
        });
    }

    // === Step 2: Verificar código ===
    const verifyCodeForm = document.getElementById('verifyCodeForm');
    if (verifyCodeForm) {
        verifyCodeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const codigo = document.getElementById('recoveryCode').value.trim();

            if (!codigo || codigo.length !== 6) {
                showToast('Insira o código de 6 dígitos', 'error');
                return;
            }

            const submitBtn = document.getElementById('btnVerificarCodigo');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Verificando...';

            try {
                const baseUrl = window.API_BASE_URL;
                const res = await fetch(`${baseUrl}/auth/verify-recovery-code`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: recoveryEmail, codigo })
                });
                const data = await res.json();

                if (data.success) {
                    recoveryCode = codigo;
                    showToast('Código verificado com sucesso!', 'success');
                    clearTimers();

                    // Avança para step 3
                    document.getElementById('step2').style.display = 'none';
                    document.getElementById('step3').style.display = 'block';
                    updateStepDots(3);

                    // Foca no campo de nova senha
                    const newPwd = document.getElementById('newPassword');
                    if (newPwd) setTimeout(() => newPwd.focus(), 200);
                } else {
                    showToast(data.error || 'Código inválido', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Erro de conexão', 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        });
    }

    // === Voltar ao step 1 ===
    const btnVoltarStep1 = document.getElementById('btn-voltar-step1');
    if (btnVoltarStep1) {
        btnVoltarStep1.addEventListener('click', () => {
            clearTimers();
            document.getElementById('step2').style.display = 'none';
            document.getElementById('step1').style.display = 'block';
            updateStepDots(1);
            const verifyForm = document.getElementById('verifyCodeForm');
            if (verifyForm) verifyForm.reset();
        });
    }

    // === Voltar ao step 2 ===
    const btnVoltarStep2 = document.getElementById('btn-voltar-step2');
    if (btnVoltarStep2) {
        btnVoltarStep2.addEventListener('click', () => {
            document.getElementById('step3').style.display = 'none';
            document.getElementById('step2').style.display = 'block';
            updateStepDots(2);
            const resetForm = document.getElementById('resetPasswordForm');
            if (resetForm) resetForm.reset();
            const wrapper = document.getElementById('resetStrengthWrapper');
            if (wrapper) wrapper.style.display = 'none';
        });
    }

    // === Step 3: Redefinir senha ===
    const resetPasswordForm = document.getElementById('resetPasswordForm');
    if (resetPasswordForm) {
        resetPasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const password = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            // Validações de força
            if (password.length < 8) {
                showToast('A senha deve ter no mínimo 8 caracteres', 'error');
                return;
            }
            if (!/[A-Z]/.test(password)) {
                showToast('A senha deve conter pelo menos 1 letra maiúscula', 'error');
                return;
            }
            if (!/[0-9]/.test(password)) {
                showToast('A senha deve conter pelo menos 1 número', 'error');
                return;
            }
            if (password !== confirmPassword) {
                showToast('As senhas não coincidem', 'error');
                return;
            }

            const submitBtn = document.getElementById('btnAlterarSenha');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Alterando...';

            try {
                const baseUrl = window.API_BASE_URL;
                const res = await fetch(`${baseUrl}/auth/reset-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: recoveryEmail,
                        codigo: recoveryCode,
                        password
                    })
                });
                const data = await res.json();

                if (data.success) {
                    showToast('Senha alterada com sucesso! Faça login com sua nova senha.', 'success');
                    setTimeout(() => {
                        closeForgotPasswordModal();
                    }, 2000);
                } else {
                    showToast(data.error || 'Erro ao alterar senha', 'error');
                }
            } catch (err) {
                console.error(err);
                showToast('Erro de conexão', 'error');
            } finally {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalText;
            }
        });
    }

    // === Barra de força e requisitos da nova senha ===
    const newPasswordInput = document.getElementById('newPassword');
    const resetStrengthWrapper = document.getElementById('resetStrengthWrapper');
    const resetStrengthProgress = document.getElementById('resetStrengthProgress');
    const resetStrengthText = document.getElementById('resetStrengthText');

    if (newPasswordInput && resetStrengthWrapper) {
        newPasswordInput.addEventListener('input', () => {
            const val = newPasswordInput.value;
            if (!val) {
                resetStrengthWrapper.style.display = 'none';
                updatePasswordRequirements('');
                return;
            }
            resetStrengthWrapper.style.display = 'block';

            let score = 0;
            if (val.length >= 8) score++;
            if (/[A-Z]/.test(val)) score++;
            if (/[0-9]/.test(val)) score++;
            if (/[^A-Za-z0-9]/.test(val)) score++;

            let width = '0%', color = '#ef4444', text = 'Muito fraca';
            if (val.length < 6) {
                width = '15%'; color = '#ef4444'; text = 'Muito curta';
            } else {
                switch (score) {
                    case 0: case 1: width = '25%'; color = '#ef4444'; text = 'Fraca'; break;
                    case 2: width = '50%'; color = '#f59e0b'; text = 'Média'; break;
                    case 3: width = '75%'; color = '#3b82f6'; text = 'Boa'; break;
                    case 4: width = '100%'; color = '#10b981'; text = 'Forte'; break;
                }
            }
            if (resetStrengthProgress) {
                resetStrengthProgress.style.width = width;
                resetStrengthProgress.style.backgroundColor = color;
            }
            if (resetStrengthText) {
                resetStrengthText.textContent = `Força: ${text}`;
                resetStrengthText.style.color = color;
            }
            updatePasswordRequirements(val);
        });
    }

    function updatePasswordRequirements(val) {
        const reqLength = document.getElementById('reqLength');
        const reqUppercase = document.getElementById('reqUppercase');
        const reqNumber = document.getElementById('reqNumber');
        const green = '#10b981';
        const grey = 'var(--text-secondary)';

        if (reqLength) reqLength.style.color = val.length >= 8 ? green : grey;
        if (reqUppercase) reqUppercase.style.color = /[A-Z]/.test(val) ? green : grey;
        if (reqNumber) reqNumber.style.color = /[0-9]/.test(val) ? green : grey;
    }

    // === Password toggles no modal de redefinição ===
    function setupModalPasswordToggle(btnId, inputId) {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        if (btn && input) {
            btn.addEventListener('click', () => {
                const type = input.type === 'password' ? 'text' : 'password';
                input.type = type;
                btn.innerHTML = type === 'text'
                    ? '<i class="bi bi-eye"></i>'
                    : '<i class="bi bi-eye-slash"></i>';
            });
        }
    }
    setupModalPasswordToggle('toggleNewPassword', 'newPassword');
    setupModalPasswordToggle('toggleConfirmPassword', 'confirmPassword');

    // === Filtrar apenas dígitos no campo de código ===
    const recoveryCodeInput = document.getElementById('recoveryCode');
    if (recoveryCodeInput) {
        recoveryCodeInput.addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
        });
    }
});

// === INPUT MASKS ===
function setupInputMasks() {
    // Máscara de CPF
    const cpfInputs = document.querySelectorAll('#registerCPF');
    cpfInputs.forEach(input => {
        input.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 11) value = value.slice(0, 11);

            // Formata: 000.000.000-00
            value = value.replace(/(\d{3})(\d)/, '$1.$2');
            value = value.replace(/(\d{3})(\d)/, '$1.$2');
            value = value.replace(/(\d{3})(\d{1,2})$/, '$1-$2');

            e.target.value = value;
        });
    });

    // Máscara de Telefone
    const telefoneInputs = document.querySelectorAll('#registerTelefone');
    telefoneInputs.forEach(input => {
        input.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 11) value = value.slice(0, 11);

            // Formata: (00) 00000-0000 ou (00) 0000-0000
            if (value.length <= 10) {
                value = value.replace(/(\d{2})(\d)/, '($1) $2');
                value = value.replace(/(\d{4})(\d)/, '$1-$2');
            } else {
                value = value.replace(/(\d{2})(\d)/, '($1) $2');
                value = value.replace(/(\d{5})(\d)/, '$1-$2');
            }

            e.target.value = value;
        });
    });
}

// === PRIVACY MODAL ===
window.openPrivacyModal = function(e) {
    if (e) e.preventDefault();
    const modal = document.getElementById('privacyModal');
    if (modal) modal.classList.remove('hidden');
}

window.closePrivacyModal = function() {
    const modal = document.getElementById('privacyModal');
    if (modal) modal.classList.add('hidden');
}
