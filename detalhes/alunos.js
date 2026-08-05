/**
 * Script para página de lista de alunos
 */
import db from '../js/db.js';
import students from '../js/students.js';
import ui from '../js/ui.js';

document.addEventListener('DOMContentLoaded', async () => {
    await init();
});

async function init() {
    try {
        // Mostra loading imediatamente
        ui.loading(true, 'Conectando ao banco de dados...');
        
        // Timeout de segurança aumentado para 50s (necessário para o "acordar" do Render)
        const initPromise = db.init();
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('O servidor ainda está iniciando (isso é normal no primeiro acesso). Por favor, aguarde mais alguns segundos.')), 50000)
        );

        await Promise.race([initPromise, timeoutPromise]);

        // Carregar turmas para o select
        await loadTurmas();

        // Verificar parâmetros da URL
        const urlParams = new URLSearchParams(window.location.search);
        const turmaUrl = urlParams.get('turma') || urlParams.get('turmaId');

        if (turmaUrl) {
            const el = document.getElementById('filtroTurma');
            if (el) el.value = turmaUrl;
            await loadAlunos();
        } else {
            // Se não tem turma na URL, encerra o loading e pede seleção
            ui.loading(false);
            mostrarAvisoSelecao();
        }

        // Listeners
        document.getElementById('searchAluno')?.addEventListener('input', debounce(loadAlunos, 300));
        document.getElementById('filtroTurma')?.addEventListener('change', loadAlunos);
        document.getElementById('filtroPCD')?.addEventListener('change', loadAlunos);
        document.getElementById('formEditAluno')?.addEventListener('submit', salvarEdicao);

    } catch (error) {
        ui.loading(false); // GARANTE que o loading suma em caso de erro
        console.error('Erro ao inicializar:', error);
        
        const tableBody = document.getElementById('alunosTableBody');
        if (tableBody) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center" style="padding: 3rem; color: #ff4444;">
                        <i class="bi bi-exclamation-triangle" style="font-size: 3rem;"></i>
                        <h3 style="margin-top: 1rem;">O servidor está demorando para acordar</h3>
                        <p>${error.message}</p>
                        <button onclick="window.location.reload()" class="btn btn-primary" style="margin-top: 1rem;">Tentar Novamente</button>
                    </td>
                </tr>
            `;
        }
    }
}

async function loadTurmas() {
    try {
        console.log('🔍 Buscando turmas para o seletor...');
        
        // 1. Tenta pegar do que já foi carregado no db.init()
        let turmas = db.getTurmas();
        
        // 2. Se estiver vazio, tenta buscar direto da API de novo
        if (!turmas || turmas.length === 0) {
            console.log('⚠️ Cache de turmas vazio, buscando da API...');
            turmas = await db.getAll('turmas');
        }

        const select = document.getElementById('filtroTurma');
        const editSelect = document.getElementById('editAlunoTurma');
        const bulkSelect = document.getElementById('bulkTransferTurma');
        
        if (!select && !editSelect && !bulkSelect) {
            console.warn('❌ Elementos de seletor de turma não encontrados na página');
            return;
        }

        if (select) select.innerHTML = '<option value="">Todas as Turmas</option>';
        if (editSelect) editSelect.innerHTML = '<option value="">Selecione uma turma...</option>';
        if (bulkSelect) bulkSelect.innerHTML = '<option value="">Escolha a sala...</option>';

        if (turmas && turmas.length > 0) {
            // Ordena turmas por nome (ID)
            turmas.sort((a, b) => {
                const idA = String(a.id || a._id || '');
                const idB = String(b.id || b._id || '');
                return idA.localeCompare(idB);
            });

            console.log(`✅ Populando ${turmas.length} turmas no seletor`);

            turmas.forEach(t => {
                const idTurma = t.id || t._id;
                if (!idTurma) return;

                const nomeExibir = `Turma ${idTurma}`;
                
                if (select) {
                    const option = document.createElement('option');
                    option.value = idTurma;
                    option.textContent = nomeExibir;
                    select.appendChild(option);
                }

                if (editSelect) {
                    const option = document.createElement('option');
                    option.value = idTurma;
                    option.textContent = nomeExibir;
                    editSelect.appendChild(option);
                }

                if (bulkSelect) {
                    const option = document.createElement('option');
                    option.value = idTurma;
                    option.textContent = nomeExibir;
                    bulkSelect.appendChild(option);
                }
            });
        } else {
            console.warn('❓ Nenhuma turma encontrada no banco de dados.');
        }
    } catch (e) {
        console.error('Erro ao carregar turmas:', e);
    }
}

function mostrarAvisoSelecao() {
    const tableBody = document.getElementById('alunosTableBody');
    const totalAlunosEl = document.getElementById('totalAlunos');
    const turmas = db.getTurmas();
    
    if (totalAlunosEl) totalAlunosEl.textContent = '0';
    
    if (tableBody) {
        if (!turmas || turmas.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="text-center" style="padding: 4rem 2rem;">
                        <p style="color: var(--text-muted);">Buscando lista de turmas...</p>
                    </td>
                </tr>
            `;
            return;
        }

        // Criar uma lista vertical de turmas
        let turmasHtml = turmas.map(t => `
            <div onclick="document.getElementById('filtroTurma').value='${t.id}'; document.getElementById('filtroTurma').dispatchEvent(new Event('change'));"
                 style="background: var(--bg-elevated); padding: 15px 25px; border-radius: 12px; border: 1px solid var(--border-secondary); cursor: pointer; display: flex; align-items: center; justify-content: space-between; transition: all 0.2s ease; margin-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 15px;">
                    <i class="bi bi-people-fill" style="font-size: 1.5rem; color: var(--primary);"></i>
                    <span style="font-size: 1.2rem; font-weight: 600; color: var(--text-primary);">Turma ${t.id}</span>
                </div>
                <i class="bi bi-chevron-right" style="color: var(--text-muted);"></i>
            </div>
        `).join('');

        tableBody.innerHTML = `
            <tr>
                <td colspan="5" class="text-center" style="padding: 2rem 1rem;">
                    <div style="max-width: 500px; margin: 0 auto; text-align: left;">
                        <h2 style="color: var(--text-primary); margin-bottom: 1.5rem; text-align: center;">Selecione uma Sala na Lista</h2>
                        ${turmasHtml}
                    </div>
                    <p style="margin-top: 1.5rem; color: var(--text-muted); font-size: 0.9rem;">
                        Clique em uma turma acima para carregar os alunos.
                    </p>
                </td>
            </tr>
        `;
    }
}

