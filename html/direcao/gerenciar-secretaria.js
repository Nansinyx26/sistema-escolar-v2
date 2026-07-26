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

    const escolaBadge = document.getElementById('escolaAtivaBadge');
    const escolaBadgeTexto = document.getElementById('escolaAtivaNomeTexto');
    const escolaHint = document.getElementById('escolaHint');
    const statTotal = document.getElementById('statTotal');
    const statAtivas = document.getElementById('statAtivas');
    const statSuspensas = document.getElementById('statSuspensas');

    const BASE_URL = window.API_BASE_URL || (window.location.origin + '/api');

    let secretariasCache = [];
    // Escola ativa da sessão — a lista do backend já vem filtrada por ela, então
    // é o mesmo escopo mostrado no badge e herdado por cadastros novos.
    let escolaAtiva = null;

    // Celular/Telefone mask helper
    telefoneInput.addEventListener('input', (e) => {
        let v = e.target.value.replace(/\D/g, '');
        if (v.length > 11) v = v.slice(0, 11);
        if (v.length > 6) v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
        else if (v.length > 2) v = v.replace(/(\d{2})(\d{0,5})/, '($1) $2');
        e.target.value = v;
    });

    // Nome, e-mail e escola vêm do banco e são injetados via innerHTML —
    // escapar evita que um cadastro com `<img onerror=...>` execute script.
    function esc(valor) {
        return String(valor == null ? '' : valor)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // 2b. Contexto multi-escola: identifica em qual escola o diretor está.
    //     O backend já isola a listagem por essa escola — aqui é só para deixar
    //     explícito na tela de qual instituição são as contas exibidas.
    async function carregarEscolaAtiva() {
        try {
            const res = await fetch(`${BASE_URL}/escolas/minhas`, {
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            });
            if (!res.ok) return;

            const json = await res.json();
            if (!json.success || !Array.isArray(json.data) || !json.data.length) return;

            escolaAtiva = json.data.find(e => String(e._id) === String(json.escolaAtivaId))
                || (json.data.length === 1 ? json.data[0] : null);

            if (escolaAtiva && escolaBadge) {
                escolaBadgeTexto.textContent = escolaAtiva.nome;
                escolaBadge.hidden = false;
            }
        } catch (err) {
            // Contexto é informativo: sem ele a página continua funcionando
            console.warn('Não foi possível identificar a escola ativa:', err);
        }
    }

    // Mensagem de estado (vazio / erro) ocupando a tabela inteira
    function renderEstado({ icone, titulo, texto, erro = false, acao = false }) {
        listaSecretarias.innerHTML = `
            <tr>
                <td colspan="5">
                    <div class="empty-box${erro ? ' is-error' : ''}">
                        <div class="empty-icon"><i class="bi ${icone}"></i></div>
                        <h4>${titulo}</h4>
                        <p>${texto}</p>
                        ${acao ? `<button type="button" class="btn btn-primary" id="btnEmptyCadastro">
                            <i class="bi bi-person-plus-fill"></i> Cadastrar primeira secretaria
                        </button>` : ''}
                    </div>
                </td>
            </tr>`;

        const btn = document.getElementById('btnEmptyCadastro');
        if (btn) btn.addEventListener('click', abrirNovoCadastro);
    }

    function atualizarStats(lista) {
        const ativas = lista.filter(s => s.ativo).length;
        statTotal.textContent = lista.length;
        statAtivas.textContent = ativas;
        statSuspensas.textContent = lista.length - ativas;
    }

    // 3. Inicializar e Listar
    async function carregarSecretarias() {
        renderEstado({
            icone: 'bi-arrow-repeat spin',
            titulo: 'Carregando contas...',
            texto: 'Buscando as contas de secretaria vinculadas a esta escola.'
        });

        try {
            const res = await fetch(`${BASE_URL}/usuarios?perfil=secretaria`, {
                headers: { 'Accept': 'application/json' },
                credentials: 'include'
            });
            const resData = await res.json().catch(() => ({}));

            // 409: o diretor tem vínculo com mais de uma escola e a sessão ainda
            // não sabe em qual ele está — sem escolher, não há lista para exibir.
            if (res.status === 409 && resData.requiresEscolha) {
                atualizarStats([]);
                renderEstado({
                    icone: 'bi-buildings',
                    titulo: 'Selecione a escola',
                    texto: 'Você tem vínculo com mais de uma escola. Escolha no seletor da barra lateral em qual deseja trabalhar para ver as contas de secretaria dela.'
                });
                return;
            }

            if (res.status === 401 || res.status === 403) {
                window.location.href = '../login.html';
                return;
            }

            if (!res.ok || !resData.success) {
                throw new Error(resData.error || 'Erro ao carregar secretarias.');
            }

            secretariasCache = resData.data || [];
            atualizarStats(secretariasCache);
            renderTabela(secretariasCache);

        } catch (err) {
            console.error(err);
            showToast(err.message || 'Erro ao carregar dados da secretaria.', 'error');
            atualizarStats([]);
            renderEstado({
                icone: 'bi-exclamation-triangle',
                titulo: 'Não foi possível carregar as contas',
                texto: esc(err.message) || 'Falha na conexão com o servidor. Verifique sua internet e tente novamente.',
                erro: true
            });
        }
    }

    function renderTabela(lista) {
        if (lista.length === 0) {
            // Distingue "não existe nenhuma" de "o filtro não achou nada" —
            // eram a mesma caixa vazia antes, e a segunda parecia erro.
            const filtrando = filtroNome && filtroNome.value.trim();
            if (filtrando) {
                renderEstado({
                    icone: 'bi-search',
                    titulo: 'Nenhum resultado',
                    texto: `Nenhuma conta corresponde a "${esc(filtroNome.value.trim())}". Tente outro nome ou e-mail.`
                });
            } else {
                renderEstado({
                    icone: 'bi-person-badge-fill',
                    titulo: 'Nenhuma conta de secretaria ainda',
                    texto: escolaAtiva
                        ? `A escola ${esc(escolaAtiva.nome)} ainda não tem contas de secretaria. Cadastre a primeira para liberar o acesso ao painel administrativo.`
                        : 'Cadastre a primeira conta de secretaria para liberar o acesso ao painel administrativo.',
                    acao: true
                });
            }
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
                            <div style="font-weight:600; color:#fff;">${esc(sec.nome)}</div>
                            <span style="font-size:0.8rem; color:#64748b;">${esc(sec.escola || (escolaAtiva && escolaAtiva.nome) || 'Escola Geral')}</span>
                        </div>
                    </div>
                </td>
                <td>${esc(sec.email)}</td>
                <td>${esc(telFormatado)}</td>
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
    function abrirNovoCadastro() {
        formSecretaria.reset();
        userIdInput.value = '';
        modalTitle.textContent = 'Novo Cadastro de Secretaria';
        senhaGroup.style.display = 'block';
        senhaInput.required = true;
        statusGroup.style.display = 'none';
        emailInput.readOnly = false;

        // A conta sempre nasce na escola ativa da sessão (o backend ignora
        // qualquer escolaId enviado pelo cliente). Deixar o campo livre dava a
        // impressão de que dava pra cadastrar em outra escola daqui.
        if (escolaAtiva) {
            escolaInput.value = escolaAtiva.nome;
            escolaInput.readOnly = true;
            if (escolaHint) escolaHint.hidden = false;
        } else {
            escolaInput.readOnly = false;
            if (escolaHint) escolaHint.hidden = true;
        }

        modalCadastro.classList.add('open');
    }

    btnNovaSecretaria.addEventListener('click', abrirNovoCadastro);

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
        escolaInput.value = sec.escola || (escolaAtiva ? escolaAtiva.nome : '');
        modalTitle.textContent = 'Editar Conta de Secretaria';
        senhaGroup.style.display = 'none';
        senhaInput.required = false;
        statusGroup.style.display = 'block';
        statusSelect.value = String(sec.ativo);

        // E-mail e escola são identidade/tenant da conta: o backend descarta
        // alterações neles vindas do diretor. Campos editáveis aqui davam a
        // impressão de que a mudança foi salva quando nada acontecia.
        emailInput.readOnly = true;
        escolaInput.readOnly = true;
        if (escolaHint) escolaHint.hidden = true;

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

    // Executa primeira carga — a escola ativa vem antes para que o estado
    // vazio e o modal de cadastro já saibam de qual instituição se trata.
    (async () => {
        await carregarEscolaAtiva();
        await carregarSecretarias();
    })();
});
