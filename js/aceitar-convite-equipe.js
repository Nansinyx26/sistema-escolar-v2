/**
 * Aceite do convite de direção e secretaria (Issue #386).
 *
 * As páginas `cadastro-diretor-publico.html` e `cadastro-secretaria-publico.html`
 * só criam conta com um convite de uso único enviado pela administração. O
 * token chega no FRAGMENTO da URL (`#convite=...`): o navegador não o envia ao
 * servidor nem o repassa no Referer. Assim que é lido, sai da barra de endereço.
 *
 * Nenhuma sessão é criada aqui: depois do aceite a pessoa entra pelo login do
 * perfil, com senha e segundo fator.
 */
document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('form[data-perfil]');
    if (!form) return;

    const info = document.getElementById('conviteInfo');
    const senhaInput = document.getElementById('senha');
    const confirmSenhaInput = document.getElementById('confirmSenha');
    const submitBtn = document.getElementById('btnSubmit');
    const API = window.API_BASE_URL || `${window.location.origin}/api`;

    const ROTULO = { diretor: 'direção', secretaria: 'secretaria' };

    const token = lerToken();

    alternarVisibilidade(document.getElementById('btn-toggle-senha'), senhaInput);
    alternarVisibilidade(document.getElementById('btn-toggle-confirmSenha'), confirmSenhaInput);
    mascaraTelefone(document.getElementById('telefone'));

    if (!token) {
        mostrarInfo(
            'Para criar a conta você precisa do link de convite. Se ainda não recebeu, procure a Secretaria de Educação.'
        );
        return;
    }

    consultarConvite();

    function lerToken() {
        const hash = window.location.hash || '';
        const match = hash.match(/convite=([A-Za-z0-9_-]{20,100})/);
        if (!match) return null;
        // Tira o token da barra de endereço (e do histórico desta entrada).
        history.replaceState(null, '', window.location.pathname + window.location.search);
        return match[1];
    }

    async function consultarConvite() {
        mostrarInfo('Conferindo o convite…');
        try {
            const res = await fetch(`${API}/auth/convite-equipe/consultar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
            });
            const data = await res.json();
            if (!data.success) {
                mostrarInfo(data.error || 'Convite inválido.');
                return;
            }
            const { perfil, escolaNome, emailMascarado, expiraEm } = data.data;
            if (perfil !== form.dataset.perfil) {
                mostrarInfo(
                    'Este convite é para outro perfil. Use o link exatamente como recebido.'
                );
                return;
            }
            const prazo = new Date(expiraEm).toLocaleString('pt-BR');
            mostrarInfo(
                `Convite de ${ROTULO[perfil]}${escolaNome ? ` da escola ${escolaNome}` : ''} para ${emailMascarado}. Válido até ${prazo}.`
            );
            form.hidden = false;
            document.getElementById('nome')?.focus();
        } catch (_e) {
            mostrarInfo('Não foi possível conferir o convite agora. Tente novamente em instantes.');
        }
    }

    // Requisitos de senha em tempo real
    const requisitos = {
        'req-length': (v) => v.length >= 8,
        'req-upper': (v) => /[A-Z]/.test(v),
        'req-number': (v) => /[0-9]/.test(v),
        'req-special': (v) => /[^A-Za-z0-9]/.test(v),
    };
    senhaInput?.addEventListener('input', () => {
        for (const [id, regra] of Object.entries(requisitos)) {
            marcarRequisito(document.getElementById(id), regra(senhaInput.value));
        }
        checkFormReady();
    });
    confirmSenhaInput?.addEventListener('input', checkFormReady);
    for (const id of ['nome', 'email', 'telefone']) {
        document.getElementById(id)?.addEventListener('input', checkFormReady);
    }
    window.ConsentimentoCadastro?.caixa()?.addEventListener('change', checkFormReady);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = document.getElementById('nome').value.trim();
        const email = document.getElementById('email').value.trim();
        const telefone = document.getElementById('telefone').value.replace(/\D/g, '');
        const senha = senhaInput.value;

        if (senha !== confirmSenhaInput.value) {
            showToast('As senhas não coincidem.', 'error');
            return;
        }
        if (!window.ConsentimentoCadastro?.marcado()) {
            showToast('Para criar a conta, leia e aceite a Política de Privacidade.', 'error');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Criando conta...';
        try {
            const res = await fetch(`${API}/auth/convite-equipe/aceitar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token,
                    nome,
                    email,
                    telefone,
                    senha,
                    consentimentoLgpd: window.ConsentimentoCadastro.payload(),
                }),
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Erro ao criar conta.');

            form.hidden = true;
            mostrarInfo(
                'Conta criada. Você será levado ao login para entrar com e-mail, senha e o código de verificação.'
            );
            setTimeout(() => {
                window.location.href = data.redirect_to || '../login.html';
            }, 2500);
        } catch (error) {
            showToast(error.message || 'Erro ao criar conta.', 'error');
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="bi bi-check-circle-fill"></i> Criar minha conta';
        }
    });

    function checkFormReady() {
        const senha = senhaInput?.value || '';
        const preenchido = ['nome', 'email', 'telefone'].every((id) =>
            document.getElementById(id)?.value.trim()
        );
        const senhaOk = Object.values(requisitos).every((regra) => regra(senha));
        const confere = senha && senha === confirmSenhaInput?.value;
        const aceite = Boolean(window.ConsentimentoCadastro?.marcado());
        submitBtn.disabled = !(preenchido && senhaOk && confere && aceite);
    }

    function mostrarInfo(texto) {
        if (info) info.textContent = texto;
    }

    function marcarRequisito(el, valido) {
        if (!el) return;
        el.classList.toggle('valid', valido);
        const icone = el.querySelector('i');
        if (icone) icone.className = valido ? 'bi bi-check-circle-fill' : 'bi bi-circle';
    }

    function mascaraTelefone(input) {
        input?.addEventListener('input', (e) => {
            let v = e.target.value.replace(/\D/g, '');
            if (v.length > 11) v = v.slice(0, 11);
            if (v.length > 6) v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
            else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
            e.target.value = v;
        });
    }

    function alternarVisibilidade(btn, input) {
        btn?.addEventListener('click', () => {
            const visivel = input.type === 'password';
            input.type = visivel ? 'text' : 'password';
            btn.innerHTML = visivel
                ? '<i class="bi bi-eye"></i>'
                : '<i class="bi bi-eye-slash"></i>';
        });
    }

    function showToast(msg, type) {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'dnc-toast';
        toast.setAttribute('role', 'alert');
        toast.style.background =
            type === 'error'
                ? 'linear-gradient(135deg, #ef4444, #dc2626)'
                : 'linear-gradient(135deg, #10b981, #059669)';
        const icone = document.createElement('i');
        icone.className = `bi ${type === 'error' ? 'bi-exclamation-circle' : 'bi-check-circle'}`;
        toast.append(icone, ` ${msg}`);
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }
});