async function loadAlunos() {
    const tableBody = document.getElementById('alunosTableBody');
    const emptyState = document.getElementById('emptyState');

    // Elementos de UI
    const searchInput = document.getElementById('searchAluno');
    const termo = searchInput ? searchInput.value.toLowerCase() : '';

    const turmaSelect = document.getElementById('filtroTurma');
    const turmaId = turmaSelect ? turmaSelect.value : '';

    const pcdCheckbox = document.getElementById('filtroPCD');
    const isPCD = pcdCheckbox ? pcdCheckbox.checked : false;

    // Se não tiver termo de busca E não tiver turma selecionada, não carrega nada (mostra aviso)
    if (!termo && !turmaId && !isPCD) {
        mostrarAvisoSelecao();
        return;
    }

    try {
        ui.loading(true, 'Buscando alunos...');
        
        let alunosRaw;
        // Se tiver uma turma selecionada, busca APENAS os alunos dela (Muito mais rápido!)
        if (turmaId) {
            alunosRaw = await students.getByTurma(turmaId);
        } else {
            // Se não tiver turma (ex: busca por nome global), busca todos
            alunosRaw = await students.getAll();
        }
        
        ui.loading(false);

        const totalAlunosEl = document.getElementById('totalAlunos');

        // Aplicar filtros
        let alunos = alunosRaw.filter(a => {
            // Filtro Nome/Matricula (Safe)
            const nome = a.nome ? a.nome.toLowerCase() : '';
            const matricula = a.matricula ? String(a.matricula) : '';
            const matchNome = nome.includes(termo) || matricula.includes(termo);

            // Filtro Turma
            const matchTurma = turmaId ? String(a.turmaId) === String(turmaId) : true;

            // Filtro PCD (Lógica igual ao dashboard: apenas verifica se tem valor truthy)
            let matchPCD = true;
            if (isPCD) {
                // Checa se existe e é string não vazia
                matchPCD = !!a.deficiencia && String(a.deficiencia).trim().length > 0;
            }

            return matchNome && matchTurma && matchPCD;
        });

        // Atualizar contador com o total filtrado
        if (totalAlunosEl) totalAlunosEl.textContent = alunos.length;

        // Limpar loading
        if (tableBody) tableBody.innerHTML = '';

        if (alunos.length === 0) {
            if (tableBody && tableBody.parentElement) tableBody.parentElement.classList.add('hidden');
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }

        if (tableBody && tableBody.parentElement) tableBody.parentElement.classList.remove('hidden');
        if (emptyState) emptyState.classList.add('hidden');

        const turmasMap = {};
        db.getTurmas().forEach(t => turmasMap[t.id] = t);

        alunos.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

        if (tableBody) {
            alunos.forEach(aluno => {
                const tr = document.createElement('tr');
                const t = turmasMap[aluno.turmaId];
                // Se a turma existir, usa o ID dela (ex: 1A), senão '?'
                const nomeTurma = t ? t.id : '?';

                let statusHtml = '';
                if (aluno.deficiencia) {
                    // Se tem deficiência, mostra Badge e a descrição
                    statusHtml = `
                        <div style="display:flex; flex-direction:column; gap:2px;">
                            <span class="badge badge-pcd" style="width: fit-content;">PCD</span>
                            <span style="font-size: 0.8rem; color: var(--text-muted);">${aluno.deficiencia}</span>
                        </div>
                    `;
                } else {
                    // Se não, espaço vazio ou status normal
                    statusHtml = '<span style="color: var(--text-muted);">-</span>';
                }

                tr.innerHTML = `
                    <td><input type="checkbox" class="student-select" value="${aluno.id || aluno._id}"></td>
                    <td>
                        <div style="font-weight: 500; color: var(--text-white);">${aluno.nome}</div>
                        <div style="font-size: 0.8rem; margin-top: 4px; color: ${aluno.responsavel ? '#22c55e' : '#ef4444'};">
                            ${aluno.responsavel
                                ? `<i class="bi bi-person-check-fill"></i> ${aluno.responsavel}`
                                : `<i class="bi bi-person-x-fill"></i> Nenhum responsável vinculado`}
                        </div>
                    </td>
                    <td><code style="background:rgba(255,255,255,0.1); padding: 2px 5px; border-radius: 4px;">${aluno.matricula || '-'}</code></td>
                    <td><span class="badge badge-turma">${nomeTurma}</span></td>
                    <td>${statusHtml}</td>
                    <td style="text-align: right; display: flex; gap: 5px; justify-content: flex-end;">
                         <button class="btn btn-ghost btn-sm btn-edit" data-id="${aluno.id || aluno._id}" title="Editar Aluno">
                            <i class="bi bi-pencil"></i>
                        </button>
                         <a href="../html/turma.html?turma=${aluno.turmaId}" class="btn btn-ghost btn-sm" title="Ver na Turma">
                            <i class="bi bi-eye"></i>
                        </a>
                    </td>
                `;

                tableBody.appendChild(tr);
            });

            // Delegação de Eventos para os botões (Mais Robusto)
            tableBody.onclick = (e) => {
                const btnEdit = e.target.closest('.btn-edit');
                if (btnEdit) {
                    e.preventDefault();
                    const alunoId = btnEdit.getAttribute('data-id');
                    console.log('🔍 Clique no lápis detectado para ID:', alunoId);
                    
                    // Busca o aluno no array local para abrir o modal
                    const aluno = alunos.find(a => (a.id || a._id) === alunoId);
                    if (aluno) {
                        abrirModalEdicao(aluno);
                    } else {
                        console.error('❌ Aluno não encontrado localmente para edição');
                    }
                }
            };

            // Lógica de Selecionar Todos
            const selectAll = document.getElementById('selectAll');
            if (selectAll) {
                selectAll.onchange = (e) => {
                    const checkboxes = document.querySelectorAll('.student-select');
                    checkboxes.forEach(cb => cb.checked = e.target.checked);
                    atualizarBarraAcoesMassa();
                };
            }

            // Monitorar mudanças em checkboxes individuais
            tableBody.onchange = (e) => {
                if (e.target.classList.contains('student-select')) {
                    atualizarBarraAcoesMassa();
                }
            };
        }
    } catch (error) {
        console.error('Erro ao renderizar lista de alunos:', error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding: 2rem; color: var(--danger);">Erro crítico ao carregar lista: ${error.message}</td></tr>`;
        }
    }
}

