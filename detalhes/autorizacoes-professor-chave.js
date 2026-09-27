/**
 * Chave da direção: professor vê a situação das autorizações da turma?
 * (Issue #496). Só aparece para direção e admin; a API confere de novo e
 * registra a decisão no log de auditoria.
 */
document.addEventListener('DOMContentLoaded', async () => {
    const rotulo = document.getElementById('chaveAutorizacoesProfessor');
    const caixa = document.getElementById('chaveAutorizacoesProfessorInput');
    if (!rotulo || !caixa) return;

    function csrf() {
        const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : '';
    }

    try {
        const eu = await (await fetch('/api/auth/me', { credentials: 'include' })).json();
        if (!eu.success || !['diretor', 'admin'].includes(eu.user?.perfil)) return;

        const minhas = await (await fetch('/api/escolas/minhas', { credentials: 'include' })).json();
        if (!minhas.success) return;
        const escolaId =
            minhas.escolaAtivaId || (minhas.data.length === 1 ? String(minhas.data[0]._id) : null);
        if (!escolaId) return;
        const escola = minhas.data.find((e) => String(e._id) === String(escolaId));

        caixa.checked = escola?.professorVeAutorizacoes === true;
        rotulo.hidden = false;

        caixa.addEventListener('change', async () => {
            const desejado = caixa.checked;
            caixa.disabled = true;
            try {
                const res = await fetch(
                    `/api/escolas/${encodeURIComponent(escolaId)}/autorizacoes-professor`,
                    {
                        method: 'PATCH',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
                        body: JSON.stringify({ liberar: desejado }),
                    }
                );
                const json = await res.json();
                if (!json.success) throw new Error(json.error || 'Não foi possível salvar.');
            } catch (e) {
                caixa.checked = !desejado;
                alert(e.message);
            } finally {
                caixa.disabled = false;
            }
        });
    } catch {
        // Sem conseguir ler o perfil ou a escola, a chave simplesmente não aparece.
    }
});
