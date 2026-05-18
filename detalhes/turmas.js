/**
 * Script para página de lista de turmas
 * Migrado para usar sistema API global
 */

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🏫 Página de Turmas carregando...');
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
        // Garante que o banco está pronto
        await db.init();

        console.log('🔑 Verificando autenticação...');
        // Verifica autenticação
        const user = auth.getCurrentUser() || await auth.checkSession();
        console.log('👤 Usuário atual:', user);

        if (!user) {
            console.warn('⚠️ Usuário não autenticado');
            window.location.href = '../index.html';
            return;
        }

        console.log('📊 Carregando turmas para:', user.nome, '(', user.perfil, ')');
        await loadTurmas(user);
    } catch (error) {
        console.error('❌ Erro crítico ao inicializar:', error);
        const tableBody = document.getElementById('turmasTableBody');
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--danger);">Erro crítico: ${error.message}</td></tr>`;
        }
    }
}

async function loadTurmas(user) {
    const tableBody = document.getElementById('turmasTableBody');

    // Buscar dados da API
    let turmas = await db.getAll('turmas'); // JSON estático não mais usado
    const [alunos, notas] = await Promise.all([
        db.getAll('alunos'),
        db.getAll('notas')
    ]);

    // Aplicar filtro de professor (mesma lógica do selecionar.js)
    if (user.perfil === 'professor') {
        turmas = await getTurmasFiltradas(user, turmas);
    }

    // Contar alunos por turma
    const countByTurma = {};
    alunos.forEach(a => {
        if (a.turma) {
            countByTurma[a.turma] = (countByTurma[a.turma] || 0) + 1;
        }
    });

    // Calcular médias por turma
    const statsByTurma = {};
    turmas.forEach(t => {
        const notasTurma = notas.filter(n => n.turma === t.id);
        if (notasTurma.length > 0) {
            const soma = notasTurma.reduce((acc, n) => acc + (parseFloat(n.nota) || 0), 0);
            statsByTurma[t.id] = soma / notasTurma.length;
        } else {
            statsByTurma[t.id] = null;
        }
    });

    // Preparar dados
    const turmasComDados = turmas.map(t => ({
        ...t,
        totalAlunos: countByTurma[t.id] || 0,
        mediaGeral: statsByTurma[t.id]
    }));

    // Renderizar
    tableBody.innerHTML = '';

    if (turmasComDados.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 2rem;">Nenhuma turma encontrada.</td></tr>';
        return;
    }

    turmasComDados.forEach(t => {
        const tr = document.createElement('tr');

        let mediaHtml = '<span style="color: var(--text-muted);">-</span>';
        if (t.mediaGeral !== null) {
            const color = t.mediaGeral >= 6 ? 'var(--success-color)' : 'var(--danger-color)';
            mediaHtml = `<strong style="color: ${color}">${t.mediaGeral.toFixed(1)}</strong>`;
        }

        tr.innerHTML = `
            <td>
                <div style="font-weight: 500; font-size: 1.1rem; color: var(--text-white);">${t.id}</div>
            </td>
            <td><span class="badge badge-turma">Ativa</span></td>
            <td><strong>${t.totalAlunos}</strong> alunos</td>
            <td>${mediaHtml}</td>
            <td style="text-align: right;">
                 <a href="../turma.html?turma=${t.id}" class="btn btn-primary" style="padding: 0.5rem 1rem; font-size: 0.8rem;">
                    Acessar Turma <i class="bi bi-arrow-right"></i>
                </a>
            </td>
        `;
        tableBody.appendChild(tr);
    });
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
