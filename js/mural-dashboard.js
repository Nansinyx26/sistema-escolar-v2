/**
 * mural-dashboard.js
 * Controla o Mural da Comunidade no Dashboard:
 *  - Mostra/oculta seções de diretor (Histórico de Envios, botão Gerenciar)
 *  - Carrega tabela de histórico para diretor/admin
 *  - Filtros de status na tabela
 */

(function () {
    'use strict';

    const API_BASE = window.API_BASE_URL || '/api';

    // Aguarda auth estar pronto
    function waitForAuth(cb) {
        if (window.auth && window.auth.getCurrentUser()) {
            cb(window.auth.getCurrentUser());
        } else {
            setTimeout(() => waitForAuth(cb), 120);
        }
    }

    waitForAuth(function (user) {
        const isDirector = user.perfil === 'diretor' || user.perfil === 'admin';

        if (isDirector) {
            // Mostra botão Gerenciar Mural e histórico
            const btnGerenciar = document.getElementById('btnAcessarMuralCompleto');
            const historicoWrap = document.getElementById('muralHistoricoWrap');

            if (btnGerenciar) btnGerenciar.style.display = 'inline-flex';
            if (historicoWrap) historicoWrap.style.display = 'block';

            // Carrega tabela
            carregarHistorico();

            // Filtros
            document.querySelectorAll('.hist-filter-btn').forEach(btn => {
                btn.addEventListener('click', function () {
                    document.querySelectorAll('.hist-filter-btn').forEach(b => {
                        b.style.background = 'rgba(255,255,255,0.05)';
                        b.style.color = '#a1a1aa';
                        b.style.borderColor = 'rgba(255,255,255,0.1)';
                        b.classList.remove('active');
                    });
                    this.style.background = 'rgba(16,185,129,0.15)';
                    this.style.color = '#10b981';
                    this.style.borderColor = 'rgba(16,185,129,0.3)';
                    this.classList.add('active');
                    carregarHistorico(this.dataset.status);
                });
            });

            // Atualiza tabela quando o feed React emite evento de novo comunicado
            window.addEventListener('mural:refresh', () => carregarHistorico());
        }

        // Socket.IO: atualiza histórico em tempo real para diretor
        if (isDirector && window.socket) {
            window.socket.on('comunicado:new', () => carregarHistorico());
            window.socket.on('comunicado:remove', () => carregarHistorico());
        }
    });

    // Carrega e renderiza o histórico de envios
    async function carregarHistorico(filtroStatus) {
        const tbody = document.getElementById('muralHistoricoBody');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#a1a1aa;">Carregando...</td></tr>';

        try {
            const res = await fetch(`${API_BASE}/comunicados`, { credentials: 'include' });
            const json = await res.json();

            if (!json.success || !Array.isArray(json.data)) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#f87171;">Erro ao carregar histórico.</td></tr>';
                return;
            }

            // Para diretor, a API retorna todos (ativos). Incluímos inativos via filtro local.
            let dados = json.data;

            if (filtroStatus === 'ativo') {
                dados = dados.filter(c => c.ativo !== false);
            }

            if (dados.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#a1a1aa;">Nenhum aviso encontrado.</td></tr>';
                return;
            }

            tbody.innerHTML = dados.map(c => {
                const data = new Date(c.dataCriacao).toLocaleDateString('pt-BR');
                const ativo = c.ativo !== false;

                const publico = Array.isArray(c.destinatarios) && c.destinatarios.length
                    ? c.destinatarios.map(d => {
                        if (d === 'todos') return 'Todos';
                        if (d === 'professores') return 'Professores';
                        if (d === 'responsaveis') return 'Responsáveis';
                        if (d.startsWith('turma:')) return `Turma ${d.replace('turma:', '')}`;
                        if (d.startsWith('usuario:')) return 'Usuário';
                        return d;
                    }).map(t => `<span style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:2px 8px;border-radius:6px;font-size:0.7rem;color:#a1a1aa;margin-right:3px;">${t}</span>`).join('')
                    : '—';

                const statusPill = ativo
                    ? '<span style="background:rgba(16,185,129,0.1);color:#10b981;padding:3px 10px;border-radius:20px;font-size:0.73rem;font-weight:600;">Ativo</span>'
                    : '<span style="background:rgba(239,68,68,0.1);color:#f87171;padding:3px 10px;border-radius:20px;font-size:0.73rem;font-weight:600;">Removido</span>';

                const cat = c.categoria || 'Direção';
                const catColor = {
                    'Direção': '#10b981', 'Acadêmico': '#3b82f6',
                    'Financeiro': '#f59e0b', 'Geral': '#8b5cf6', 'Responsáveis': '#0ea5e9',
                    'Professores': '#6366f1', 'Sistema': '#94a3b8'
                }[cat] || '#a1a1aa';

                return `
                    <tr style="border-bottom:1px solid rgba(255,255,255,0.04);transition:background 0.15s;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
                        <td data-label="Título" style="padding:0.9rem 1.25rem;">
                            <div style="font-weight:600;color:#fff;font-size:0.87rem;">${escapeHtml(c.titulo)}</div>
                            <div style="margin-top:3px;">
                                <span style="font-size:0.7rem;color:${catColor};background:rgba(255,255,255,0.04);border:1px solid ${catColor}30;padding:1px 8px;border-radius:4px;">${cat}</span>
                            </div>
                        </td>
                        <td data-label="Público" style="padding:0.9rem 1rem;">
                            <div style="display:flex;flex-wrap:wrap;gap:3px;">${publico}</div>
                        </td>
                        <td data-label="Data" style="padding:0.9rem 1rem;color:#a1a1aa;font-size:0.83rem;white-space:nowrap;">${data}</td>
                        <td data-label="Status" style="padding:0.9rem 1rem;text-align:center;">${statusPill}</td>
                        <td data-label="Ações" style="padding:0.9rem 1rem;text-align:center;">
                            <div style="display:flex;gap:8px;justify-content:center;">
                                <button onclick="window._muralExcluir && window._muralExcluir('${c._id}')" title="Excluir" style="background:transparent;border:none;color:#f87171;cursor:pointer;font-size:1.05rem;opacity:0.7;transition:opacity 0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">
                                    <i class="bi bi-trash"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

        } catch (err) {
            console.error('[Mural] Erro ao carregar histórico:', err);
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:#f87171;">Erro de conexão.</td></tr>';
        }
    }

    // Excluir comunicado direto da tabela
    window._muralExcluir = async function (id) {
        if (!confirm('Deseja remover este aviso do mural?')) return;
        try {
            const res = await fetch(`${API_BASE}/comunicados/${id}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...getCsrf() }
            });
            const json = await res.json();
            if (json.success) {
                if (window.showToast) window.showToast('Aviso removido.', 'success');
                carregarHistorico();
            } else {
                if (window.showToast) window.showToast(json.error || 'Erro ao remover aviso.', 'error');
            }
        } catch (e) {
            console.error('[Mural] Erro ao excluir:', e);
            if (window.showToast) window.showToast('Erro de conexão.', 'error');
        }
    };

    function getCsrf() {
        const match = document.cookie.match(/csrf_token=([^;]+)/);
        return match ? { 'X-CSRF-Token': decodeURIComponent(match[1]) } : {};
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

})();
