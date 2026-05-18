/**
 * Gerenciar Salas Script
 * Permite ao Diretor/Admin gerenciar quais professores estão em quais salas
 */

const todasSalas = [
    '1ºA', '1ºB', '1ºC', '1ºD',
    '2ºA', '2ºB', '2ºC', '2ºD',
    '3ºA', '3ºB', '3ºC', '3ºD',
    '4ºA', '4ºB', '4ºC', '4ºD',
    '5ºA', '5ºB', '5ºC', '5ºD'
];

let todosProfessores = [];

// Helper para normalizar nomes de salas (ex: 5ºD -> 5D, 1 A -> 1A)
const normalize = (t) => String(t || '').replace('º', '').replace(/\s+/g, '').toUpperCase().trim();

// === INICIALIZAÇÍO ===
document.addEventListener('DOMContentLoaded', async () => {
    await db.init();
    await auth.init();

    // Verifica se está autenticado e se é diretor/admin
    if (!auth.isAuthenticated()) {
        window.location.href = 'index.html';
        return;
    }

    const user = auth.getCurrentUser();
    if (user.perfil !== 'diretor' && user.perfil !== 'admin') {
        window.location.href = 'dashboard.html';
        return;
    }

    await carregarDados();
    setupSearch();
});

// === CARREGAR DADOS ===
async function carregarDados() {
    try {
        const response = await db.getAll('professores');
        todosProfessores = response || [];
        renderizarSalas();
    } catch (error) {
        console.error('Erro ao carregar professores:', error);
        showToast('Erro ao carregar dados dos professores', 'error');
    }
}

// === RENDERIZAR SALAS ===
function renderizarSalas(filtro = '') {
    const grid = document.getElementById('salasGrid');
    grid.innerHTML = '';

    const salasFiltradas = todasSalas.filter(sala => 
        sala.toLowerCase().includes(filtro.toLowerCase())
    );

    if (salasFiltradas.length === 0) {
        grid.innerHTML = '<div class="loading-state"><p>Nenhuma sala encontrada.</p></div>';
        return;
    }

    salasFiltradas.forEach((sala, index) => {
        // Encontra professores vinculados a esta sala usando normalização
        const professoresNaSala = todosProfessores.filter(p => {
            const salaNorm = normalize(sala);
            const pPrincipalNorm = normalize(p.salaPrincipal);
            const ehPrincipal = pPrincipalNorm === salaNorm;
            
            const ehAdicional = p.salasAdicionais && p.salasAdicionais.some(s => normalize(s) === salaNorm);
            return ehPrincipal || ehAdicional;
        });

        const card = document.createElement('div');
        card.className = 'sala-card';
        card.style.animationDelay = `${index * 0.05}s`;

        let professoresHtml = '';
        if (professoresNaSala.length === 0) {
            professoresHtml = '<div class="empty-sala">Nenhum professor atribuído</div>';
        } else {
            // Ordena: Principal primeiro
            professoresNaSala.sort((a, b) => (normalize(a.salaPrincipal) === normalize(sala) ? -1 : 1));

            professoresHtml = `
                <div class="professores-list">
                    ${professoresNaSala.map(p => {
                        const ehPrincipal = normalize(p.salaPrincipal) === normalize(sala);
                        return `
                            <div class="professor-item">
                                <div class="professor-avatar">
                                    ${p.foto ? `<img src="${p.foto}" alt="${p.nome}">` : '<i class="bi bi-person-fill"></i>'}
                                </div>
                                <div class="professor-info">
                                    <strong>${p.nome}</strong>
                                    <span>${ehPrincipal ? '<i class="bi bi-star-fill text-warning"></i> Regente' : 'Professor(a) de Matéria'}</span>
                                </div>
                                <div class="professor-actions">
                                    <button class="btn-remove-atrib" title="Remover desta sala" 
                                            onclick="removerAtribuicao('${p._id || p.id}', '${sala}', ${ehPrincipal})">
                                        <i class="bi bi-person-dash"></i>
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }

        card.innerHTML = `
            <div class="sala-card-header">
                <div>
                    <h3>${sala}</h3>
                    <span class="badge">${professoresNaSala.length} Prof.</span>
                </div>
                <button class="btn-add-prof" title="Atribuir novo professor" onclick="abrirModalAtribuicao('${sala}')">
                    <i class="bi bi-person-plus-fill"></i>
                </button>
            </div>
            <div class="sala-card-body">
                ${professoresHtml}
            </div>
        `;

        grid.appendChild(card);
    });
}

