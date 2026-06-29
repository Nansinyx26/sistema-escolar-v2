/**
 * JavaScript do Painel de Direção
 * Sistema de Cadastro Escolar v2.0 - Backend Integrated
 */

class DirecaoDashboard {
    constructor() {
        this.charts = {};
        this.baseUrl = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
            ? 'http://localhost:3001/api'
            : (window.location.origin + '/api');
    }

    async init() {
        try {
            // Inicializa Auth (recupera sessão)
            if (window.auth) {
                await window.auth.init();
            }

            // Verify Auth
            if (!window.auth) {
                console.error('Auth module not loaded');
                window.location.href = '../login.html';
                return;
            }

            const user = window.auth.getCurrentUser();
            if (!user) {
                window.location.href = '../login.html';
                return;
            }

            if (user.perfil === 'professor') {
                alert('Acesso negado! Apenas diretores podem acessar o Painel de Direção.');
                window.location.href = '../dashboard.html';
                return;
            }

            this.populateFiltros();
            this.setupEventListeners();
            this.updateProfileUI();
            await this.loadDashboard();

            console.log('Dashboard de direção inicializado (Conectado ao Backend)');
        } catch (error) {
            console.error('Erro ao inicializar dashboard:', error);
        }
    }

    async populateFiltros() {
        try {
            // Fetch Turmas from API
            const response = await fetch(`${this.baseUrl}/turmas`, { credentials: 'include' });
            const json = await response.json();
            const turmas = json.success ? json.data : [];

            const selectTurma = document.getElementById('filtroTurma');
            const selectTurmaCodigos = document.getElementById('filtroTurmaCodigosSecretos');
            // Clear existing options except first
            selectTurma.innerHTML = '<option value="">Todas as turmas</option>';
            if (selectTurmaCodigos) selectTurmaCodigos.innerHTML = '<option value="">Todas as turmas</option>';

            turmas.sort((a, b) => {
                const idA = a.id || a.nome || a._id || '';
                const idB = b.id || b.nome || b._id || '';
                return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
            });

            turmas.forEach(turma => {
                // Backend pode retornar .nome, .id (campo explícito) ou ._id
                // Se tudo falhar, tenta montar com ano+sala
                let turmaId = turma.nome || turma.id || turma._id;

                if (!turmaId && turma.ano && turma.sala) {
                    turmaId = `${turma.ano}${turma.sala}`;
                }

                const option = document.createElement('option');
                option.value = turmaId;
                option.textContent = `Turma ${turmaId}`;
                selectTurma.appendChild(option);

                // Also populate the secret codes turma filter
                if (selectTurmaCodigos) {
                    const opt2 = document.createElement('option');
                    opt2.value = turmaId;
                    opt2.textContent = `Turma ${turmaId}`;
                    selectTurmaCodigos.appendChild(opt2);
                }
            });

            // Materias (Hardcoded for now or fetch if configured)
            // Ideally fetch from config or unique materias in DB
            // Assuming config.json is still valid for UI definition or fetching
            const configResponse = await fetch(`${this.baseUrl}/config`, { credentials: 'include' });
            const configJson = await configResponse.json();
            const config = configJson.success ? configJson.data : configJson;

            const selectMateria = document.getElementById('filtroMateria');
            config.materias.forEach(materia => {
                const option = document.createElement('option');
                option.value = materia.id;
                option.textContent = `${materia.icone} ${materia.nome}`;
                selectMateria.appendChild(option);
            });

        } catch (error) {
            console.error('Erro ao popular filtros:', error);
        }
    }

