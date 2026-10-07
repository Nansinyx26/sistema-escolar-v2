/** primeiro-acesso-events.js — substitui onclick e script inline do primeiro-acesso.html */
document.addEventListener('DOMContentLoaded', function () {
    const form = document.getElementById('firstAccessForm');
    const passInput = document.getElementById('newPassword');
    const confirmInput = document.getElementById('confirmPassword');
    const btnSubmit = document.getElementById('btnSubmit');

    // Lógica do Olhinho
    window.togglePass = (id, btn) => {
        const input = document.getElementById(id);
        const icon = btn.querySelector('i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('bi-eye', 'bi-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('bi-eye-slash', 'bi-eye');
        }
    };

    const btnNew = document.getElementById('btn-toggle-new-pass');
    if (btnNew)
        btnNew.addEventListener('click', function () {
            if (typeof togglePass === 'function') togglePass('newPassword', this);
        });

    const btnConfirm = document.getElementById('btn-toggle-confirm-pass');
    if (btnConfirm)
        btnConfirm.addEventListener('click', function () {
            if (typeof togglePass === 'function') togglePass('confirmPassword', this);
        });

    // Validação em tempo real com feedback visual
    if (passInput) {
        passInput.addEventListener('input', () => {
            const val = passInput.value;
            const reqs = {
                length: val.length >= 8,
                upper: /[A-Z]/.test(val),
                number: /[0-9]/.test(val),
                special: /[^A-Za-z0-9]/.test(val),
            };

            Object.keys(reqs).forEach((key) => {
                const el = document.getElementById(`req-${key}`);
                if (el) {
                    // O `<i>` vira SVG quando a biblioteca de ícones carrega:
                    // sem a guarda, o erro aqui impedia o validateForm abaixo.
                    const icone = el.querySelector('i');
                    if (reqs[key]) {
                        el.classList.add('valid');
                        if (icone) icone.className = 'bi bi-check-circle-fill';
                    } else {
                        el.classList.remove('valid');
                        if (icone) icone.className = 'bi bi-circle';
                    }
                }
            });

            validateForm();
        });
    }

    if (confirmInput) {
        confirmInput.addEventListener('input', validateForm);
    }

    const privacyConsent = document.getElementById('privacyConsent');
    if (privacyConsent) {
        privacyConsent.addEventListener('change', validateForm);
    }

    // Duas etapas (Issue #659): primeiro o código vai para o e-mail do
    // pré-cadastro; a senha só é gravada com ele.
    const identificacaoInput = document.getElementById('emailOrCpf');
    const codigoInput = document.getElementById('codigoAtivacao');
    const btnEnviarCodigo = document.getElementById('btnEnviarCodigo');
    const btnReenviar = document.getElementById('btnReenviarCodigo');
    const etapaIdentificacao = document.getElementById('etapaIdentificacao');
    const etapaSenha = document.getElementById('etapaSenha');
    const avisoCodigo = document.getElementById('avisoCodigo');
    let codigoPedido = false;

    if (identificacaoInput && btnEnviarCodigo) {
        identificacaoInput.addEventListener('input', () => {
            btnEnviarCodigo.disabled = !identificacaoInput.value.trim();
        });
    }
    if (codigoInput) codigoInput.addEventListener('input', validateForm);

    function validateForm() {
        if (!passInput || !confirmInput || !btnSubmit || !privacyConsent) return;
        const val = passInput.value;
        const privacyAccepted = privacyConsent.checked;
        const isValid =
            /^\d{6}$/.test(codigoInput ? codigoInput.value.trim() : '') &&
            val.length >= 8 &&
            /[A-Z]/.test(val) &&
            /[0-9]/.test(val) &&
            /[^A-Za-z0-9]/.test(val) &&
            val === confirmInput.value &&
            val !== '' &&
            privacyAccepted;

        btnSubmit.disabled = !isValid;
    }

    function chamarPrimeiroAcesso(corpo) {
        return fetch(`${window.API_BASE_URL}/auth/first-access`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include', // recebe o cookie JWT do auto-login
            body: JSON.stringify(corpo),
        }).then((r) => r.json());
    }

    async function pedirCodigo(botao) {
        const textoOriginal = botao.innerHTML;
        botao.disabled = true;
        botao.innerHTML = '<i class="bi bi-hourglass-split"></i> Enviando...';
        try {
            const json = await chamarPrimeiroAcesso({
                emailOrCpf: identificacaoInput.value.trim(),
            });
            if (!json.success) {
                showToast(json.error || 'Não foi possível enviar o código.', 'error');
                return;
            }
            codigoPedido = true;
            identificacaoInput.readOnly = true;
            if (etapaIdentificacao) etapaIdentificacao.hidden = true;
            if (etapaSenha) etapaSenha.hidden = false;
            if (avisoCodigo) avisoCodigo.textContent = json.message || '';
            if (codigoInput) codigoInput.focus();
        } catch (_err) {
            showToast('📡 Falha na conexão com o servidor', 'error');
        } finally {
            botao.disabled = botao === btnEnviarCodigo ? codigoPedido : false;
            botao.innerHTML = textoOriginal;
        }
    }

    if (btnReenviar) btnReenviar.addEventListener('click', () => pedirCodigo(btnReenviar));

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!codigoPedido) {
                if (btnEnviarCodigo && !btnEnviarCodigo.disabled) pedirCodigo(btnEnviarCodigo);
                return;
            }

            if (btnSubmit.disabled) return;

            try {
                btnSubmit.disabled = true;
                btnSubmit.innerHTML = '<i class="bi bi-hourglass-split"></i> Ativando...';

                const json = await chamarPrimeiroAcesso({
                    emailOrCpf: identificacaoInput.value.trim(),
                    codigo: codigoInput.value.trim(),
                    password: passInput.value,
                });

                if (json.success) {
                    showToast('🎉 Conta ativada com sucesso!', 'success');
                    // Persiste a sessão criada pelo backend e vai direto ao painel
                    if (json.user) {
                        sessionStorage.setItem('currentUser', JSON.stringify(json.user));
                    }
                    setTimeout(() => {
                        window.location.href = json.redirect_to || 'dashboard.html';
                    }, 1500);
                } else {
                    showToast(json.error || 'Erro ao validar dados', 'error');
                    btnSubmit.disabled = false;
                    btnSubmit.innerHTML = '<i class="bi bi-lightning-fill"></i> Ativar Minha Conta';
                }
            } catch (_err) {
                showToast('📡 Falha na conexão com o servidor', 'error');
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = '<i class="bi bi-lightning-fill"></i> Ativar Minha Conta';
            }
        });
    }
});