// === REMOVER ATRIBUIÇÍO ===
async function removerAtribuicao(professorId, sala, ehPrincipal) {
    const professor = todosProfessores.find(p => (p._id || p.id) === professorId);
    if (!professor) return;

    const acao = ehPrincipal ? 'remover o cargo de Regente' : `remover da sala ${sala}`;
    if (!confirm(`Deseja realmente ${acao} para o professor ${professor.nome}?`)) {
        return;
    }

    try {
        let novosDados = { ...professor };

        if (ehPrincipal) {
            // Se remover o principal, fica sem sala principal
            novosDados.salaPrincipal = '';
        } else {
            // Se remover de adicional, filtra o array
            novosDados.salasAdicionais = professor.salasAdicionais.filter(s => s !== sala);
        }

        // Atualiza no banco
        await db.update('professores', novosDados);
        
        showToast('Atribuição removida com sucesso!', 'success');
        
        // Recarrega dados localmente para atualizar a tela
        await carregarDados();
    } catch (error) {
        console.error('Erro ao remover atribuição:', error);
        showToast('Erro ao atualizar atribuição', 'error');
    }
}

// === MODAL ATRIBUIÇÍO ===
let salaSelecionada = '';

function abrirModalAtribuicao(sala) {
    salaSelecionada = sala;
    document.getElementById('modalSalaNome').querySelector('strong').textContent = sala;
    
    const select = document.getElementById('selectProfessor');
    select.innerHTML = '<option value="">Selecione um professor...</option>';
    
    // Ordena professores por nome
    const listaOrdenada = [...todosProfessores].sort((a, b) => a.nome.localeCompare(b.nome));
    
    listaOrdenada.forEach(p => {
        const option = document.createElement('option');
        option.value = p._id || p.id;
        option.textContent = p.nome;
        select.appendChild(option);
    });
    
    document.getElementById('modalAtribuicao').classList.add('active');
}

function fecharModal() {
    document.getElementById('modalAtribuicao').classList.remove('active');
    document.getElementById('selectProfessor').value = '';
    salaSelecionada = '';
}

async function salvarAtribuicao() {
    const profId = document.getElementById('selectProfessor').value;
    const tipo = document.querySelector('input[name="tipoAtribuicao"]:checked').value;
    
    if (!profId) {
        showToast('Selecione um professor', 'warning');
        return;
    }
    
    const professor = todosProfessores.find(p => (p._id || p.id) === profId);
    if (!professor) return;

    try {
        let novosDados = { ...professor };
        const salaNormalizada = normalize(salaSelecionada);

        if (tipo === 'principal') {
            // Verifica se já tem regente na sala
            const regenteAtual = todosProfessores.find(p => normalize(p.salaPrincipal) === salaNormalizada);
            if (regenteAtual && regenteAtual._id !== professor._id) {
                if (!confirm(`A sala ${salaSelecionada} já possui ${regenteAtual.nome} como Regente. Deseja substituí-lo?`)) {
                    return;
                }
                // Opcional: remover o regente antigo? Geralmente melhor apenas substituir o dele para vazio se quiser ser rigoroso
            }
            novosDados.salaPrincipal = salaSelecionada;
        } else {
            // Adicional
            if (!novosDados.salasAdicionais) novosDados.salasAdicionais = [];
            if (!novosDados.salasAdicionais.includes(salaSelecionada)) {
                novosDados.salasAdicionais.push(salaSelecionada);
            } else {
                showToast('Professor já está nesta sala', 'info');
                fecharModal();
                return;
            }
        }

        await db.update('professores', novosDados);
        showToast('Professor atribuído com sucesso!', 'success');
        fecharModal();
        await carregarDados();
    } catch (error) {
        console.error('Erro ao salvar atribuição:', error);
        showToast('Erro ao salvar no servidor', 'error');
    }
}

// === BUSCA ===
function setupSearch() {
    const searchInput = document.getElementById('searchSala');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            renderizarSalas(e.target.value);
        });
    }
}
