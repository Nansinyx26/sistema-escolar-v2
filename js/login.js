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

            showToast('Login realizado com sucesso!', 'success');

            // Aguarda um pouco para mostrar o toast
            await sleep(500);

            // Redireciona
            if (usuario.perfil) {
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
    const nameInput = document.getElementById('registerName');
    const emailInput = document.getElementById('registerEmail');
    const codeInput = document.getElementById('registerCode');
    const passwordInput = document.getElementById('registerPassword');
    const confirmInput = document.getElementById('registerPasswordConfirm');

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

            showToast('Conta criada com sucesso! Entre agora.', 'success');

            // Limpa e muda para aba de login
            form.reset();
            const loginTab = document.querySelector('.login-tab[data-tab="login"]');
            if (loginTab) loginTab.click();
            
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
            toggle.innerHTML = type === 'password'
                ? '<i class="bi bi-eye"></i>'
                : '<i class="bi bi-eye-slash"></i>';
        });
    }
}
// === FORGOT PASSWORD MODAL ===
let userEmail = ''; // Store email for step 2
let userCPF = ''; // Store CPF for step 2  
let userTelefone = ''; // Store telefone for step 2

window.openForgotPasswordModal = function () {
    console.log('🔓 Abrindo modal de senha');
    const modal = document.getElementById('forgotPasswordModal');
    if (modal) {
        modal.classList.remove('hidden');
        // Reset to step 1
        document.getElementById('step1').style.display = 'block';
        document.getElementById('step2').style.display = 'none';
        document.getElementById('forgotEmail').value = '';
        document.getElementById('forgotCPF').value = '';
        document.getElementById('forgotTelefone').value = '';
        userEmail = '';
        userCPF = '';
        userTelefone = '';
    } else {
        console.error('❌ Modal forgotPasswordModal não encontrado!');
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
});

window.closeForgotPasswordModal = function () {
    document.getElementById('forgotPasswordModal').classList.add('hidden');
    document.getElementById('requestCodeForm').reset();
    document.getElementById('resetPasswordForm').reset();
    document.getElementById('step1').style.display = 'block';
    document.getElementById('step2').style.display = 'none';
    userEmail = '';
}

window.backToStep1 = function () {
    document.getElementById('step1').style.display = 'block';
    document.getElementById('step2').style.display = 'none';
    document.getElementById('resetPasswordForm').reset();
}

document.addEventListener('DOMContentLoaded', () => {
    // Step 1: Request Verification Code
    const requestCodeForm = document.getElementById('requestCodeForm');
    if (requestCodeForm) {
        requestCodeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('forgotEmail').value.trim();
            const cpf = document.getElementById('forgotCPF').value.replace(/\D/g, '');
            const telefone = document.getElementById('forgotTelefone').value.replace(/\D/g, '');

            // Validações
            if (!isValidEmail(email)) {
                showToast('Email inválido', 'error');
                return;
            }

            if (cpf.length !== 11) {
                showToast('CPF inválido', 'error');
                return;
            }

            if (telefone.length < 10 || telefone.length > 11) {
                showToast('Telefone inválido', 'error');
                return;
            }

            const submitBtn = e.target.querySelector('button[type="submit"]');
            const originalText = submitBtn.innerHTML;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Enviando...';

            try {
                // Usa a URL global definida em api-config.js
                const baseUrl = window.API_BASE_URL;

                const res = await fetch(`${baseUrl}/auth/forgot-password`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, cpf, telefone })
                });

                const data = await res.json();

                if (data.success) {
                    showToast('E-mail de recuperação enviado com sucesso! Verifique sua caixa de entrada.', 'success');
                    setTimeout(() => {
                        closeForgotPasswordModal();
                        // Limpa o formulário
                        forgotPasswordForm.reset();
                    }, 3000);
                } else {
                    showToast(data.error || 'Erro ao validar dados', 'error');
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

});

// === INPUT MASKS ===
function setupInputMasks() {
    // Máscara de CPF
    const cpfInputs = document.querySelectorAll('#registerCPF, #forgotCPF');
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
    const telefoneInputs = document.querySelectorAll('#registerTelefone, #forgotTelefone');
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
