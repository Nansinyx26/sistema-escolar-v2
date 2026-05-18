import db from '../js/db.js';

class GraficosPage {
    constructor() {
        this.config = null;
        this.charts = {};
        this.selectedAluno = null;
    }

    get baseUrl() {
        return db.baseUrl;
    }

    async init() {
        try {
            console.log('Inicializando Gráficos (Backend API)...');

            // Inicializa DB e aguarda configs
            await db.init();

            this.config = db.getConfig();
            if (!this.config) {
                console.log('🔄 Config não encontrada no DB, tentando carregar...');
                await db.loadInitialData();
                this.config = db.getConfig();
            }

            await this.populateTurmas();
            this.setupEventListeners();

            console.log('Gráficos inicializados com sucesso.');
        } catch (error) {
            console.error('Erro ao inicializar gráficos:', error);
            this.showToast('Erro ao carregar sistema', 'error');
        }
    }

    async loadConfig() {
        // Agora o config vem do db.js que já buscou do backend
        this.config = db.getConfig();
    }

    async populateTurmas() {
        try {
            const select = document.getElementById('selectTurma');
            select.innerHTML = '<option value="">Carregando...</option>';

            // Ensure DB is ready
            await db.init();
            if (!db.getTurmas() || db.getTurmas().length === 0) {
                await db.loadInitialData();
            }

            let allTurmas = db.getTurmas();

            // Get User via global Auth
            let user = auth.getCurrentUser() || await auth.checkSession();

            let myTurmasIds = [];
            const normalize = (str) => str ? String(str).replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : '';

            if (user && (user.perfil === 'admin' || user.perfil === 'diretor')) {
                myTurmasIds = allTurmas.map(t => t.id);
            } else if (user && user.perfil === 'professor') {
                const professores = await db.getAll('professores');
                const uEmail = String(user.email || '').toLowerCase();
                const uId = String(user.id || user._id || '').toLowerCase();

                const me = professores.find(p => {
                    const pEmail = String(p.email || '').toLowerCase();
                    const pIdUser = String(p.idUsuario || '').toLowerCase();
                    return (pEmail === uEmail && uEmail !== '') || (pIdUser === uId && uId !== '');
                });

                if (me) {
                    const principal = me.salaPrincipal || '';
                    const adicionais = Array.isArray(me.salasAdicionais) ? me.salasAdicionais : [];

                    if (principal && principal.toUpperCase() !== 'VARIADOS') {
                        myTurmasIds.push(principal);
                    }
                    if (adicionais.length > 0) {
                        adicionais.forEach(s => myTurmasIds.push(s));
                    }
                }
            } else {
                myTurmasIds = allTurmas.map(t => t.id);
            }

            const turmasFiltradas = allTurmas.filter(t => {
                if (!user || user.perfil === 'admin' || user.perfil === 'diretor') return true;
                const tIdNorm = normalize(t.id);
                return myTurmasIds.some(myId => normalize(myId) === tIdNorm);
            });

            select.innerHTML = '<option value="">Selecione uma turma...</option>';
            if (turmasFiltradas.length === 0) {
                const opt = document.createElement('option');
                opt.textContent = "Nenhuma turma vinculada a este perfil";
                select.appendChild(opt);
            } else {
                turmasFiltradas.forEach(t => {
                    const opt = document.createElement('option');
                    opt.value = t.id;
                    opt.textContent = `Turma ${t.id}`;
                    select.appendChild(opt);
                });
            }

        } catch (e) {
            console.error('Populate Turmas Error:', e);
            this.showToast('Erro ao carregar turmas', 'error');
        }
    }

    setupEventListeners() {
        document.getElementById('selectTurma')?.addEventListener('change', (e) => {
            if (e.target.value) this.loadAlunos(e.target.value);
            else {
                document.getElementById('selectAluno').innerHTML = '<option value="">Selecione um aluno...</option>';
                document.getElementById('selectAluno').disabled = true;
                this.resetState();
            }
        });

        document.getElementById('selectAluno')?.addEventListener('change', (e) => {
            const btn = document.getElementById('btnGerarGraficos');
            if (e.target.value) btn.disabled = false;
            else btn.disabled = true;
        });

        document.getElementById('btnGerarGraficos')?.addEventListener('click', () => {
            const alunoId = document.getElementById('selectAluno').value;
            if (alunoId) this.loadData(alunoId);
        });

        document.getElementById('btnExportBoletim')?.addEventListener('click', () => {
            if (this.selectedAluno) this.exportarBoletim();
        });
    }

