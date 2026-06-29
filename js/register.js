/**
 * register.js — Lógica compartilhada de validação e submissão para as páginas
 * de cadastro de Docente e Responsável (Primeiro Acesso).
 *
 * Detecta automaticamente qual formulário está presente na página e se liga aos
 * campos corretos.
 */
document.addEventListener('DOMContentLoaded', () => {
    // ── Detecta o tipo de formulário ─────────────────────────────────────
    const docenteForm = document.getElementById('docenteRegisterForm');
    const responsavelForm = document.getElementById('responsavelRegisterForm');
    const form = docenteForm || responsavelForm;
    if (!form) return; // Nenhum formulário encontrado

    const isDocente = !!docenteForm;

    // ── Campos comuns ────────────────────────────────────────────────────
    const senhaInput = document.getElementById('senha');
    const confirmInput = document.getElementById('confirmSenha');
    const btnSubmit = document.getElementById('btnSubmit');

    // ── Utilitário de toast ──────────────────────────────────────────────
    function showToast(msg, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'dnc-toast';
        toast.style.background = type === 'error'
            ? 'linear-gradient(135deg, #ef4444, #dc2626)'
            : 'linear-gradient(135deg, #10b981, #059669)';
        toast.innerHTML = `<i class="bi ${type === 'error' ? 'bi-x-circle' : 'bi-check-circle'}"></i> ${msg}`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4500);
    }

    // ── Carregamento dinâmico de turmas (apenas para docente) ─────────────
    if (isDocente) {
        const turmaSelect = document.getElementById('turma');
        if (turmaSelect && turmaSelect.tagName === 'SELECT') {
            // Lista padrão de turmas caso o banco esteja vazio
            const TURMAS_PADRAO = [
                '1º Ano A', '1º Ano B', '1º Ano C', '1º Ano D',
                '2º Ano A', '2º Ano B', '2º Ano C', '2º Ano D',
                '3º Ano A', '3º Ano B', '3º Ano C', '3º Ano D',
                '4º Ano A', '4º Ano B', '4º Ano C', '4º Ano D',
                '5º Ano A', '5º Ano B', '5º Ano C', '5º Ano D',
                '6º Ano A', '6º Ano B', '6º Ano C', '6º Ano D',
                '7º Ano A', '7º Ano B', '7º Ano C', '7º Ano D',
                '8º Ano A', '8º Ano B', '8º Ano C', '8º Ano D',
                '9º Ano A', '9º Ano B', '9º Ano C', '9º Ano D'
            ];

            function populateSelect(lista) {
                turmaSelect.innerHTML = '';
                const defaultOpt = document.createElement('option');
                defaultOpt.value = '';
                defaultOpt.disabled = true;
                defaultOpt.selected = true;
                defaultOpt.textContent = 'Selecione a turma';
                turmaSelect.appendChild(defaultOpt);

                lista.forEach(nome => {
                    const opt = document.createElement('option');
                    opt.value = nome;
                    opt.textContent = nome;
                    turmaSelect.appendChild(opt);
                });
                validateForm();
            }

            const API_BASE = window.API_BASE_URL || '/api';
            fetch(`${API_BASE}/auth/turmas-publicas`, { credentials: 'include' })
                .then(res => res.json())
                .then(data => {
                    const turmas = data.data || data || [];
                    if (turmas.length > 0) {
                        const nomes = turmas.map(t => t.nome || t.id || t._id);
                        // Ordena naturalmente: primeiro pelo número, depois pela letra
                        nomes.sort((a, b) => {
                            const numA = parseInt(a.replace(/\D/g, '')) || 0;
                            const numB = parseInt(b.replace(/\D/g, '')) || 0;
                            if (numA !== numB) return numA - numB;
                            const letraA = a.replace(/[^A-Za-z]/g, '').toUpperCase();
                            const letraB = b.replace(/[^A-Za-z]/g, '').toUpperCase();
                            return letraA.localeCompare(letraB);
                        });
                        populateSelect(nomes);
                    } else {
                        populateSelect(TURMAS_PADRAO);
                    }
                })
                .catch(() => {
                    populateSelect(TURMAS_PADRAO);
                });
        }
    }

    // ── Olhinho (toggle senha) ───────────────────────────────────────────
    function setupToggle(btnId, inputId) {
        const btn = document.getElementById(btnId);
        const inp = document.getElementById(inputId);
        if (!btn || !inp) return;
        btn.addEventListener('click', () => {
            const icon = btn.querySelector('i');
            if (inp.type === 'password') {
                inp.type = 'text';
                icon.classList.replace('bi-eye', 'bi-eye-slash');
            } else {
                inp.type = 'password';
                icon.classList.replace('bi-eye-slash', 'bi-eye');
            }
        });
    }
    setupToggle('btn-toggle-senha', 'senha');
    setupToggle('btn-toggle-confirmSenha', 'confirmSenha');

    // ── Máscara de telefone ──────────────────────────────────────────────
    const telInput = document.getElementById('telefone');
    if (telInput) {
        telInput.addEventListener('input', () => {
            let v = telInput.value.replace(/\D/g, '');
            if (v.length > 11) v = v.slice(0, 11);
            if (v.length > 6) {
                v = `(${v.slice(0, 2)}) ${v.slice(2, 7)}-${v.slice(7)}`;
            } else if (v.length > 2) {
                v = `(${v.slice(0, 2)}) ${v.slice(2)}`;
            }
            telInput.value = v;
            validateForm();
        });
    }

    // ── Validação de requisitos de senha em tempo real ────────────────────
    senhaInput.addEventListener('input', () => {
        const val = senhaInput.value;
        const reqs = {
            length: val.length >= 8,
            upper:  /[A-Z]/.test(val),
            number: /[0-9]/.test(val),
            special: /[^A-Za-z0-9]/.test(val)
        };
        Object.keys(reqs).forEach(key => {
            const el = document.getElementById(`req-${key}`);
            if (!el) return;
            if (reqs[key]) {
                el.classList.add('valid');
                el.querySelector('i').className = 'bi bi-check-circle-fill';
            } else {
                el.classList.remove('valid');
                el.querySelector('i').className = 'bi bi-circle';
            }
        });
        validateForm();
    });

    confirmInput.addEventListener('input', validateForm);

    // Escuta mudanças em todos os inputs do formulário para revalidar
    form.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('input', validateForm);
        el.addEventListener('change', validateForm);
    });

    // ── Função de validação geral ────────────────────────────────────────
    function validateForm() {
        const val = senhaInput.value;
        const passOk = val.length >= 8
            && /[A-Z]/.test(val)
            && /[0-9]/.test(val)
            && /[^A-Za-z0-9]/.test(val)
            && val === confirmInput.value
            && val !== '';

        // Verifica se todos os campos obrigatórios estão preenchidos
        let allFilled = true;
        form.querySelectorAll('[required]').forEach(el => {
            if (!el.value || el.value.trim() === '') allFilled = false;
        });

        btnSubmit.disabled = !(passOk && allFilled);
    }

    // ── Submissão do formulário ──────────────────────────────────────────
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (btnSubmit.disabled) return;

        const originalHTML = btnSubmit.innerHTML;
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<i class="bi bi-hourglass-split"></i> Registrando...';

        try {
            const API_BASE = window.API_BASE_URL || '/api';
            let endpoint, body;

            if (isDocente) {
                endpoint = `${API_BASE}/auth/register-docente`;
                body = {
                    nome:       document.getElementById('nome').value.trim(),
                    email:      document.getElementById('email').value.trim(),
                    senha:      senhaInput.value,
                    disciplina: document.getElementById('disciplina').value.trim(),
                    turma:      document.getElementById('turma').value.trim(),
                    matricula:  document.getElementById('matricula').value.trim(),
                    telefone:   document.getElementById('telefone').value.trim(),
                    codigoEscola: document.getElementById('codigoEscola').value.trim()
                };
            } else {
                endpoint = `${API_BASE}/auth/register-responsavel`;
                body = {
                    nome:       document.getElementById('nome').value.trim(),
                    email:      document.getElementById('email').value.trim(),
                    senha:      senhaInput.value,
                    telefone:   document.getElementById('telefone').value.trim(),
                    codigoSecreto: document.getElementById('codigoSecreto').value.trim().toUpperCase()
                };
            }

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
            });

            const data = await res.json();

            if (data.success) {
                showToast('🎉 Conta criada com sucesso! Redirecionando...', 'success');

                // Salva sessão localmente para uso imediato no dashboard
                if (data.user) {
                    sessionStorage.setItem('currentUser', JSON.stringify(data.user));
                }

                setTimeout(() => {
                    if (isDocente) {
                        window.location.href = '../dashboard.html';
                    } else {
                        window.location.href = '../portal-responsavel/dist/index.html';
                    }
                }, 2000);
            } else {
                showToast(data.error || 'Erro ao criar conta.', 'error');
                btnSubmit.disabled = false;
                btnSubmit.innerHTML = originalHTML;
            }
        } catch (err) {
            console.error('Erro no registro:', err);
            showToast('📡 Falha na conexão com o servidor.', 'error');
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = originalHTML;
        }
    });
});