function atualizarBarraAcoesMassa() {
    const selecionados = document.querySelectorAll('.student-select:checked');
    const barra = document.getElementById('bulkActionsBar');
    const contador = document.getElementById('bulkSelectedCount');
    
    if (selecionados.length > 0) {
        barra.classList.remove('hidden');
        contador.textContent = `${selecionados.length} ${selecionados.length === 1 ? 'aluno selecionado' : 'alunos selecionados'}`;
    } else {
        barra.classList.add('hidden');
    }
}

async function executarTransferenciaMassa() {
    const novaTurmaId = document.getElementById('bulkTransferTurma').value;
    const selecionados = document.querySelectorAll('.student-select:checked');
    
    if (!novaTurmaId) {
        alert('Por favor, selecione a sala de destino.');
        return;
    }

    if (!confirm(`Deseja transferir ${selecionados.length} alunos para a Turma ${novaTurmaId}?`)) {
        return;
    }

    try {
        ui.loading(true, `Transferindo ${selecionados.length} alunos...`);
        
        const ids = Array.from(selecionados).map(cb => cb.value);
        
        // Executa as transferências em paralelo para ser instantâneo
        const promessas = ids.map(async (id) => {
            const aluno = await students.getById(id);
            if (aluno) {
                aluno.turmaId = novaTurmaId;
                aluno.turma = novaTurmaId; // Sincroniza ambos os campos!
                aluno.transferidoEm = new Date().toISOString();
                return students.update(aluno);
            }
        });

        await Promise.all(promessas);
        
        ui.loading(false);
        if (window.utils && window.utils.showToast) {
            window.utils.showToast(`${selecionados.length} alunos transferidos com sucesso!`, 'success');
        }
        
        // Recarrega a lista
        await loadAlunos();
    } catch (error) {
        ui.loading(false);
        console.error('Erro na transferência em massa:', error);
        alert('Erro ao transferir alguns alunos: ' + error.message);
    }
}

