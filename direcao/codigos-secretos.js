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

    async function carregarCodigos() {
        const tbody = document.getElementById('secretCodesTableBody');
        if (!tbody) return;

        const q = (document.getElementById('searchCodigosSecretos')?.value || '').trim();
        const turma = document.getElementById('filtroTurmaCodigosSecretos')?.value || '';

        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (turma) params.set('turma', turma);

        tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Carregando códigos...</td></tr>';

        try {
            const res = await fetch(`${baseUrl}/alunos/codigos-secretos?${params.toString()}`, { credentials: 'include' });
            const json = await res.json();

            if (!json.success || !Array.isArray(json.data) || json.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Nenhum aluno encontrado.</td></tr>';
                return;
            }

            tbody.innerHTML = json.data.map(item => {
                const statusBadge = item.vinculado
                    ? '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(34,197,94,0.12);color:#22c55e;padding:3px 10px;border-radius:20px;font-size:0.78rem;font-weight:600;"><i class="bi bi-link-45deg"></i> Vinculado</span>'
                    : '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(251,191,36,0.12);color:#fbbf24;padding:3px 10px;border-radius:20px;font-size:0.78rem;font-weight:600;"><i class="bi bi-clock-history"></i> Aguardando</span>';

                return `
                    <tr>
                        <td style="font-weight:600;">${item.nome}</td>
                        <td>
                            <code style="background:rgba(16,185,129,0.1);color:#34d399;padding:4px 10px;border-radius:6px;font-weight:700;letter-spacing:1.5px;font-size:0.9rem;">${item.codigoSecreto || '------'}</code>
                        </td>
                        <td>${item.ano || '-'}</td>
                        <td>${item.turma || '-'}</td>
                        <td>${statusBadge}</td>
                    </tr>
                `;
            }).join('');

            const paginationEl = document.getElementById('secretCodesPagination');
            if (paginationEl) {
                paginationEl.innerHTML = `<span style="font-size:0.8rem;color:var(--text-secondary);">${json.data.length} aluno(s) encontrado(s)</span>`;
            }
        } catch (error) {
            console.error('Erro ao carregar códigos secretos:', error);
            tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Erro ao carregar dados.</td></tr>';
        }
    }

    let searchTimer = null;
    document.getElementById('searchCodigosSecretos')?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(carregarCodigos, 300);
    });
    document.getElementById('filtroTurmaCodigosSecretos')?.addEventListener('change', carregarCodigos);

    await popularTurmas();
    await carregarCodigos();
});
