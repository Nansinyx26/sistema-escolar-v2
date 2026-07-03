/**
 * Cadastro de Secretaria
 * Permite que admin ou diretor criem contas de secretaria.
 */

document.addEventListener('DOMContentLoaded', async () => {
    await db.init();
    await auth.init();

    const user = auth.getCurrentUser();
    if (!auth.isAuthenticated() || !user || !['admin', 'diretor'].includes(user.perfil)) {
        window.location.href = '../../login.html';
        return;
    }

    setupForm();
    setupBackButton();
});

function setupForm() {
    const form = document.getElementById('cadastroSecretariaForm');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const nome = document.getElementById('secretariaNome').value.trim();
        const email = document.getElementById('secretariaEmail').value.trim();
        const telefone = document.getElementById('secretariaTelefone').value.trim();
        const escola = document.getElementById('secretariaEscola').value.trim();
        const senha = document.getElementById('secretariaSenha').value;
        const observacoes = document.getElementById('secretariaObservacoes').value.trim();

        if (!nome || !email || !telefone || !escola || !senha) {
            showToast('Preencha todos os campos obrigatórios.', 'error');
            return;
        }

        if (!email.includes('@')) {
            showToast('Informe um email válido.', 'error');
            return;
        }

        if (senha.length < 8) {
            showToast('A senha deve ter ao menos 8 caracteres.', 'error');
            return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        showLoading(submitBtn);

        try {
            const payload = {
                nome,
                email,
                telefone,
                escola,
                senha,
                perfil: 'secretaria',
                ativo: true,
                observacoes
            };

            const res = await fetch(`${window.API_BASE_URL}/usuarios`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!data.success) {
                throw new Error(data.error || 'Erro ao criar conta de secretaria.');
            }

            showToast('Conta de secretaria criada com sucesso!', 'success');
            await sleep(900);
            window.location.href = 'usuarios.html';
        } catch (error) {
            console.error('Erro criar secretaria:', error);
            showToast(error.message || 'Erro ao criar conta de secretaria.', 'error');
        } finally {
            hideLoading(submitBtn);
        }
    });
}

function setupBackButton() {
    const btn = document.getElementById('btn-voltar-secretaria');
    if (!btn) return;

    btn.addEventListener('click', () => {
        if (confirm('Deseja voltar para a lista de usuários? As informações não salvas serão perdidas.')) {
            window.location.href = 'usuarios.html';
        }
    });
}
