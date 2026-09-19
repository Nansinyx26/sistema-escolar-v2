/**
 * Pedidos de inclusão de responsável — tela da secretaria (Issue #398).
 *
 * O e-mail que consta na ficha do aluno é o que dá acesso aos dados dele. Por
 * isso a inclusão pedida pela família não entra sozinha: aparece aqui, e a
 * escola aprova ou recusa. Aprovação e recusa ficam no log de auditoria, e os
 * demais responsáveis do aluno são avisados da inclusão aprovada.
 */
document.addEventListener('DOMContentLoaded', () => {
    const API = window.API_BASE_URL || '/api';
    const corpo = document.getElementById('vinculosBody');
    let situacao = 'pendente';

    const ROTULO = {
        pendente: ['Aguardando decisão', 'sec-badge-yellow'],
        aprovada: ['Aprovado', 'sec-badge-green'],
        recusada: ['Recusado', 'sec-badge-red'],
    };

    function escapar(v) {
        return String(v ?? '').replace(
            /[&<>"']/g,
            (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
        );
    }

    function aviso(msg, tipo = 'success') {
        const d = document.createElement('div');
        d.className = `sec-toast sec-toast-${tipo}`;
        d.setAttribute('role', 'alert');
        d.textContent = msg;
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 3000);
    }

    function linha(p) {
        const [rotulo, classe] = ROTULO[p.status] || [p.status, ''];
        const data = p.criadoEm ? new Date(p.criadoEm).toLocaleDateString('pt-BR') : '—';
        const acoes =
            p.status === 'pendente'
                ? `<button type="button" class="sec-btn sec-btn-primary" data-aprovar="${escapar(p.id)}">Aprovar</button>
                   <button type="button" class="sec-btn sec-btn-danger" data-recusar="${escapar(p.id)}" style="margin-left:0.4rem;">Recusar</button>`
                : '';
        return `<tr>
            <td>${escapar(p.alunoNome || p.alunoId)}</td>
            <td>${escapar(p.turma || '—')}</td>
            <td>${escapar(p.nome || '')}<br><small style="color:#94a3b8;">${escapar(p.email)}</small></td>
            <td>${escapar(p.solicitanteEmail)}</td>
            <td>${escapar(data)}</td>
            <td><span class="sec-badge ${classe}">${escapar(rotulo)}</span></td>
            <td>${acoes}</td>
        </tr>`;
    }

    async function carregar() {
        corpo.innerHTML =
            '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">Carregando...</td></tr>';
        try {
            const res = await fetch(`${API}/secretaria/vinculos?status=${situacao}`, {
                credentials: 'include',
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Erro ao carregar');
            const lista = json.data || [];
            corpo.innerHTML = lista.length
                ? lista.map(linha).join('')
                : '<tr><td colspan="7" style="text-align:center;color:#94a3b8;">Nenhum pedido nesta situação.</td></tr>';
        } catch (e) {
            corpo.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#ef4444;">${escapar(e.message)}</td></tr>`;
        }
    }

    async function decidir(id, acao, corpoRequisicao) {
        try {
            const res = await fetch(
                `${API}/secretaria/vinculos/${encodeURIComponent(id)}/${acao}`,
                {
                    method: 'POST',
                    headers: window.csrfHeaders(true),
                    credentials: 'include',
                    body: JSON.stringify(corpoRequisicao || {}),
                }
            );
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'Não foi possível concluir');
            aviso(acao === 'aprovar' ? 'Responsável incluído na ficha.' : 'Pedido recusado.');
            await carregar();
        } catch (e) {
            aviso(e.message, 'error');
        }
    }

    corpo.addEventListener('click', (e) => {
        const aprovar = e.target.closest('[data-aprovar]');
        if (aprovar) {
            if (!confirm('Aprovar a inclusão? A pessoa passa a ver os dados desta criança.'))
                return;
            void decidir(aprovar.dataset.aprovar, 'aprovar');
            return;
        }
        const recusar = e.target.closest('[data-recusar]');
        if (recusar) {
            const motivo = prompt('Motivo da recusa (opcional):') || '';
            void decidir(recusar.dataset.recusar, 'recusar', { motivo });
        }
    });

    for (const botao of document.querySelectorAll('.sec-filter-btn')) {
        botao.addEventListener('click', () => {
            for (const b of document.querySelectorAll('.sec-filter-btn')) {
                b.classList.toggle('active', b === botao);
            }
            situacao = botao.dataset.status;
            void carregar();
        });
    }

    void carregar();
});
