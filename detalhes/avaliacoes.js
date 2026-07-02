/**
 * Script para página de lista de avaliações
 * Migrado para usar sistema API global
 */

document.addEventListener('DOMContentLoaded', async () => {
    console.log('📝 Página de Avaliações carregando...');
    console.log('✅ Verificando dependências globais:', { db: typeof db, auth: typeof auth });

    if (typeof db === 'undefined') {
        console.error('❌ ERRO: db não está disponível!');
        alert('Erro crítico: Sistema de banco de dados não carregado. Recarregue a página.');
        return;
    }

    if (typeof auth === 'undefined') {
        console.error('❌ ERRO: auth não está disponível!');
        alert('Erro crítico: Sistema de autenticação não carregado. Recarregue a página.');
        return;
    }

    await init();
});

async function init() {
    try {
        console.log('🔧 Inicializando banco de dados...');
        await db.init();

        console.log('🔑 Verificando autenticação...');
        // Verifica autenticação
        console.log('🔑 Verificando autenticação...');
        // Verifica autenticação
        const user = auth.getCurrentUser() || await auth.checkSession();
        console.log('👤 Usuário atual:', user);

        if (!user) {
            console.warn('⚠️ Usuário não autenticado');
            window.location.href = '../login.html';
            return;
        }

        console.log('📋 Carregando filtros e avaliações para:', user.nome, '(', user.perfil, ')');
        await loadFilters();
        await loadAvaliacoes(user);

        document.getElementById('filtroMateria').addEventListener('change', () => loadAvaliacoes(user));
        document.getElementById('filtroBimestre').addEventListener('change', () => loadAvaliacoes(user));
        document.getElementById('searchAluno').addEventListener('input', debounce(() => loadAvaliacoes(user), 300));
    } catch (error) {
        console.error('❌ Erro crítico ao inicializar:', error);
        const tableBody = document.getElementById('avaliacoesTableBody');
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--danger);">Erro crítico: ${error.message}</td></tr>`;
        }
    }
}

async function loadFilters() {
    const materias = db.getMaterias();
    const select = document.getElementById('filtroMateria');

    materias.forEach(m => {
        const option = document.createElement('option');
        option.value = m.id;
        option.textContent = m.nome;
        select.appendChild(option);
    });
}

