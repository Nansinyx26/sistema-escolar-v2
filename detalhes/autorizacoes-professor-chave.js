/**
 * Atalho da direção: liberar ou retirar, de todos os professores atuais da
 * escola, a consulta da situação das autorizações da turma (Issues #496 e
 * #727). A autorização é por professor; a API grava uma decisão para cada um
 * e registra cada mudança no log de auditoria. Só aparece para direção e admin.
 */
document.addEventListener('DOMContentLoaded', async () => {
    const bloco = document.getElementById('chaveAutorizacoesProfessor');
    const status = document.getElementById('chaveAutorizacoesProfessorStatus');
    if (!bloco) return;
    const botoes = [...bloco.querySelectorAll('button[data-liberar]')];

    function csrf() {
        const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }

    function avisar(texto) {
        if (status) status.textContent = texto;
    }

    try {
        const eu = await (await fetch('/api/auth/me', { credentials: 'include' })).json();
        if (!eu.success || !['diretor', 'admin'].includes(eu.user?.perfil)) return;

        const minhas = await (await fetch('/api/escolas/minhas', { credentials: 'include' })).json();
        if (!minhas.success) return;
        const escolaId =
            minhas.escolaAtivaId || (minhas.data.length === 1 ? String(minhas.data[0]._id) : null);
        if (!escolaId) return;

        bloco.hidden = false;

        for (const botao of botoes) {
            botao.addEventListener('click', async () => {
                const liberar = botao.dataset.liberar === 'true';
                const pergunta = liberar
                    ? 'Liberar a consulta das autorizações para todos os professores atuais desta escola?'
                    : 'Retirar a consulta das autorizações de todos os professores desta escola?';
                if (!window.confirm(pergunta)) return;

                for (const b of botoes) b.disabled = true;
                avisar('Salvando…');
                try {
                    const res = await fetch(
                        `/api/escolas/${encodeURIComponent(escolaId)}/autorizacoes-professor`,
                        {
                            method: 'PATCH',
                            credentials: 'include',
                            headers: {
                                'Content-Type': 'application/json',
                                'X-CSRF-Token': csrf(),
                            },
                            body: JSON.stringify({ liberar }),
                        }
                    );
                    const json = await res.json();
                    if (!json.success) throw new Error(json.error || 'Não foi possível salvar.');
                    const { professores, alteradas } = json.data;
                    avisar(
                        professores === 0
                            ? 'Não há professores cadastrados nesta escola.'
                            : `Autorizações salvas com sucesso: ${alteradas} de ${professores} professor(es) alterado(s).`
                    );
                } catch (e) {
                    avisar(e.message || 'Não foi possível salvar as autorizações.');
                } finally {
                    for (const b of botoes) b.disabled = false;
                }
            });
        }
    } catch {
        // Sem conseguir ler o perfil ou a escola, o atalho simplesmente não aparece.
    }
});