    async loadAlunos(turmaId) {
        try {
            const select = document.getElementById('selectAluno');
            select.innerHTML = '<option value="">Carregando...</option>';
            select.disabled = true;

            // API Fetch: Alunos by Turma (Try exact)
            let res = await fetch(`${this.baseUrl}/alunos?turmaId=${encodeURIComponent(turmaId)}`);
            let json = await res.json();

            // Retry logic: 1ºA -> 1A
            if (json.success && json.data.length === 0 && turmaId.includes('º')) {
                const normId = turmaId.replace('º', '');
                res = await fetch(`${this.baseUrl}/alunos?turmaId=${encodeURIComponent(normId)}`);
                json = await res.json();
            }

            select.innerHTML = '<option value="">Selecione um aluno...</option>';

            if (json.success && json.data.length > 0) {
                // Sort by Name
                const sorted = json.data.sort((a, b) => a.nome.localeCompare(b.nome));

                sorted.forEach(aluno => {
                    const opt = document.createElement('option');
                    opt.value = aluno.id || aluno._id;
                    opt.textContent = aluno.nome;
                    select.appendChild(opt);
                });
                select.disabled = false;
            } else {
                const opt = document.createElement('option');
                opt.textContent = "Nenhum aluno encontrado";
                select.appendChild(opt);
            }

        } catch (e) {
            console.error('Load Alunos Error:', e);
            this.showToast('Erro ao carregar alunos', 'error');
        }
    }

    async loadData(alunoId) {
        try {
            // Show Loading?
            document.querySelector('.aluno-info-card').classList.add('hidden');
            document.querySelector('.graficos-container').classList.add('hidden');

            // Fetch Student Info
            const studentRes = await fetch(`${this.baseUrl}/alunos/${alunoId}`);
            const studentJson = await studentRes.json();
            const aluno = studentJson.data;

            // Fetch Notes
            // Using NoteController list filter
            const noteRes = await fetch(`${this.baseUrl}/notas?alunoId=${alunoId}`);
            const noteJson = await noteRes.json();
            const notas = noteJson.data;

            this.selectedAluno = { ...aluno, notas };

            this.updateHeader(aluno, notas);
            this.renderCharts(notas);
            this.renderBoletim(notas);

            document.getElementById('emptyState').classList.add('hidden');
            document.querySelector('.aluno-info-card').classList.remove('hidden');
            document.querySelector('.graficos-container').classList.remove('hidden');

        } catch (e) {
            console.error('Load Data Error:', e);
            this.showToast('Erro ao carregar dados do aluno', 'error');
        }
    }

    updateHeader(aluno, notas) {
        document.getElementById('alunoNome').textContent = aluno.nome;
        document.getElementById('alunoTurma').textContent = aluno.turmaId || 'N/A';
        document.getElementById('alunoMatricula').textContent = aluno.matricula || '-';
        document.getElementById('alunoAvatar').textContent = aluno.nome.charAt(0);

        if (notas.length > 0) {
            const sum = notas.reduce((a, b) => a + b.nota, 0);
            const avg = sum / notas.length;
            document.getElementById('mediaGeral').textContent = avg.toFixed(1);
        } else {
            document.getElementById('mediaGeral').textContent = '-';
        }
    }

