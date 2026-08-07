document.addEventListener('DOMContentLoaded', async () => {
    if (window.auth) {
        await window.auth.init();
    }

    const user = window.auth?.getCurrentUser?.();
    if (!user) {
        window.location.href = '../html/login.html';
        return;
    }

    if (user.perfil !== 'diretor' && user.perfil !== 'admin') {
        alert('Acesso negado! Apenas diretores ou administradores podem acessar esta página.');
        window.location.href = '../html/dashboard.html';
        return;
    }

    const baseUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
        ? 'http://localhost:3001/api'
        : (window.location.origin + '/api');

    // Não há mais auto-refresh: a rota gera os códigos faltantes em lote dentro
    // do próprio request e já devolve o código definitivo. O polling antigo
    // desistia calado depois de 1 minuto e deixava "Gerando..." na tela para
    // sempre quando a geração em background falhava.

    async function popularTurmas() {
        const select = document.getElementById('filtroTurmaCodigosSecretos');
        if (!select) return;

        try {
            const res = await fetch(`${baseUrl}/turmas`, { credentials: 'include' });
            const json = await res.json();
            if (json.success && Array.isArray(json.data)) {
                select.innerHTML = '<option value="">Todas as turmas</option>';

                const bulkGroup = document.createElement('optgroup');
                bulkGroup.label = '─ SELEÇÃO EM MASSA ─';

                [1, 2, 3, 4, 5].forEach(num => {
                    const opt = document.createElement('option');
                    opt.value = `SERIE_${num}`;
                    opt.textContent = `Todos os ${num}º anos (A, B, C, D...)`;
                    opt.style.fontWeight = 'bold';
                    opt.style.color = 'var(--accent-primary)';
                    bulkGroup.appendChild(opt);
                });
                select.appendChild(bulkGroup);

                const sortedTurmas = json.data.sort((a, b) => {
                    const nameA = (a.nome || a.id || String(a)).toUpperCase();
                    const nameB = (b.nome || b.id || String(b)).toUpperCase();
                    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
                });

                let currentSerie = null;
                let currentGroup = null;

                sortedTurmas.forEach(t => {
                    const nome = (t.nome || t.id || String(t)).toUpperCase();
                    const matches = nome.match(/^(\d+)/);
                    const serie = matches ? matches[1] : 'Outros';

                    if (serie !== currentSerie) {
                        currentSerie = serie;
                        currentGroup = document.createElement('optgroup');
                        currentGroup.label = serie === 'Outros' ? 'Outras Turmas' : `${serie}º ANOS`;
                        select.appendChild(currentGroup);
                    }

                    const opt = document.createElement('option');
                    opt.value = t.nome || t.id || t;
                    opt.textContent = `Turma ${t.nome || t.id || t}`;
                    currentGroup.appendChild(opt);
                });
            }
        } catch (e) {
            console.error('Erro ao popular turmas:', e);
        }
    }

    function escapeHtml(valor) {
        return String(valor ?? '').replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    async function carregarCodigos(silent) {
        const tbody = document.getElementById('secretCodesTableBody');
        if (!tbody) return;

        const q = (document.getElementById('searchCodigosSecretos')?.value || '').trim();
        const turma = document.getElementById('filtroTurmaCodigosSecretos')?.value || '';

        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (turma) params.set('turma', turma);

        // Só mostra "Carregando..." no primeiro load (não no auto-refresh)
        if (!silent) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Carregando códigos...</td></tr>';
        }

        try {
            const res = await fetch(`${baseUrl}/alunos/codigos-secretos?${params.toString()}`, { credentials: 'include' });
            const json = await res.json();

            if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Nenhum aluno encontrado.</td></tr>';
                return;
            }

            tbody.innerHTML = json.data.map(item => {
                // ── Status ───────────────────────────────────────────────
                const statusBadge = item.vinculado
                    ? '<span class="status-pill status-pill--vinculado"><i class="bi bi-link-45deg"></i> Vinculado</span>'
                    : '<span class="status-pill status-pill--aguardando"><i class="bi bi-clock-history"></i> Aguardando</span>';

                // ── Código secreto ───────────────────────────────────────
                // `codigoFalhou` = o backend tentou gerar e a gravação não
                // passou. É um erro no cadastro do aluno, não uma espera —
                // por isso a mensagem manda agir em vez de pedir paciência.
                let codigoHTML;
                if (item.codigoFalhou) {
                    codigoHTML = '<span class="codigo-secreto" style="opacity:0.75;color:#f87171;" title="Não foi possível gerar o código deste aluno. Revise o cadastro (nome, turma) e recarregue."><i class="bi bi-exclamation-triangle" style="margin-right:4px;"></i>Falhou</span>';
                } else if (!item.codigoSecreto || item.codigoSecreto === 'N/A') {
                    codigoHTML = '<code class="codigo-secreto" style="opacity:0.5;">------</code>';
                } else {
                    codigoHTML = `<code class="codigo-secreto">${escapeHtml(item.codigoSecreto)}</code>`;
                }

                return `
                    <tr>
                        <td style="font-weight:600;">${escapeHtml(item.nome)}</td>
                        <td>${codigoHTML}</td>
                        <td>${escapeHtml(item.ano || '-')}</td>
                        <td>${escapeHtml(item.turma || '-')}</td>
                        <td>${statusBadge}</td>
                    </tr>
                `;
            }).join('');

            const paginationEl = document.getElementById('secretCodesPagination');
            if (paginationEl) {
                const falhas = json.failedCodes || 0;
                const aviso = falhas > 0
                    ? ` <span style="color:#f87171;">· ${falhas} sem código (revisar cadastro)</span>`
                    : '';
                paginationEl.innerHTML = `<span style="font-size:0.8rem;color:var(--text-secondary);">${json.data.length} aluno(s) encontrado(s)${aviso}</span>`;
            }
        } catch (error) {
            console.error('Erro ao carregar códigos secretos:', error);
            if (!silent) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Erro ao carregar dados.</td></tr>';
            }
        }
    }

    let searchTimer = null;
    document.getElementById('searchCodigosSecretos')?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => carregarCodigos(false), 300);
    });
    document.getElementById('filtroTurmaCodigosSecretos')?.addEventListener('change', () => carregarCodigos(false));

    await popularTurmas();
    await carregarCodigos(false);
});