    setupEventListeners() {
        document.getElementById('btnAplicarFiltros')?.addEventListener('click', () => this.loadDashboard());
        document.getElementById('filtroTurma')?.addEventListener('change', () => this.loadDashboard());
        document.getElementById('filtroBimestre')?.addEventListener('change', () => this.loadDashboard());
        document.getElementById('filtroMateria')?.addEventListener('change', () => this.loadDashboard());
        document.getElementById('btnExportRelatorio')?.addEventListener('click', () => this.exportarRelatorio());
        
        // Security Code
        document.getElementById('btnRotateCodeDir')?.addEventListener('click', async () => {
            if(!confirm('Tem certeza? Isso invalidará o código atual para novos cadastros imediatamente.')) return;
            try {
                const res = await fetch(`${this.baseUrl}/security/director-code`, { method: 'POST', credentials: 'include' });
                const json = await res.json();
                if (json.success) {
                    if (window.showToast) window.showToast('Código gerado com sucesso!', 'success');
                    else alert('Código gerado com sucesso!');
                    this.loadSecretCode();
                } else {
                    if (window.showToast) window.showToast(json.error || 'Erro', 'error');
                    else alert(json.error || 'Erro');
                }
            } catch (e) {
                console.error(e);
            }
        });

        // Secret Codes Card — search and filter
        let searchTimer = null;
        document.getElementById('searchCodigosSecretos')?.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => this.loadSecretCodes(), 300);
        });
        document.getElementById('filtroTurmaCodigosSecretos')?.addEventListener('change', () => this.loadSecretCodes());
    }

    async loadSecretCode() {
        const el = document.getElementById('diretorSecretCode');
        if (!el) return;
        try {
            const res = await fetch(`${this.baseUrl}/security/status`, { credentials: 'include' });
            const json = await res.json();
            if (json.success && json.data) {
                el.textContent = json.data.codigo;
            } else {
                el.textContent = 'Erro';
            }
        } catch (e) {
            console.error('Erro ao buscar código:', e);
            el.textContent = 'Erro';
        }
    }

    async loadDashboard() {
        const filters = {
            turmaId: document.getElementById('filtroTurma')?.value || '',
            bimestre: document.getElementById('filtroBimestre')?.value || '',
            materiaId: document.getElementById('filtroMateria')?.value || ''
        };
        const query = new URLSearchParams(filters).toString();

        console.log('📊 Carregando Dashboard BI:', query);

        try {
            // 1. Load Summary
            const sumRes = await fetch(`${this.baseUrl}/dashboard/summary?${query}`, { credentials: 'include' });
            const sumJson = await sumRes.json();
            if (sumJson.success) this.updateStats(sumJson.data);

            // 2. Load Charts
            const chartRes = await fetch(`${this.baseUrl}/dashboard/charts?${query}`, { credentials: 'include' });
            const chartJson = await chartRes.json();
            if (chartJson.success) this.renderCharts(chartJson.data);

            // 3. Load Ranking
            const rankRes = await fetch(`${this.baseUrl}/dashboard/ranking?${query}`, { credentials: 'include' });
            const rankJson = await rankRes.json();
            if (rankJson.success) this.renderRanking(rankJson.data);

        } catch (error) {
            console.error('Erro ao carregar dados do dashboard:', error);
        }
    }

    updateStats(data) {
        document.getElementById('totalAlunos').textContent = data.totalAlunos;
        document.getElementById('totalAvaliacoes').textContent = data.totalAvaliacoes;
        document.getElementById('mediaGeral').textContent = data.mediaGeral !== null ? data.mediaGeral : '-';
        document.getElementById('alunosRisco').textContent = data.alunosRisco;
    }

    renderCharts(data) {
        this.renderChartTurmas(data.turmas);
        this.renderChartMaterias(data.materias);
        this.renderChartEvolucao(data.evolucao);
    }

    getColor(value) {
        const val = parseFloat(value);
        if (val < 5) return '#ef4444'; // Vermelho Vibrante
        if (val < 7) return '#f59e0b'; // Amber Premium
        return '#8b5cf6'; // Violeta Premium
    }

    renderChartTurmas(data) {
        const ctx = document.getElementById('chartTurmas');
        if (!ctx) return;
        if (this.charts.turmas) this.charts.turmas.destroy();

        const labels = data.map(d => d.label);
        const values = data.map(d => parseFloat(d.value));
        const colors = values.map(v => this.getColor(v));

        this.charts.turmas = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Média',
                    data: values,
                    backgroundColor: colors,
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, max: 10 } }
            }
        });
    }

    renderChartMaterias(data) {
        const ctx = document.getElementById('chartMaterias');
        if (!ctx) return;
        if (this.charts.materias) this.charts.materias.destroy();

        this.charts.materias = new Chart(ctx, {
            type: 'radar',
            data: {
                labels: data.map(d => d.label),
                datasets: [{
                    label: 'Média por Matéria',
                    data: data.map(d => parseFloat(d.value)),
                    fill: true,
                    backgroundColor: 'rgba(13, 110, 253, 0.2)',
                    borderColor: '#0d6efd',
                    pointBackgroundColor: '#0d6efd'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { r: { beginAtZero: true, max: 10 } }
            }
        });
    }

    renderChartEvolucao(data) {
        const ctx = document.getElementById('chartEvolucao');
        if (!ctx) return;
        if (this.charts.evolucao) this.charts.evolucao.destroy();

        const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 400);
        gradient.addColorStop(0, 'rgba(124, 58, 237, 0.2)');
        gradient.addColorStop(1, 'rgba(124, 58, 237, 0)');

        this.charts.evolucao = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => d.label),
                datasets: [{
                    label: 'Média Geral da Escola',
                    data: data.map(d => d.value),
                    fill: true,
                    backgroundColor: gradient,
                    borderColor: '#8b5cf6',
                    borderWidth: 4,
                    tension: 0.4,
                    pointRadius: 6,
                    pointBackgroundColor: '#8b5cf6',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2,
                    pointHoverRadius: 10,
                    pointHoverBackgroundColor: '#10b981',
                    pointHoverBorderColor: '#fff',
                    pointHoverBorderWidth: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(15, 12, 28, 0.9)',
                        titleColor: '#8b5cf6',
                        bodyColor: '#fff',
                        padding: 12,
                        cornerRadius: 10,
                        displayColors: false,
                        callbacks: {
                            label: (context) => `Média: ${context.parsed.y.toFixed(2)}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 10,
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#94a3b8' }
                    }
                }
            }
        });
    }

    renderRanking(ranking) {
        const tbody = document.getElementById('rankingTableBody');
        if (!tbody) return;

        if (ranking.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-message">Nenhum dado disponível</td></tr>';
            return;
        }

        tbody.innerHTML = ranking.map((item, index) => {
            let positionClass = 'normal';
            if (index === 0) positionClass = 'gold';
            else if (index === 1) positionClass = 'silver';
            else if (index === 2) positionClass = 'bronze';

            return `
                <tr>
                    <td><span class="ranking-position ${positionClass}">${index + 1}</span></td>
                    <td>${item.nome}</td>
                    <td>Turma ${item.turma}</td>
                    <td><span class="media-valor ${item.media >= 7 ? 'nota-boa' : item.media >= 5 ? 'nota-media' : 'nota-baixa'}">${item.media.toFixed(1)}</span></td>
                </tr>
            `;
        }).join('');
    }

    async exportarRelatorio() {
        // Implementar exportação semelhante mas usando dados do backend
        // (Simplificando: busca tudo de novo e gera TXT)
        // ...
        alert('Funcionalidade de exportação em manutenção para API.');
    }

    // ─── Secret Codes Table ──────────────────────────────────────────────────
    async loadSecretCodes() {
        const tbody = document.getElementById('secretCodesTableBody');
        if (!tbody) return;

        const q = (document.getElementById('searchCodigosSecretos')?.value || '').trim();
        const turma = document.getElementById('filtroTurmaCodigosSecretos')?.value || '';

        const params = new URLSearchParams();
        if (q) params.set('q', q);
        if (turma) params.set('turma', turma);

        tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Carregando códigos...</td></tr>';

        try {
            const res = await fetch(`${this.baseUrl}/alunos/codigos-secretos?${params.toString()}`, { credentials: 'include' });
            const json = await res.json();

            if (!json.success || !json.data || json.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Nenhum aluno encontrado.</td></tr>';
                return;
            }

            this.renderSecretCodes(json.data);
        } catch (error) {
            console.error('Erro ao carregar códigos secretos:', error);
            tbody.innerHTML = '<tr><td colspan="5" class="empty-message">Erro ao carregar dados.</td></tr>';
        }
    }

    renderSecretCodes(data) {
        const tbody = document.getElementById('secretCodesTableBody');
        if (!tbody) return;

        tbody.innerHTML = data.map(item => {
            const statusBadge = item.vinculado
                ? '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(34,197,94,0.12);color:#22c55e;padding:3px 10px;border-radius:20px;font-size:0.78rem;font-weight:600;"><i class="bi bi-link-45deg"></i> Vinculado</span>'
                : '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(251,191,36,0.12);color:#fbbf24;padding:3px 10px;border-radius:20px;font-size:0.78rem;font-weight:600;"><i class="bi bi-clock-history"></i> Aguardando</span>';

            return `
                <tr>
                    <td style="font-weight:600;">${item.nome}</td>
                    <td>
                        <code style="background:rgba(168,85,247,0.1);color:#c084fc;padding:4px 10px;border-radius:6px;font-weight:700;letter-spacing:1.5px;font-size:0.9rem;">${item.codigoSecreto}</code>
                    </td>
                    <td>${item.ano || '-'}</td>
                    <td>${item.turma || '-'}</td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        }).join('');

        // Pagination placeholder (optional enhancement)
        const paginationEl = document.getElementById('secretCodesPagination');
        if (paginationEl) {
            paginationEl.innerHTML = `<span style="font-size:0.8rem;color:var(--text-secondary);">${data.length} aluno(s) encontrado(s)</span>`;
        }
    }

    // ─── Profile & Avatar ──────────────────────────────────────────────────
    updateProfileUI() {
        const user = window.auth?.getCurrentUser();
        if (!user) return;

        const userName = user.nome || 'Diretor';
        const photoUrl = window.getPhotoUrl ? window.getPhotoUrl(user.foto, user.fotoGoogle) : '/img/default-avatar.png';

        // Sidebar
        const sidebarName = document.getElementById('sidebarUserName');
        const sidebarRole = document.getElementById('sidebarUserRole');
        const sidebarAvatar = document.getElementById('sidebarAvatar');
        const avatarWrapper = document.querySelector('.sidebar-avatar-wrapper');

        if (sidebarName) sidebarName.textContent = userName;
        if (sidebarRole) sidebarRole.textContent = 'Diretor';

        if (sidebarAvatar) {
            if (photoUrl && !photoUrl.includes('default-avatar.png')) {
                sidebarAvatar.src = photoUrl;
                sidebarAvatar.style.display = 'block';
                // Remove initials if they exist
                avatarWrapper?.querySelector('.avatar-initials')?.remove();
            } else {
                sidebarAvatar.style.display = 'none';
                // Add initials if not already there
                if (avatarWrapper && !avatarWrapper.querySelector('.avatar-initials')) {
                    const initials = document.createElement('div');
                    initials.className = 'avatar-initials';
                    initials.style.cssText = `
                        width: 100%;
                        height: 100%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                        color: white;
                        font-weight: 700;
                        font-size: 1.2rem;
                        border-radius: 50%;
                    `;
                    initials.textContent = window.utils?.getInitials ? window.utils.getInitials(userName) : userName.charAt(0);
                    avatarWrapper.appendChild(initials);
                }
            }
        }
    }

    // Preferências de voz agora são gerenciadas globalmente por sidebar-voice.js
}

document.addEventListener('DOMContentLoaded', () => {
    const dashboard = new DirecaoDashboard();
    dashboard.init();
});