async function loadAvaliacoes(user) {
    const tableBody = document.getElementById('avaliacoesTableBody');
    const emptyState = document.getElementById('emptyState');

    const filtroMateria = document.getElementById('filtroMateria').value;
    const filtroBimestre = document.getElementById('filtroBimestre').value;
    const termo = document.getElementById('searchAluno').value.toLowerCase();

    // Buscar dados da API
    let [todasNotas, todosAlunos] = await Promise.all([
        db.getAll('notas'),
        db.getAll('alunos')
    ]);

    const turmas = await db.getAll('turmas');
    const materias = db.getMaterias();

    // Aplicar filtro de professor
    if (user.perfil === 'professor') {
        const turmasFiltradas = await getTurmasFiltradas(user, turmas);
        const turmaIds = turmasFiltradas.map(t => t.id);

        todasNotas = todasNotas.filter(n => {
            const tId = n.turmaId || n.turma;
            return turmaIds.includes(tId);
        });
        todosAlunos = todosAlunos.filter(a => turmaIds.includes(a.turma));
    }

    // Mapas para lookup rápido
    const alunosMap = {};
    todosAlunos.forEach(a => alunosMap[a.id || a._id] = a);

    const turmasMap = {};
    turmas.forEach(t => turmasMap[t.id] = t);

    const materiasMap = {};
    materias.forEach(m => materiasMap[m.id] = m);

    // Filtrar e Enriquecer
    let notasEnriquecidas = todasNotas.map(n => {
        const aluno = alunosMap[n.alunoId || n.aluno];
        if (!aluno) return null;

        const turmaId = n.turmaId || n.turma;
        const materiaId = n.materiaId || n.materia;

        return {
            ...n,
            alunoNome: aluno.nome,
            alunoMatricula: aluno.matricula,
            turmaNome: turmasMap[turmaId]?.id || turmaId || '?',
            materiaNome: materiasMap[materiaId]?.nome || '?',
            materiaIcone: materiasMap[materiaId]?.icone || '📝'
        };
    }).filter(n => n !== null);

    // Aplicar filtros de interface
    notasEnriquecidas = notasEnriquecidas.filter(n => {
        const materiaId = n.materiaId || n.materia;
        const matchMateria = filtroMateria ? materiaId === filtroMateria : true;
        const matchBimestre = filtroBimestre ? String(n.bimestre) === filtroBimestre : true;
        const matchAluno = n.alunoNome.toLowerCase().includes(termo) ||
            (n.alunoMatricula && n.alunoMatricula.includes(termo));

        return matchMateria && matchBimestre && matchAluno;
    });

    // Ordenar por data mais recente
    notasEnriquecidas.sort((a, b) => new Date(b.data || b.dataLancamento) - new Date(a.data || a.dataLancamento));

    // Renderizar
    tableBody.innerHTML = '';

    if (notasEnriquecidas.length === 0) {
        tableBody.parentElement.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    tableBody.parentElement.classList.remove('hidden');
    emptyState.classList.add('hidden');

    const limit = 100;
    const displayData = notasEnriquecidas.slice(0, limit);

    displayData.forEach(n => {
        const tr = document.createElement('tr');

        let notaClass = 'nota-media';
        if (n.nota >= 8) notaClass = 'nota-alta';
        else if (n.nota < 6) notaClass = 'nota-baixa';

        const dataFormatada = new Date(n.data || n.dataLancamento).toLocaleDateString('pt-BR');

        tr.innerHTML = `
            <td style="font-size: 0.85rem; color: var(--text-muted);">${dataFormatada}</td>
            <td>
                <div style="font-weight: 500; color: var(--text-white);">${n.alunoNome}</div>
            </td>
            <td><span class="badge badge-turma">${n.turmaNome}</span></td>
            <td>
                <span style="display: flex; align-items: center; gap: 5px;">
                    <span>${n.materiaIcone}</span> ${n.materiaNome}
                </span>
            </td>
            <td>
                <div style="font-size: 0.9rem;">${n.tipo || 'Prova'}</div>
                <div style="font-size: 0.75rem; color: var(--text-muted);">${n.bimestre}º Bimestre</div>
            </td>
            <td><span class="media-valor ${notaClass}">${n.nota.toFixed(1)}</span></td>
        `;
        tableBody.appendChild(tr);
    });

    if (notasEnriquecidas.length > limit) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="6" style="text-align: center; color: var(--text-muted); font-size: 0.8rem;">Exibindo últimos ${limit} registros de ${notasEnriquecidas.length}</td>`;
        tableBody.appendChild(tr);
    }
}

async function getTurmasFiltradas(user, turmasBase) {
    try {
        const professores = await db.getAll('professores');

        const prof = professores.find(p => {
            const pEmail = String(p.email || '').toLowerCase();
            const uEmail = String(user.email || '').toLowerCase();
            const emailMatch = pEmail === uEmail && uEmail !== '';

            const pIdUser = String(p.idUsuario || '');
            const uId = String(user.id || user._id || '');
            const idMatch = pIdUser === uId && uId !== '';

            return emailMatch || idMatch;
        });

        if (!prof) return [];

        const permitidas = [];
        if (prof.salaPrincipal && prof.salaPrincipal !== 'VARIADOS') {
            permitidas.push(prof.salaPrincipal);
        }
        if (prof.salasAdicionais) permitidas.push(...prof.salasAdicionais);

        const normalizeTurma = (n) => String(n || '').replace('º', '').replace(/\s+/g, '').toUpperCase().trim();
        const permitidasNorm = permitidas.map(t => normalizeTurma(t));

        return turmasBase.filter(t => {
            const tIdNorm = normalizeTurma(t.id);
            return permitidasNorm.includes(tIdNorm) || permitidas.includes(t.id);
        });
    } catch (e) {
        console.error('Erro ao filtrar turmas:', e);
        return [];
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
