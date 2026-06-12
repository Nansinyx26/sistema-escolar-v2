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
    if (btnNew) btnNew.addEventListener('click', function () {
        if (typeof togglePass === 'function') togglePass('newPassword', this);
    });

    const btnConfirm = document.getElementById('btn-toggle-confirm-pass');
    if (btnConfirm) btnConfirm.addEventListener('click', function () {
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
                special: /[^A-Za-z0-9]/.test(val)
            };

            Object.keys(reqs).forEach(key => {
                const el = document.getElementById(`req-${key}`);
                if (el) {
                    if (reqs[key]) {
                        el.classList.add('valid');
                        el.querySelector('i').className = 'bi bi-check-circle-fill';
                    } else {
                        el.classList.remove('valid');
                        el.querySelector('i').className = 'bi bi-circle';
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

    function validateForm() {
        if (!passInput || !confirmInput || !btnSubmit || !privacyConsent) return;
        const val = passInput.value;
        const privacyAccepted = privacyConsent.checked;
        const isValid = val.length >= 8 && 
                      /[A-Z]/.test(val) && 
                      /[0-9]/.test(val) && 
                      /[^A-Za-z0-9]/.test(val) &&
                      val === confirmInput.value &&
                      val !== "" &&
                      privacyAccepted;
        
        btnSubmit.disabled = !isValid;
    }

    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            if (btnSubmit.disabled) return;

            try {
                btnSubmit.disabled = true;
                btnSubmit.innerHTML = '<i class="bi bi-hourglass-split"></i> Ativando...';

                const response = await fetch(`${window.API_BASE_URL}/auth/first-access`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        emailOrCpf: document.getElementById('emailOrCpf').value,
                        password: passInput.value
                    })
                });

                const json = await response.json();

                if (json.success) {
                    showToast('🎉 Conta ativada com sucesso!', 'success');
                    setTimeout(() => {
                        window.location.href = 'index.html?activated=true';
                    }, 2000);
                } else {
                    showToast(json.error || 'Erro ao validar dados', 'error');
                    btnSubmit.disabled = false;
                    btnSubmit.innerHTML = '<i class="bi bi-lightning-fill"></i> Ativar Minha Conta';
                }
            } catch (err) {
                showToast('📡 Falha na conexão com o servidor', 'error');
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = '<i class="bi bi-lightning-fill"></i> Ativar Minha Conta';
            }
        });
    }
});
