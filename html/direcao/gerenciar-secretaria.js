/**
 * gerenciar-secretaria.js — Painel de Controle de Secretaria (Diretor)
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Verificar Autenticação
    let user = null;
    try {
        user = JSON.parse(sessionStorage.getItem('currentUser'));
    } catch (e) {}

    if (!user || user.perfil !== 'diretor') {
        window.location.href = '../login.html';
        return;
    }

    // Atualiza dados da sidebar
    const nameEl = document.getElementById('sidebarUserName');
    const roleEl = document.getElementById('sidebarUserRole');
    if (nameEl) nameEl.textContent = user.nome || 'Diretor';
    if (roleEl) roleEl.textContent = 'Diretor';

    // 2. Elementos DOM
    const listaSecretarias = document.getElementById('listaSecretarias');
    const filtroNome = document.getElementById('filtroNome');
    const modalCadastro = document.getElementById('modalCadastro');
    const modalSenha = document.getElementById('modalSenha');
    const formSecretaria = document.getElementById('formSecretaria');
    const formRedefinirSenha = document.getElementById('formRedefinirSenha');

    const btnNovaSecretaria = document.getElementById('btnNovaSecretaria');
    const modalTitle = document.getElementById('modalTitle');
    const userIdInput = document.getElementById('userId');
    const nomeInput = document.getElementById('nome');
    const emailInput = document.getElementById('email');
    const telefoneInput = document.getElementById('telefone');
    const escolaInput = document.getElementById('escola');
    const senhaInput = document.getElementById('senha');
    const senhaGroup = document.getElementById('senhaGroup');
    const statusGroup = document.getElementById('statusGroup');
    const statusSelect = document.getElementById('ativo');

    const senhaUserIdInput = document.getElementById('senhaUserId');
    const emailSenhaInput = document.getElementById('emailSenha');
    const novaSenhaInput = document.getElementById('novaSenha');

    const BASE_URL = window.API_BASE_URL || (window.location.origin + '/api');

    let secretariasCache = [];

    // Celular/Telefone mask helper
    telefoneInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.slice(0, 11);
        if (v.length > 6) v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
        else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
        e.target.value = v;
    });

    // 3. Inicializar e Listar
    async function carregarSecretarias() {
        listaSecretarias.innerHTML = `<tr><td colspan="5" class="empty-state"><i class="bi bi-arrow-repeat spin"></i> Carregando contas...</td></tr>`;

        try {
            const res = await fetch(`${BASE_URL}/usuarios?perfil=secretaria`, {
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            });
            const resData = await res.json();

            if (!resData.success) {
                throw new Error(resData.error || 'Erro ao carregar secretarias.');
            }

            secretariasCache = resData.data || [];
            renderTabela(secretariasCache);

        } catch (err) {
            console.error(err);
            showToast(err.message || 'Erro ao carregar dados da secretaria.', 'error');
            listaSecretarias.innerHTML = `<tr><td colspan="5" class="empty-state" style="color: #ef4444;"><i class="bi bi-exclamation-triangle"></i> Falha na conexão com o servidor.</td></tr>`;
        }
    }

    function renderTabela(lista) {
        if (lista.length === 0) {
            listaSecretarias.innerHTML = `<tr><td colspan="5" class="empty-state"><i class="bi bi-person-badge-fill"></i> Nenhuma conta de secretaria encontrada.</td></tr>`;
            return;
        }

        listaSecretarias.innerHTML = '';
        lista.forEach(sec => {
            const tr = document.createElement('tr');

            const telFormatado = sec.telefone 
                ? sec.telefone.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
                : '-';

            const badgeHTML = sec.ativo 
                ? `<span class="user-badge badge-active"><i class="bi bi-check-circle"></i> Ativa</span>`
                : `<span class="user-badge badge-inactive"><i class="bi bi-dash-circle"></i> Suspensa</span>`;

            tr.innerHTML = `
                <td>
                    <div style="display:flex; align-items:center; gap:0.75rem;">
                        <div style="width:36px; height:36px; border-radius:50%; background:rgba(236,72,153,0.15); color:#ec4899; display:flex; align-items:center; justify-content:center; font-weight:700; border: 1px solid rgba(236,72,153,0.25);">
                            ${sec.nome ? sec.nome.charAt(0).toUpperCase() : 'S'}
                        </div>
                        <div>
                            <div style="font-weight:600; color:#fff;">${sec.nome}</div>
                            <span style="font-size:0.8rem; color:#64748b;">${sec.escola || 'Escola Geral'}</span>
                        </div>
                    </div>
                </td>
                <td>${sec.email}</td>
                <td>${telFormatado}</td>
                <td>${badgeHTML}</td>
                <td style="text-align:right;">
                    <div style="display:inline-flex; gap:0.5rem;">
                        <button class="btn-action btn-edit" title="Editar Cadastro" data-id="${sec._id || sec.id}">
                            <i class="bi bi-pencil-square"></i>
                        </button>
                        <button class="btn-action btn-reset" title="Mudar Senha" data-id="${sec._id || sec.id}">
                            <i class="bi bi-key-fill"></i>
                        </button>
                        <button class="btn-action btn-toggle" title="Alterar Status" data-id="${sec._id || sec.id}">
                            <i class="bi bi-power"></i>
                        </button>
                        <button class="btn-action btn-delete" title="Excluir Conta" data-id="${sec._id || sec.id}">
                            <i class="bi bi-trash-fill"></i>
                        </button>
                    </div>
                </td>
            `;
            listaSecretarias.appendChild(tr);
        });

        // Vincular ações
        listaSecretarias.querySelectorAll('.btn-edit').forEach(btn => {
            btn.addEventListener('click', () => abrirEditar(btn.getAttribute('data-id')));
        });
        listaSecretarias.querySelectorAll('.btn-reset').forEach(btn => {
            btn.addEventListener('click', () => abrirMudarSenha(btn.getAttribute('data-id')));
        });
        listaSecretarias.querySelectorAll('.btn-toggle').forEach(btn => {
            btn.addEventListener('click', () => alternarStatus(btn.getAttribute('data-id')));
        });
        listaSecretarias.querySelectorAll('.btn-delete').forEach(btn => {
            btn.addEventListener('click', () => excluirConta(btn.getAttribute('data-id')));
        });
    }

    // 4. Filtro em tempo real
    if (filtroNome) {
        filtroNome.addEventListener('input', () => {
            const query = filtroNome.value.toLowerCase().trim();
            const filtrados = secretariasCache.filter(sec => 
                (sec.nome && sec.nome.toLowerCase().includes(query)) ||
                (sec.email && sec.email.toLowerCase().includes(query))
            );
            renderTabela(filtrados);
        });
    }

    // 5. Cadastro & Edição Modais
    btnNovaSecretaria.addEventListener('click', () => {
        formSecretaria.reset();
        userIdInput.value = '';
        modalTitle.textContent = 'Novo Cadastro de Secretaria';
        senhaGroup.style.display = 'block';
        senhaInput.required = true;
        statusGroup.style.display = 'none';
        modalCadastro.classList.add('open');
    });

    window.fecharModal = () => {
        modalCadastro.classList.remove('open');
    };

    window.fecharModalSenha = () => {
        modalSenha.classList.remove('open');
    };

    function abrirEditar(id) {
        const sec = secretariasCache.find(s => (s._id || s.id) === id);
        if (!sec) return;

        userIdInput.value = id;
        nomeInput.value = sec.nome || '';
        emailInput.value = sec.email || '';
        telefoneInput.value = sec.telefone || '';
        escolaInput.value = sec.escola || '';
        modalTitle.textContent = 'Editar Conta de Secretaria';
        senhaGroup.style.display = 'none';
        senhaInput.required = false;
        statusGroup.style.display = 'block';
        statusSelect.value = String(sec.ativo);

        modalCadastro.classList.add('open');
    }

    function abrirMudarSenha(id) {
        const sec = secretariasCache.find(s => (s._id || s.id) === id);
        if (!sec) return;

        formRedefinirSenha.reset();
        senhaUserIdInput.value = id;
        emailSenhaInput.value = sec.email;
        modalSenha.classList.add('open');
    }

    // 6. Submeter Cadastro/Edição
    formSecretaria.addEventListener('submit', async (e) => {
        e.preventDefault();

        const id = userIdInput.value;
        const nome = nomeInput.value.trim();
        const email = emailInput.value.trim();
        const telefone = telefoneInput.value.replace(/\D/g, '');
        const escola = escolaInput.value.trim();

        const data = { nome, email, telefone, escola };

        const isEditing = !!id;

        if (isEditing) {
            data.ativo = statusSelect.value === 'true';
        } else {
            const senha = senhaInput.value;
            if (senha.length < 8) {
                showToast('A senha inicial deve ter no mínimo 8 caracteres.', 'error');
                return;
            }
            data.senha = senha;
            data.perfil = 'secretaria';
            data.ativo = true;
        }

        try {
            const method = isEditing ? 'PUT' : 'POST';
            const url = isEditing ? `${BASE_URL}/usuarios/${id}` : `${BASE_URL}/usuarios`;

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(data)
            });

            const resData = await res.json();
            if (!resData.success) {
                throw new Error(resData.error || 'Erro ao salvar informações.');
            }

            showToast(isEditing ? 'Cadastro atualizado com sucesso!' : 'Secretaria cadastrada com sucesso!', 'success');
            fecharModal();
            carregarSecretarias();

        } catch (err) {
            console.error(err);
            showToast(err.message || 'Erro ao persistir dados.', 'error');
        }
    });

    // 7. Submeter Redefinir Senha
    formRedefinirSenha.addEventListener('submit', async (e) => {
        e.preventDefault();

        const id = senhaUserIdInput.value;
        const novaSenha = novaSenhaInput.value;

        if (novaSenha.length < 8) {
            showToast('A nova senha deve ter no mínimo 8 caracteres.', 'error');
            return;
        }

        try {
            const res = await fetch(`${BASE_URL}/usuarios/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ senha: novaSenha })
            });

            const resData = await res.json();
            if (!resData.success) {
                throw new Error(resData.error || 'Erro ao atualizar senha.');
            }

            showToast('Senha redefinida com sucesso!', 'success');
            fecharModalSenha();

        } catch (err) {
            console.error(err);
            showToast(err.message || 'Erro ao atualizar senha.', 'error');
        }
    });

    // 8. Alternar Status Rápido
    async function alternarStatus(id) {
        const sec = secretariasCache.find(s => (s._id || s.id) === id);
        if (!sec) return;

        const novoStatus = !sec.ativo;

        try {
            const res = await fetch(`${BASE_URL}/usuarios/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ ativo: novoStatus })
            });

            const resData = await res.json();
            if (!resData.success) {
                throw new Error(resData.error || 'Erro ao atualizar status.');
            }

            showToast(`Conta da Secretaria ${novoStatus ? 'ativada' : 'suspensa'} com sucesso!`, 'success');
            carregarSecretarias();

        } catch (err) {
            console.error(err);
            showToast(err.message || 'Erro ao alterar status.', 'error');
        }
    }

    // 9. Excluir Conta permanentemente
    async function excluirConta(id) {
        const sec = secretariasCache.find(s => (s._id || s.id) === id);
        if (!sec) return;

        const confirmacao = confirm(`Tem certeza absoluta que deseja excluir a conta de secretaria de "${sec.nome}"? Esta operação é irreversível.`);
        if (!confirmacao) return;

        try {
            const res = await fetch(`${BASE_URL}/usuarios/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            const resData = await res.json();
            if (!resData.success) {
                throw new Error(resData.error || 'Erro ao excluir conta.');
            }

            showToast('Conta de secretaria excluída permanentemente.', 'success');
            carregarSecretarias();

        } catch (err) {
            console.error(err);
            showToast(err.message || 'Erro ao excluir conta.', 'error');
        }
    }

    // 10. Toasts Helper (Padronizado)
    function showToast(msg, type) {
        const container = document.getElementById('toast-container');
        if (!container) { alert(msg); return; }

        const toast = document.createElement('div');
        toast.className = 'dnc-toast';
        toast.style.background = type === 'error' ? 'linear-gradient(135deg, #ef4444, #dc2626)' : 'linear-gradient(135deg, #10b981, #059669)';
        toast.style.padding = '1rem 1.5rem';
        toast.style.borderRadius = '12px';
        toast.style.color = '#fff';
        toast.style.marginBottom = '10px';
        toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.2)';
        toast.style.display = 'flex';
        toast.style.alignItems = 'center';
        toast.style.gap = '10px';
        toast.style.fontWeight = '600';
        toast.style.fontSize = '0.95rem';

        toast.innerHTML = `<i class="bi ${type === 'error' ? 'bi-exclamation-circle' : 'bi-check-circle'}"></i> ${msg}`;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }

    // Executa primeira carga
    carregarSecretarias();
});
