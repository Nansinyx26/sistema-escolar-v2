/**
 * Register Diretor — Cadastro Público de Diretor
 * Valida código secreto, força de senha e envia para /api/auth/register-diretor
 */

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('diretorRegisterForm');
    const senhaInput = document.getElementById('senha');
    const confirmSenhaInput = document.getElementById('confirmSenha');
    const codigoInput = document.getElementById('codigoEscola');
    const submitBtn = document.getElementById('btnSubmit');

    // Password requirements elements
    const reqLength = document.getElementById('req-length');
    const reqUpper = document.getElementById('req-upper');
    const reqNumber = document.getElementById('req-number');
    const reqSpecial = document.getElementById('req-special');

    // Password toggles
    setupPasswordToggle('btn-toggle-senha', 'senha');
    setupPasswordToggle('btn-toggle-confirmSenha', 'confirmSenha');

    // Phone mask
    const telefoneInput = document.getElementById('telefone');
    if (telefoneInput) {
        telefoneInput.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g, '');
            if (v.length > 11) v = v.slice(0, 11);
            if (v.length > 6) v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
            else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
            e.target.value = v;
        });
    }

    // Real-time password strength
    if (senhaInput) {
        senhaInput.addEventListener('input', () => {
            const val = senhaInput.value;
            updateRequirement(reqLength, val.length >= 8);
            updateRequirement(reqUpper, /[A-Z]/.test(val));
            updateRequirement(reqNumber, /[0-9]/.test(val));
            updateRequirement(reqSpecial, /[^A-Za-z0-9]/.test(val));
            checkFormReady();
        });
    }

    if (confirmSenhaInput) {
        confirmSenhaInput.addEventListener('input', checkFormReady);
    }

    // Real-time secret code validation
    let codeTimer;
    if (codigoInput) {
        codigoInput.addEventListener('input', () => {
            const code = codigoInput.value.trim();
            codigoInput.classList.remove('code-valid', 'code-invalid');
            if (!code) return;

            clearTimeout(codeTimer);
            codeTimer = setTimeout(async () => {
                try {
                    const baseUrl = window.API_BASE_URL || (window.location.origin + '/api');
                    const res = await fetch(`${baseUrl}/auth/validate-code`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ codigo: code })
                    });
                    const data = await res.json();
                    if (data.success && data.valid) {
                        codigoInput.classList.add('code-valid');
                    } else {
                        codigoInput.classList.add('code-invalid');
                    }
                } catch (err) {
                    console.error('Erro ao validar código:', err);
                }
                checkFormReady();
            }, 400);
        });
    }

    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const nome = document.getElementById('nome').value.trim();
        const email = document.getElementById('email').value.trim();
        const telefone = document.getElementById('telefone').value.replace(/\D/g, '');
        const escola = document.getElementById('escola')?.value.trim() || '';
        const codigoEscola = codigoInput.value.trim();
        const senha = senhaInput.value;
        const confirmSenha = confirmSenhaInput.value;

        // Validations
        if (!nome || !email || !telefone || !codigoEscola || !senha) {
            showToast('Preencha todos os campos obrigatórios.', 'error');
            return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showToast('E-mail inválido.', 'error');
            return;
        }

        if (senha.length < 8) {
            showToast('A senha deve ter no mínimo 8 caracteres.', 'error');
            return;
        }

        if (senha !== confirmSenha) {
            showToast('As senhas não coincidem.', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Criando conta...';

        try {
            const baseUrl = window.API_BASE_URL || (window.location.origin + '/api');
            const res = await fetch(`${baseUrl}/auth/register-diretor`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ nome, email, senha, telefone, escola, codigoEscola })
            });

            const data = await res.json();

            if (!data.success) {
                throw new Error(data.error || 'Erro ao criar conta.');
            }

            showToast('Conta de diretor criada com sucesso! Redirecionando...', 'success');

            setTimeout(() => {
                window.location.href = '../../html/direcao/index.html';
            }, 1200);

        } catch (error) {
            console.error('Erro no registro de diretor:', error);
            showToast(error.message || 'Erro ao criar conta.', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="bi bi-check-circle-fill"></i> Concluir Cadastro';
        }
    });

    function checkFormReady() {
        const nome = document.getElementById('nome')?.value.trim();
        const email = document.getElementById('email')?.value.trim();
        const telefone = document.getElementById('telefone')?.value.trim();
        const codigo = codigoInput?.value.trim();
        const senha = senhaInput?.value;
        const confirmSenha = confirmSenhaInput?.value;

        const passwordValid = senha && senha.length >= 8 && /[A-Z]/.test(senha) && /[0-9]/.test(senha) && /[^A-Za-z0-9]/.test(senha);
        const passwordsMatch = senha === confirmSenha && confirmSenha;
        const allFilled = nome && email && telefone && codigo;

        submitBtn.disabled = !(allFilled && passwordValid && passwordsMatch);
    }

    function updateRequirement(el, valid) {
        if (!el) return;
        if (valid) {
            el.classList.add('valid');
            el.querySelector('i').className = 'bi bi-check-circle-fill';
        } else {
            el.classList.remove('valid');
            el.querySelector('i').className = 'bi bi-circle';
        }
    }

    function setupPasswordToggle(btnId, inputId) {
        const btn = document.getElementById(btnId);
        const input = document.getElementById(inputId);
        if (btn && input) {
            btn.addEventListener('click', () => {
                const type = input.type === 'password' ? 'text' : 'password';
                input.type = type;
                btn.innerHTML = type === 'text' ? '<i class="bi bi-eye"></i>' : '<i class="bi bi-eye-slash"></i>';
            });
        }
    }

    function showToast(msg, type) {
        const container = document.getElementById('toastContainer');
        if (!container) { alert(msg); return; }

        const toast = document.createElement('div');
        toast.className = 'dnc-toast';
        toast.style.background = type === 'error' ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'linear-gradient(135deg, #10b981, #059669)';
        toast.innerHTML = `<i class="bi ${type === 'error' ? 'bi-exclamation-circle' : 'bi-check-circle'}"></i> ${msg}`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }
});