    renderCharts(notas) {
        // Prepare Data
        const materias = this.config.materias;
        const notasMap = {}; // { materiaId: [nota1, nota2...] }

        notas.forEach(n => {
            if (!notasMap[n.materiaId]) notasMap[n.materiaId] = [];
            notasMap[n.materiaId].push(n.nota);
        });

        // 1. Materias (Bar)
        const labels = materias.map(m => m.nome);
        const dataAvg = materias.map(m => {
            const list = notasMap[m.id];
            if (!list || list.length === 0) return 0;
            return (list.reduce((a, b) => a + b, 0) / list.length).toFixed(1);
        });

        this.renderChart('chartMaterias', 'bar', labels, dataAvg, 'Média por Matéria');

        // 2. Evolucao (Line)
        const bimMap = { 1: [], 2: [], 3: [], 4: [] };
        notas.forEach(n => {
            if (bimMap[n.bimestre]) bimMap[n.bimestre].push(n.nota);
        });
        const evoLabels = ['1º Bim', '2º Bim', '3º Bim', '4º Bim'];
        const evoData = [1, 2, 3, 4].map(b => {
            const list = bimMap[b];
            if (!list || list.length === 0) return null;
            return (list.reduce((a, b) => a + b, 0) / list.length).toFixed(1);
        });

        this.renderChart('chartEvolucao', 'line', evoLabels, evoData, 'Evolução Bimestral');

        // 3. Radar
        this.renderChart('chartRadar', 'radar', labels, dataAvg, 'Desempenho Geral');

        // 4. Tipos (Pie) - requires 'tipo' in note, assuming Note model has 'tipo' (Avaliação, Trabalho, etc)
        // If not, maybe use mock distribution based on random or just omit. 
        // Note schema has 'tipo'.
        const tipoMap = {};
        notas.forEach(n => {
            const t = n.tipo || 'Outros';
            if (!tipoMap[t]) tipoMap[t] = 0;
            tipoMap[t]++;
        });
        const tipoLabels = Object.keys(tipoMap);
        const tipoData = Object.values(tipoMap);

        this.renderChart('chartTipos', 'doughnut', tipoLabels, tipoData, 'Distribuição');
    }

    getColor(value) {
        // Lógica solicitada:
        // Aprovado (>= 6) -> Verde
        // Reprovado (< 6) -> Vermelho
        // O "Amarelo" (Em curso) geralmente é visual, mas se for valor numérico:
        // Vamos usar amarelo para valores entre 5 e 6 (recuperação possível?) ou quando não é final?
        // Mas para gráfico de barras, vamos simplificar:

        const val = parseFloat(value);
        if (isNaN(val)) return '#ffc107'; // Amarelo se inválido (em curso?)

        if (val >= 6.0) return '#198754'; // Verde (Success)
        return '#dc3545'; // Vermelho (Danger)
    }