window.executarTransferenciaMassa = executarTransferenciaMassa;

// === LÓGICA DE EDIÇÍO ===

function abrirModalEdicao(aluno) {
    console.log('📝 Abrindo edição para:', aluno.nome);
    document.getElementById('editAlunoId').value = aluno._id || aluno.id;
    document.getElementById('editAlunoNome').value = aluno.nome;
    document.getElementById('editAlunoMatricula').value = aluno.matricula || '';
    document.getElementById('editAlunoTurma').value = aluno.turmaId;
    document.getElementById('editAlunoDeficiencia').value = aluno.deficiencia || '';
    document.getElementById('editAlunoObs').value = aluno.observacoes || '';
    
    renderDocumentosAluno(aluno);
    document.getElementById('modalEditAluno').classList.remove('hidden');
}

function renderDocumentosAluno(aluno) {
    const secao = document.getElementById('secaoDocumentosAluno');
    const badge = document.getElementById('docStatusBadge');
    const list = document.getElementById('docViewerList');
    if (!secao) return;

    const status = aluno.fichaDocumentoStatus || 'pendente';
    const labels = { pendente: 'Documento Pendente', enviado: 'Enviado', conferido: 'Conferido' };
    const colors = { pendente: '#f59e0b', enviado: '#3b82f6', conferido: '#10b981' };
    badge.innerHTML = `<span style="background:${colors[status]}22;color:${colors[status]};padding:4px 12px;border-radius:20px;font-size:0.8rem">${labels[status] || status}</span>`;

    const arquivos = aluno.documentos?.arquivos || (Array.isArray(aluno.documentos) ? aluno.documentos : []);
    if (arquivos.length === 0) {
        list.innerHTML = '<p style="font-size:0.85rem;color:var(--text-secondary)">Nenhum documento enviado.</p>';
    } else {
        const apiBase = (window.API_BASE_URL || '/api').replace(/\/$/, '');
        list.innerHTML = arquivos.map(a => `
            <a href="${apiBase}/upload/documento/${a.gridfsId || a.id}" target="_blank" rel="noreferrer"
               style="display:block;padding:0.5rem;background:rgba(255,255,255,0.05);border-radius:8px;margin-bottom:0.35rem;color:#10b981;text-decoration:none;font-size:0.85rem">
                📄 ${a.nome} ${a.enviadoEm ? `<small style="color:var(--text-secondary)">(${new Date(a.enviadoEm).toLocaleString('pt-BR')})</small>` : ''}
            </a>`).join('');
    }
    secao.style.display = 'block';
    window._alunoDocEditId = aluno._id || aluno.id;
}

