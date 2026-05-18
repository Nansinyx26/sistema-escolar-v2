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
                window.location.href = '../index.html';
                return;
            }

            const user = window.auth.getCurrentUser();
            if (!user) {
                window.location.href = '../index.html';
                return;
            }

            if (user.perfil === 'professor') {
                alert('Acesso negado! Apenas diretores podem acessar o Painel de Direção.');
                window.location.href = '../dashboard.html';
                return;
            }

            this.populateFiltros();
            this.setupEventListeners();
            await this.loadDashboard();

            console.log('Dashboard de direção inicializado (Conectado ao Backend)');
        } catch (error) {
            console.error('Erro ao inicializar dashboard:', error);
        }
    }

    async populateFiltros() {
        try {
            // Fetch Turmas from API
            const response = await fetch(`${this.baseUrl}/turmas`);
            const json = await response.json();
            const turmas = json.success ? json.data : [];

            const selectTurma = document.getElementById('filtroTurma');
            // Clear existing options except first
            selectTurma.innerHTML = '<option value="">Todas as turmas</option>';

            turmas.sort((a, b) => {
                const idA = a.id || a.nome || a._id || '';
                const idB = b.id || b.nome || b._id || '';
                return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
            });

            turmas.forEach(turma => {
                const option = document.createElement('option');
                // Backend pode retornar .nome, .id (campo explícito) ou ._id
                // Se tudo falhar, tenta montar com ano+sala
                let turmaId = turma.nome || turma.id || turma._id;

                if (!turmaId && turma.ano && turma.sala) {
                    turmaId = `${turma.ano}${turma.sala}`;
                }

                option.value = turmaId;
                option.textContent = `Turma ${turmaId}`;
                selectTurma.appendChild(option);
            });

            // Materias (Hardcoded for now or fetch if configured)
            // Ideally fetch from config or unique materias in DB
            // Assuming config.json is still valid for UI definition or fetching
            const configResponse = await fetch('../data/config.json');
            const config = await configResponse.json();

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
    }

    async loadDashboard() {
        const filters = {
            turmaId: document.getElementById('filtroTurma')?.value || '',
            bimestre: document.getElementById('filtroBimestre')?.value || '',
            materiaId: document.getElementById('filtroMateria')?.value || ''
        };
        const query = new URLSearchParams(filters).toString();

        console.log('📊 Carregando Dashboard API:', query);

        try {
            // 1. Load Summary
            const sumRes = await fetch(`${this.baseUrl}/dashboard/summary?${query}`);
            const sumJson = await sumRes.json();
            if (sumJson.success) this.updateStats(sumJson.data);

            // 2. Load Charts
            const chartRes = await fetch(`${this.baseUrl}/dashboard/charts?${query}`);
            const chartJson = await chartRes.json();
            if (chartJson.success) this.renderCharts(chartJson.data);

            // 3. Load Ranking
            const rankRes = await fetch(`${this.baseUrl}/dashboard/ranking?${query}`);
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
        if (val < 5) return '#dc3545'; // Vermelho
        if (val < 7) return '#ffc107'; // Amarelo
        return '#0d6efd'; // Azul
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

        this.charts.evolucao = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => d.label),
                datasets: [{
                    label: 'Média Geral',
                    data: data.map(d => d.value),
                    fill: true,
                    backgroundColor: 'rgba(13, 110, 253, 0.1)',
                    borderColor: '#0d6efd',
                    tension: 0.4,
                    pointRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: { y: { beginAtZero: true, max: 10 } }
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
}

document.addEventListener('DOMContentLoaded', () => {
    const dashboard = new DirecaoDashboard();
    dashboard.init();
});
