/**
 * Convites de direção e secretaria — tela do admin (Issue #386).
 *
 * O link do convite só existe na resposta de criação: o servidor guarda o hash
 * do token, não o token. Por isso a tela mostra o link uma única vez, para o
 * admin copiar e entregar se o e-mail não chegar.
 */
document.addEventListener('DOMContentLoaded', async () => {
    const API = window.API_BASE_URL;
    const tabela = document.getElementById('tabelaConvites');
    const form = document.getElementById('formConvite');
    const resultado = document.getElementById('resultadoConvite');
    const selectEscola = document.getElementById('conviteEscola');
    const botaoCriar = document.getElementById('btnCriarConvite');

    await auth.init();
    const user = auth.getCurrentUser();
    if (!user || user.perfil !== 'admin') {
        window.location.href = '../login.html';
        return;
    }

    const ROTULO_PERFIL = { diretor: 'Direção', secretaria: 'Secretaria' };
    const ROTULO_SITUACAO = {
        ativo: ['Aguardando aceite', 'badge-success'],
        usado: ['Conta criada', 'badge-info'],
        revogado: ['Revogado', 'badge-inativa'],
        expirado: ['Expirado', 'badge-inativa'],
    };

    function escapeHtml(s) {
        return String(s == null ? '' : s).replace(
            /[&<>"']/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
        );
    }

    function avisar(msg, tipo) {
        if (typeof showToast === 'function') showToast(msg, tipo);
    }

    async function carregarEscolas() {
        try {
            const res = await fetch(`${API}/escolas`, { credentials: 'include' });
            const json = await res.json();
            const escolas = json.success ? json.data || [] : [];
            selectEscola.innerHTML =
                '<option value="">Selecione…</option>' +
                escolas
                    .map(
                        (e) => `<option value="${escapeHtml(e._id)}">${escapeHtml(e.nome)}</option>`
                    )
                    .join('');
        } catch (_e) {
            selectEscola.innerHTML = '<option value="">Erro ao carregar escolas</option>';
        }
    }

    async function carregarConvites() {
        tabela.innerHTML = '<tr><td colspan="5" class="text-center">Carregando...</td></tr>';
        try {
            const res = await fetch(`${API}/admin/convites-equipe`, { credentials: 'include' });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Erro ao carregar convites');
            const lista = json.data || [];
            if (!lista.length) {
                tabela.innerHTML =
                    '<tr><td colspan="5" class="text-center">Nenhum convite enviado.</td></tr>';
                return;
            }
            tabela.innerHTML = lista
                .map((c) => {
                    const [rotulo, classe] = ROTULO_SITUACAO[c.situacao] || [c.situacao, ''];
                    const validade = new Date(c.expiraEm).toLocaleString('pt-BR');
                    const acao =
                        c.situacao === 'ativo'
                            ? `<button type="button" class="btn-icon" data-revogar="${escapeHtml(c.id)}" title="Revogar convite" aria-label="Revogar convite"><i class="bi bi-x-circle"></i></button>`
                            : '';
                    return `<tr>
                        <td>${escapeHtml(c.email)}</td>
                        <td>${escapeHtml(ROTULO_PERFIL[c.perfil] || c.perfil)}</td>
                        <td><span class="badge ${classe}">${escapeHtml(rotulo)}</span></td>
                        <td>${escapeHtml(validade)}</td>
                        <td>${acao}</td>
                    </tr>`;
                })
                .join('');
        } catch (e) {
            tabela.innerHTML = `<tr><td colspan="5" class="text-center">${escapeHtml(e.message)}</td></tr>`;
        }
    }

    function mostrarLink(dados) {
        resultado.hidden = false;
        resultado.innerHTML = '';
        const titulo = document.createElement('p');
        titulo.innerHTML = dados.emailEnviado
            ? '<strong>Convite enviado por e-mail.</strong> Se a pessoa não receber, entregue o link abaixo.'
            : '<strong>O e-mail não pôde ser enviado.</strong> Entregue o link abaixo diretamente à pessoa.';
        const link = document.createElement('p');
        link.className = 'link-gerado';
        link.textContent = dados.link;
        const aviso = document.createElement('p');
        aviso.className = 'text-secondary text-sm';
        aviso.textContent =
            'Este link aparece só agora e vale uma única vez. Não o envie por grupo nem o deixe salvo em conversa aberta.';
        const copiar = document.createElement('button');
        copiar.type = 'button';
        copiar.className = 'btn btn-secondary btn-sm';
        copiar.innerHTML = '<i class="bi bi-clipboard"></i> Copiar link';
        copiar.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(dados.link);
                avisar('Link copiado.', 'success');
            } catch (_e) {
                avisar('Não foi possível copiar. Selecione o link e copie manualmente.', 'error');
            }
        });
        resultado.append(titulo, link, copiar, aviso);
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('conviteEmail').value.trim();
        const perfil = document.getElementById('convitePerfil').value;
        const escolaId = selectEscola.value;
        if (!email || !escolaId) {
            avisar('Informe o e-mail e a escola.', 'error');
            return;
        }
        botaoCriar.disabled = true;
        try {
            const res = await fetch(`${API}/admin/convites-equipe`, {
                method: 'POST',
                headers: window.csrfHeaders(true),
                credentials: 'include',
                body: JSON.stringify({ email, perfil, escolaId }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Erro ao criar convite');
            form.reset();
            mostrarLink(json.data);
            await carregarConvites();
        } catch (erro) {
            avisar(erro.message, 'error');
        } finally {
            botaoCriar.disabled = false;
        }
    });

    tabela.addEventListener('click', async (e) => {
        const botao = e.target.closest('[data-revogar]');
        if (!botao) return;
        if (!confirm('Revogar este convite? O link deixa de funcionar imediatamente.')) return;
        try {
            const res = await fetch(
                `${API}/admin/convites-equipe/${encodeURIComponent(botao.dataset.revogar)}`,
                {
                    method: 'DELETE',
                    headers: window.csrfHeaders(true),
                    credentials: 'include',
                }
            );
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Erro ao revogar');
            avisar('Convite revogado.', 'success');
            await carregarConvites();
        } catch (erro) {
            avisar(erro.message, 'error');
        }
    });

    document.getElementById('btnAtualizarConvites').addEventListener('click', carregarConvites);

    await carregarEscolas();
    await carregarConvites();
});