window.marcarDocStatus = async function(status) {
    const id = window._alunoDocEditId;
    if (!id) return;
    try {
        await window.apiFetch(`/responsavel/aluno/${id}/documento-status`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
        ui.toast(`Status atualizado: ${status}`, 'success');
        const badge = document.getElementById('docStatusBadge');
        const labels = { pendente: 'Documento Pendente', enviado: 'Enviado', conferido: 'Conferido' };
        const colors = { pendente: '#f59e0b', enviado: '#3b82f6', conferido: '#10b981' };
        badge.innerHTML = `<span style="background:${colors[status]}22;color:${colors[status]};padding:4px 12px;border-radius:20px;font-size:0.8rem">${labels[status]}</span>`;
    } catch (e) {
        ui.toast('Erro: ' + e.message, 'error');
    }
};

window.fecharModal = function() {
    document.getElementById('modalEditAluno').classList.add('hidden');
}

async function salvarEdicao(e) {
    e.preventDefault();
    
    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    
    const id = document.getElementById('editAlunoId').value;
    const nome = document.getElementById('editAlunoNome').value;
    const matricula = document.getElementById('editAlunoMatricula').value;
    const turmaId = document.getElementById('editAlunoTurma').value;
    const deficiencia = document.getElementById('editAlunoDeficiencia').value;
    const observacoes = document.getElementById('editAlunoObs').value;
    
    try {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...';

        // Busca aluno atual para não perder dados que não estão no modal
        const alunoOriginal = await students.getById(id);
        if (!alunoOriginal) throw new Error('Aluno não encontrado no banco');
        
        const novosDados = {
            ...alunoOriginal,
            nome,
            matricula,
            turmaId,
            deficiencia,
            observacoes,
            updatedAt: new Date().toISOString()
        };
        
        // Salva no banco via API de forma instantânea
        const resultado = await students.update(novosDados);
        
        if (resultado) {
            fecharModal();
            // Atualiza apenas a sala atual para ser super rápido
            await loadAlunos(); 
            
            if (window.utils && window.utils.showToast) {
                window.utils.showToast('Alteração salva no MongoDB!', 'success');
            }
        }
        
        if (window.utils && window.utils.showToast) {
            window.utils.showToast('Dados atualizados com sucesso!', 'success');
        }
    } catch (error) {
        console.error('Erro ao salvar aluno:', error);
        alert('Erro ao salvar: ' + error.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
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