    renderChart(canvasId, type, labels, data, label) {
        const ctx = document.getElementById(canvasId);
        if (!ctx) return;

        if (this.charts[canvasId]) this.charts[canvasId].destroy();

        // Generate colors for each data point
        const backgroundColors = data.map(v => {
            if (canvasId === 'chartRadar') return 'rgba(13, 110, 253, 0.2)'; // Blue transparent for Radar
            return this.getColor(v || 0);
        });

        const borderColors = data.map(v => {
            if (canvasId === 'chartRadar') return '#0d6efd';
            return this.getColor(v || 0);
        });

        const config = {
            type: type,
            data: {
                labels: labels,
                datasets: [{
                    label: label,
                    data: data,
                    backgroundColor: type === 'line' || type === 'radar' ? 'rgba(13, 110, 253, 0.2)' : backgroundColors,
                    borderColor: type === 'line' || type === 'radar' ? '#0d6efd' : borderColors,
                    borderWidth: 2,
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: (type === 'bar' || type === 'line' || type === 'radar') ? {
                    y: { beginAtZero: true, max: 10 },
                    r: { beginAtZero: true, max: 10 }
                } : {}
            }
        };

        this.charts[canvasId] = new Chart(ctx, config);
    }

    async exportarBoletim() {
        if (!window.jspdf) {
            alert('Biblioteca PDF não carregada. Tente recarregar a página.');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const aluno = this.selectedAluno;

        // Header
        doc.setFontSize(18);
        doc.text('Boletim Escolar', 105, 15, { align: 'center' });

        doc.setFontSize(12);
        doc.text(`Aluno: ${aluno.nome}`, 14, 30);
        doc.text(`Turma: ${aluno.turmaId || '-'}`, 14, 38);
        doc.text(`Matrícula: ${aluno.matricula || '-'}`, 14, 46);
        doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, 150, 30);

        // Table Data
        const headers = [['Matéria', '1º Bim', '2º Bim', '3º Bim', '4º Bim', 'Média Final', 'Situação']];
        const data = [];

        // Reusing table generation logic logic
        const materias = this.config.materias;
        const notasMap = {};
        if (aluno.notas) {
            aluno.notas.forEach(n => {
                if (!notasMap[n.materiaId]) notasMap[n.materiaId] = { 1: [], 2: [], 3: [], 4: [] };
                if (notasMap[n.materiaId][n.bimestre]) notasMap[n.materiaId][n.bimestre].push(n.nota);
            });
        }

        materias.forEach(m => {
            const mData = notasMap[m.id] || { 1: [], 2: [], 3: [], 4: [] };
            const getAvg = (list) => list.length ? (list.reduce((a, b) => a + b, 0) / list.length).toFixed(1) : '-';

            const n1 = getAvg(mData[1]);
            const n2 = getAvg(mData[2]);
            const n3 = getAvg(mData[3]);
            const n4 = getAvg(mData[4]);

            // Calc Final
            const allNotes = [...mData[1], ...mData[2], ...mData[3], ...mData[4]];
            const final = getAvg(allNotes);
            const situacao = final !== '-' ? (parseFloat(final) >= 5 ? 'Aprovado' : 'Recuperação') : '-';

            data.push([m.nome, n1, n2, n3, n4, final, situacao]);
        });

        // Generate Table
        doc.autoTable({
            head: headers,
            body: data,
            startY: 55,
            theme: 'grid',
            headStyles: { fillColor: [13, 110, 253] }, // Blue header
            styles: { fontSize: 10, cellPadding: 3 },
            columnStyles: {
                0: { cellWidth: 50 },
                5: { fontStyle: 'bold' }
            },
            didParseCell: function (data) {
                // Colorize Final Average
                if (data.section === 'body' && data.column.index === 5) {
                    const val = parseFloat(data.cell.raw);
                    if (!isNaN(val)) {
                        if (val < 5) data.cell.styles.textColor = [220, 53, 69]; // Red
                        else if (val < 7) data.cell.styles.textColor = [255, 193, 7]; // Yellow (Darker for text -> Orange-ish?) Let's use standard.
                        else data.cell.styles.textColor = [13, 110, 253]; // Blue
                    }
                }
            }
        });

        // Footer
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(10);
            doc.text('Sistema Escolar Digital', 105, 290, { align: 'center' });
        }

        doc.save(`Boletim_${aluno.nome.replace(/\s+/g, '_')}.pdf`);
    }

    renderBoletim(notas) {
        const tbody = document.getElementById('boletimTableBody');
        tbody.innerHTML = '';

        const materias = this.config.materias;
        const notasMap = {};
        // Structure: { materiaId: { 1: [], 2: [], 3: [], 4: [] } }

        notas.forEach(n => {
            if (!notasMap[n.materiaId]) notasMap[n.materiaId] = { 1: [], 2: [], 3: [], 4: [] };
            if (notasMap[n.materiaId][n.bimestre]) notasMap[n.materiaId][n.bimestre].push(n.nota);
        });

        materias.forEach(m => {
            const mData = notasMap[m.id] || { 1: [], 2: [], 3: [], 4: [] };
            const getAvg = (list) => list.length ? (list.reduce((a, b) => a + b, 0) / list.length).toFixed(1) : '-';

            const n1 = getAvg(mData[1]);
            const n2 = getAvg(mData[2]);
            const n3 = getAvg(mData[3]);
            const n4 = getAvg(mData[4]);

            // Final Avg (simplified)
            const allNotes = [...mData[1], ...mData[2], ...mData[3], ...mData[4]];
            const final = getAvg(allNotes);

            // Lógica de Situação:
            // - Se final !== '-' e >= 6.0: Aprovado (Verde)
            // - Se final !== '-' e < 6.0: Reprovado (Vermelho)
            // - Se final === '-': Em Curso (Amarelo)

            let statusHtml = '';
            if (final === '-') {
                statusHtml = '<span class="status-warning" style="color: #ffc107; font-weight: bold;">Em Curso</span>';
            } else if (parseFloat(final) >= 6.0) {
                statusHtml = '<span class="status-pass" style="color: #198754; font-weight: bold;">Aprovado</span>';
            } else {
                statusHtml = '<span class="status-fail" style="color: #dc3545; font-weight: bold;">Reprovado</span>';
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="materia-icon">${m.icone}</span> ${m.nome}</td>
                <td>${n1}</td>
                <td>${n2}</td>
                <td>${n3}</td>
                <td>${n4}</td>
                <td><strong>${final}</strong></td>
                <td>${statusHtml}</td>
             `;
            tbody.appendChild(tr);
        });
    }

    resetState() {
        document.querySelector('.aluno-info-card').classList.add('hidden');
        document.querySelector('.graficos-container').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
    }

    showToast(msg, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = msg;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }
}

const graficosPage = new GraficosPage();
document.addEventListener('DOMContentLoaded', () => {
    graficosPage.init();
});
