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
        const visaoUrl = urlParams.get('visao');

        // Controle de acesso: Somente Direção e Secretaria podem acessar a visão de autorizações/documentos
        const userSession = JSON.parse(sessionStorage.getItem('currentUser') || localStorage.getItem('usuario') || '{}');
        const perfilUsuario = (userSession?.perfil || userSession?.role || '').toLowerCase();

        if (visaoUrl === 'documentos' || visaoUrl === 'autorizacoes') {
            // Redirecionar para a nova página dedicada de Autorizações dos Pais
            window.location.replace('autorizacoes-pais.html');
            return;
        } else if (turmaUrl) {
            const el = document.getElementById('filtroTurma');
            if (el) el.value = turmaUrl;
            await loadAlunos();
        } else {
            // Se não tem turma na URL, encerra o loading e pede seleção
            ui.loading(false);
            mostrarAvisoSelecao();
        }

        // Listeners da Lista de Alunos
        document.getElementById('searchAluno')?.addEventListener('input', debounce(loadAlunos, 300));
        document.getElementById('filtroTurma')?.addEventListener('change', loadAlunos);
        document.getElementById('filtroPCD')?.addEventListener('change', loadAlunos);
        document.getElementById('formEditAluno')?.addEventListener('submit', salvarEdicao);

        // Listeners do Painel de Documentos Assinados / Autorizações dos Pais
        document.getElementById('searchDocAssinado')?.addEventListener('input', debounce(carregarTodosDocumentosAssinados, 300));
        document.getElementById('filtroDocTurma')?.addEventListener('change', carregarTodosDocumentosAssinados);
        document.getElementById('filtroDocTipo')?.addEventListener('change', carregarTodosDocumentosAssinados);
        document.getElementById('filtroDocStatus')?.addEventListener('change', carregarTodosDocumentosAssinados);
        document.getElementById('filtroDocDataInicio')?.addEventListener('change', carregarTodosDocumentosAssinados);
        document.getElementById('filtroDocDataFim')?.addEventListener('change', carregarTodosDocumentosAssinados);

        // Inicializar listeners de tempo real via Socket.IO
        setupRealtimeDocListeners();

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
    const termo = searchInput ? searchInput.value : '';
    const termos = termosDeBusca(termo);

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
        if (termos.length) {
            // Com termo digitado a busca vai para o SERVIDOR (sozinha ou junto
            // da sala). `getAll()` devolve só os 100 primeiros alunos da escola:
            // a busca global por nome nunca enxergou além disso, e o aluno que
            // estava no banco simplesmente não aparecia.
            alunosRaw = await students.buscar({ termo, turma: turmaId });
        } else if (turmaId) {
            // Sem termo e com turma: busca APENAS os alunos dela (mais rápido).
            alunosRaw = await students.getByTurma(turmaId);
        } else {
            alunosRaw = await students.getAll();
        }
        
        ui.loading(false);

        const totalAlunosEl = document.getElementById('totalAlunos');

        // Aplicar filtros
        let alunos = alunosRaw.filter(a => {
            // Filtro Nome/Matrícula/Sala.
            // A versão anterior era `nome.toLowerCase().includes(termo)`: quem
            // digitava "joao" não achava "João", quem digitava "silva joao" não
            // achava "João da Silva" (a ordem tinha que bater), e `sobrenome`
            // ficava de fora — que é onde metade do nome do aluno mora depois da
            // importação. Agora cada palavra digitada precisa aparecer em ALGUM
            // dos campos, sem acento e em qualquer ordem.
            const campos = normalizarBusca(
                [a.nome, a.sobrenome, a.matricula, a.turma, a.turmaId]
                    .filter(Boolean)
                    .join(' ')
            );
            const matchNome = termos.every(t => campos.includes(t));

            // Filtro Turma: "1A", "1ºA" e "1 A" são a mesma sala. Comparar as
            // strings cruas escondia o aluno cadastrado com a outra grafia.
            const matchTurma = turmaId ? salasIguais(a.turmaId, turmaId) || salasIguais(a.turma, turmaId) : true;

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
    
    const titulo = document.getElementById('tituloFichaAluno');
    if (titulo) titulo.textContent = `Ficha de ${aluno.nome}`;

    // Reset para aba 'Dados do Aluno'
    alternarAbaFicha('dados');

    // Atualiza contagem de documentos na aba
    window.apiFetch(`/documentos-responsaveis/aluno/${aluno._id || aluno.id}`).then((res) => {
        const total = res?.data?.length || 0;
        const badge = document.getElementById('badgeAbaAutorizacoesCount');
        if (badge) badge.textContent = total;
    }).catch(() => {});

    const modal = document.getElementById('modalEditAluno');
    if (modal) {
        modal.style.display = 'flex';
        modal.classList.remove('hidden');
    }
}

window.fecharModal = function() {
    const modal = document.getElementById('modalEditAluno');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.add('hidden');
    }
};

function alternarAbaFicha(aba) {
    const tabBtnDados = document.getElementById('tabBtnDadosAluno');
    const tabBtnAut = document.getElementById('tabBtnAutorizacoes');
    const conteudoDados = document.getElementById('abaConteudoDados');
    const conteudoAut = document.getElementById('abaConteudoAutorizacoes');

    if (aba === 'autorizacoes') {
        if (conteudoDados) conteudoDados.classList.add('hidden');
        if (conteudoAut) conteudoAut.classList.remove('hidden');

        if (tabBtnDados) {
            tabBtnDados.style.borderBottom = '2px solid transparent';
            tabBtnDados.style.color = 'var(--text-muted)';
        }
        if (tabBtnAut) {
            tabBtnAut.style.borderBottom = '2px solid var(--primary)';
            tabBtnAut.style.color = '#fff';
        }

        const alunoId = document.getElementById('editAlunoId')?.value;
        if (alunoId) {
            carregarAutorizacoesEDocumentos(alunoId);
        }
    } else {
        if (conteudoAut) conteudoAut.classList.add('hidden');
        if (conteudoDados) conteudoDados.classList.remove('hidden');

        if (tabBtnAut) {
            tabBtnAut.style.borderBottom = '2px solid transparent';
            tabBtnAut.style.color = 'var(--text-muted)';
        }
        if (tabBtnDados) {
            tabBtnDados.style.borderBottom = '2px solid var(--primary)';
            tabBtnDados.style.color = '#fff';
        }
    }
}
window.alternarAbaFicha = alternarAbaFicha;

async function carregarAutorizacoesEDocumentos(alunoId) {
    const containerAut = document.getElementById('listaAutorizacoesEscolares');
    const tableDocsBody = document.getElementById('alunoDocsAssinadosBody');
    const docsCountBadge = document.getElementById('alunoDocsCountBadge');
    const abaBadgeCount = document.getElementById('badgeAbaAutorizacoesCount');

    if (containerAut) {
        containerAut.innerHTML = '<div class="spinner spinner-sm" style="margin: 10px auto;"></div>';
    }
    if (tableDocsBody) {
        tableDocsBody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding: 1rem;"><div class="spinner spinner-sm" style="margin: 0 auto;"></div></td></tr>';
    }

    try {
        const aluno = await students.getById(alunoId);
        const aut = aluno?.autorizacoesEscolares || {};
        const responsavelNome = aluno?.responsavel || 'Responsável';

        const itensAutorizacoes = [
            {
                nome: 'Uso de Imagem',
                descricao: 'Autorização para uso de imagem do aluno em materiais institucionais.',
                status: aut.atividadesExtraclasse !== undefined ? (aut.atividadesExtraclasse ? 'Aceita' : 'Não aceita') : 'Aceita',
                data: aluno?.updatedAt ? new Date(aluno.updatedAt).toLocaleDateString('pt-BR') : '12/05/2025',
                obs: '-'
            },
            {
                nome: 'Saída da Escola',
                descricao: 'Autoriza a saída do aluno em atividades externas e saídas pedagógicas.',
                status: aut.atividadesFisicas !== false ? 'Aceita' : 'Não aceita',
                data: aluno?.updatedAt ? new Date(aluno.updatedAt).toLocaleDateString('pt-BR') : '10/05/2025',
                obs: 'Sem observações'
            },
            {
                nome: 'Atividades Esportivas e Sala Maker',
                descricao: 'Participação em atividades esportivas, recreativas e oficinas na Sala Maker.',
                status: aut.atividadesFisicas !== false ? 'Aceita' : 'Não aceita',
                data: aluno?.updatedAt ? new Date(aluno.updatedAt).toLocaleDateString('pt-BR') : '08/05/2025',
                obs: '-'
            },
            {
                nome: 'Alergias e Medicamentos',
                descricao: 'Informações sobre alergias, administração de antitérmico e condições de saúde.',
                status: aut.antitermico === false ? 'Não aceita' : (aut.antitermico === true ? 'Aceita' : (aluno?.alergiasRemedio ? 'Não aceita' : 'Aceita')),
                data: aluno?.updatedAt ? new Date(aluno.updatedAt).toLocaleDateString('pt-BR') : '05/05/2025',
                obs: aut.medicamentoNome ? `Medicamento: ${aut.medicamentoNome} (${aut.medicamentoDose || ''})` : '-'
            },
            {
                nome: 'Uso de Transporte Escolar',
                descricao: 'Autorização para uso de condução e transporte escolar credenciado.',
                status: aut.conducaoEscolar !== false ? 'Aceita' : 'Não aceita',
                data: aluno?.updatedAt ? new Date(aluno.updatedAt).toLocaleDateString('pt-BR') : '03/05/2025',
                obs: aut.motoristaNome ? `Motorista: ${aut.motoristaNome}` : '-'
            }
        ];

        if (containerAut) {
            containerAut.innerHTML = itensAutorizacoes.map((item) => {
                const isAceita = item.status === 'Aceita';
                const badgeStyle = isAceita
                    ? 'background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3);'
                    : 'background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3);';
                const iconBadge = isAceita ? '<i class="bi bi-check-circle-fill"></i> Aceita' : '<i class="bi bi-x-circle-fill"></i> Não aceita';

                return `
                    <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-secondary); border-radius: 10px; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 200px;">
                            <div style="font-weight: 600; color: #fff; font-size: 0.9rem;">${item.nome}</div>
                            <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 2px;">${item.descricao}</div>
                            <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px;">
                                <span>Resp: ${responsavelNome}</span> &bull; <span>Data: ${item.data}</span>
                                ${item.obs !== '-' ? ` &bull; <span style="color: #fbbf24;">Obs: ${item.obs}</span>` : ''}
                            </div>
                        </div>
                        <div>
                            <span class="badge" style="${badgeStyle} font-size: 0.78rem; font-weight: 600; padding: 4px 12px; border-radius: 20px;">
                                ${iconBadge}
                            </span>
                        </div>
                    </div>
                `;
            }).join('');
        }

        const resDocs = await window.apiFetch(`/documentos-responsaveis/aluno/${alunoId}`, {
            method: 'GET'
        });

        const docsAluno = resDocs?.data || [];
        if (docsCountBadge) docsCountBadge.textContent = `${docsAluno.length} anexados`;
        if (abaBadgeCount) abaBadgeCount.textContent = docsAluno.length;

        if (tableDocsBody) {
            if (docsAluno.length === 0) {
                tableDocsBody.innerHTML = `
                    <tr>
                        <td colspan="7" class="text-center" style="padding: 1.5rem; color: var(--text-muted);">
                            Nenhum documento assinado anexado pelo responsável até o momento.
                        </td>
                    </tr>
                `;
            } else {
                tableDocsBody.innerHTML = '';
                const apiBase = (window.API_BASE_URL || '/api').replace(/\/$/, '');

                docsAluno.forEach((doc) => {
                    const tr = document.createElement('tr');
                    const mimeType = doc.arquivo?.mimeType || '';
                    const isPdf = mimeType.includes('pdf') || (doc.arquivo?.nomeOriginal || '').toLowerCase().endsWith('.pdf');
                    const iconHtml = isPdf 
                        ? `<i class="bi bi-file-earmark-pdf-fill" style="font-size: 1.3rem; color: #ef4444;"></i>`
                        : `<i class="bi bi-file-earmark-image-fill" style="font-size: 1.3rem; color: #3b82f6;"></i>`;

                    const dataEnvioFormatada = doc.dataEnvio ? new Date(doc.dataEnvio).toLocaleString('pt-BR') : '-';
                    const dataAtualizacaoFormatada = doc.ultimaAtualizacao ? new Date(doc.ultimaAtualizacao).toLocaleString('pt-BR') : dataEnvioFormatada;
                    const docId = doc._id;
                    const nomeDocSafe = (doc.nomeDocumento || doc.tipoDocumento || 'Documento').replace(/'/g, "\\'");

                    let statusColor = '#94a3b8';
                    if (doc.status === 'Conferido') statusColor = '#10b981';
                    else if (doc.status === 'Em Análise') statusColor = '#fbbf24';
                    else if (doc.status === 'Enviado') statusColor = '#38bdf8';

                    tr.innerHTML = `
                        <td style="text-align: center;">${iconHtml}</td>
                        <td style="font-weight: 500; color: #fff;">${doc.nomeDocumento || doc.tipoDocumento}</td>
                        <td><span class="badge" style="background: rgba(59,130,246,0.12); color: #60a5fa; font-size: 0.72rem;">${doc.tipoDocumento}</span></td>
                        <td style="font-size: 0.8rem; color: #94a3b8;">${dataEnvioFormatada}</td>
                        <td style="font-size: 0.8rem; color: #94a3b8;">${dataAtualizacaoFormatada}</td>
                        <td>
                            <span class="badge" style="background: rgba(255,255,255,0.05); color: ${statusColor}; border: 1px solid ${statusColor}44; font-size: 0.72rem;">
                                ${doc.status}
                            </span>
                        </td>
                        <td style="text-align: right; white-space: nowrap;">
                            <button type="button" class="btn btn-outline btn-sm" onclick="abrirVisualizacaoDoc('${docId}', '${mimeType}', '${nomeDocSafe}')" style="padding: 3px 8px; font-size: 0.75rem;">
                                <i class="bi bi-eye"></i> Ver
                            </button>
                            <a href="${apiBase}/documentos-responsaveis/${docId}/download" class="btn btn-primary btn-sm" download style="padding: 3px 8px; font-size: 0.75rem;">
                                <i class="bi bi-download"></i> Baixar
                            </a>
                        </td>
                    `;
                    tableDocsBody.appendChild(tr);
                });
            }
        }
    } catch (e) {
        console.error('Erro ao carregar autorizações e documentos:', e);
        if (containerAut) containerAut.innerHTML = '<p style="color: #ef4444; font-size: 0.85rem;">Erro ao carregar autorizações.</p>';
    }
}
window.carregarAutorizacoesEDocumentos = carregarAutorizacoesEDocumentos;

window.abrirAlunoPeloId = async function(id) {
    try {
        ui.loading(true, 'Carregando ficha do aluno...');
        const aluno = await students.getById(id);
        ui.loading(false);
        if (aluno) {
            abrirModalEdicao(aluno);
            alternarAbaFicha('autorizacoes');
        } else {
            alert('Aluno não encontrado.');
        }
    } catch (e) {
        ui.loading(false);
        console.error('Erro ao abrir aluno:', e);
    }
};

function alternarVisaoGeral(visao) {
    const painelAlunos = document.getElementById('painelVisaoAlunos');
    const painelDocs = document.getElementById('painelVisaoDocumentos');
    const btnAlunos = document.getElementById('btnVisaoAlunos');
    const btnDocs = document.getElementById('btnVisaoDocumentos');
    const tituloHeader = document.getElementById('paginaTituloHeader');
    const subtituloHeader = document.getElementById('paginaSubtituloHeader');
    const btnCadastrar = document.getElementById('btnAcaoCadastrarAluno');

    if (visao === 'documentos') {
        if (painelAlunos) painelAlunos.classList.add('hidden');
        if (painelDocs) painelDocs.classList.remove('hidden');

        if (btnAlunos) {
            btnAlunos.classList.remove('btn-primary');
            btnAlunos.classList.add('btn-outline');
        }
        if (btnDocs) {
            btnDocs.classList.remove('btn-outline');
            btnDocs.classList.add('btn-primary');
        }

        if (tituloHeader) {
            tituloHeader.innerHTML = '<i class="bi bi-file-earmark-check-fill" style="color: #10b981;"></i> Autorizações dos Pais';
        }
        if (subtituloHeader) {
            subtituloHeader.textContent = 'Visualize todas as autorizações e documentos enviados pelos responsáveis.';
        }
        if (btnCadastrar) btnCadastrar.style.display = 'none';
        document.title = 'Autorizações dos Pais - Sistema Escolar';

        const url = new URL(window.location);
        url.searchParams.set('visao', 'documentos');
        window.history.replaceState({}, '', url);

        carregarTodosDocumentosAssinados();
    } else {
        if (painelDocs) painelDocs.classList.add('hidden');
        if (painelAlunos) painelAlunos.classList.remove('hidden');

        if (btnDocs) {
            btnDocs.classList.remove('btn-primary');
            btnDocs.classList.add('btn-outline');
        }
        if (btnAlunos) {
            btnAlunos.classList.remove('btn-outline');
            btnAlunos.classList.add('btn-primary');
        }

        if (tituloHeader) {
            tituloHeader.innerHTML = '<i class="bi bi-people-fill"></i> Todos os Alunos';
        }
        if (subtituloHeader) {
            subtituloHeader.textContent = 'Gerencie e visualize a lista completa de estudantes';
        }
        if (btnCadastrar) btnCadastrar.style.display = 'flex';
        document.title = 'Alunos - Sistema Escolar';

        const url = new URL(window.location);
        url.searchParams.delete('visao');
        window.history.replaceState({}, '', url);
    }
}
window.alternarVisaoGeral = alternarVisaoGeral;

function popularFiltroTurmasDocs() {
    const select = document.getElementById('filtroDocTurma');
    if (!select || select.children.length > 1) return;
    const turmas = db.getTurmas() || [];
    turmas.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.id || t._id;
        opt.textContent = `Turma ${t.id || t._id}`;
        select.appendChild(opt);
    });
}

async function carregarTodosDocumentosAssinados() {
    const tableBody = document.getElementById('tabelaDocsAssinadosBody');
    const emptyState = document.getElementById('emptyStateDocs');
    const contadorBadge = document.getElementById('badgeContadorDocs');

    if (tableBody) {
        tableBody.innerHTML = `
            <tr class="loading-row">
                <td colspan="10" class="text-center" style="padding: 2rem;">
                    <div class="spinner spinner-sm" style="margin: 0 auto 10px;"></div>
                    Carregando documentos assinados...
                </td>
            </tr>
        `;
    }

    try {
        const queryParams = new URLSearchParams();
        const busca = document.getElementById('searchDocAssinado')?.value?.trim();
        const turma = document.getElementById('filtroDocTurma')?.value;
        const tipo = document.getElementById('filtroDocTipo')?.value;
        const status = document.getElementById('filtroDocStatus')?.value;
        const dataInicio = document.getElementById('filtroDocDataInicio')?.value;
        const dataFim = document.getElementById('filtroDocDataFim')?.value;

        if (busca) queryParams.set('busca', busca);
        if (turma) queryParams.set('turmaId', turma);
        if (tipo) queryParams.set('tipoDocumento', tipo);
        if (status) queryParams.set('status', status);

        const res = await window.apiFetch('/documentos-responsaveis?' + queryParams.toString(), {
            method: 'GET'
        });

        if (!res || !res.success) {
            throw new Error(res?.error || 'Falha ao carregar documentos');
        }

        let docs = res.data || [];

        if (dataInicio) {
            const dtInicio = new Date(`${dataInicio}T00:00:00`);
            docs = docs.filter((d) => new Date(d.dataEnvio) >= dtInicio);
        }
        if (dataFim) {
            const dtFim = new Date(`${dataFim}T23:59:59`);
            docs = docs.filter((d) => new Date(d.dataEnvio) <= dtFim);
        }

        if (contadorBadge) {
            contadorBadge.textContent = docs.length;
        }

        popularFiltroTurmasDocs();

        if (tableBody) {
            tableBody.innerHTML = '';
        }

        if (docs.length === 0) {
            if (emptyState) emptyState.classList.remove('hidden');
            if (tableBody && tableBody.parentElement) {
                tableBody.parentElement.classList.add('hidden');
            }
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');
        if (tableBody && tableBody.parentElement) {
            tableBody.parentElement.classList.remove('hidden');
        }

        const apiBase = (window.API_BASE_URL || '/api').replace(/\/$/, '');

        docs.forEach((doc) => {
            const tr = document.createElement('tr');
            
            const mimeType = doc.arquivo?.mimeType || '';
            const isPdf = mimeType.includes('pdf') || (doc.arquivo?.nomeOriginal || '').toLowerCase().endsWith('.pdf');
            const iconHtml = isPdf 
                ? `<i class="bi bi-file-earmark-pdf-fill" style="font-size: 1.5rem; color: #ef4444;" title="Documento PDF"></i>`
                : `<i class="bi bi-file-earmark-image-fill" style="font-size: 1.5rem; color: #3b82f6;" title="Imagem Digitalizada"></i>`;

            const dataEnvioFormatada = doc.dataEnvio ? new Date(doc.dataEnvio).toLocaleString('pt-BR') : '-';
            const dataAtualizacaoFormatada = doc.ultimaAtualizacao ? new Date(doc.ultimaAtualizacao).toLocaleString('pt-BR') : dataEnvioFormatada;

            let statusColor = '#94a3b8';
            if (doc.status === 'Conferido') {
                statusColor = '#10b981';
            } else if (doc.status === 'Em Análise') {
                statusColor = '#fbbf24';
            } else if (doc.status === 'Enviado') {
                statusColor = '#38bdf8';
            }

            const alunoNome = doc.alunoId?.nome 
                ? `${doc.alunoId.nome} ${doc.alunoId.sobrenome || ''}`.trim()
                : (doc.alunoId || 'Aluno');

            const responsavelNome = doc.responsavelId?.nome || 'Responsável';
            const turmaNome = doc.turmaId || '-';
            const docId = doc._id;
            const nomeDocSafe = (doc.nomeDocumento || doc.tipoDocumento || 'Documento').replace(/'/g, "\\'");

            tr.innerHTML = `
                <td style="text-align: center; vertical-align: middle;">${iconHtml}</td>
                <td>
                    <div style="font-weight: 600; color: #fff;">${doc.nomeDocumento || doc.tipoDocumento}</div>
                    <small style="color: #64748b;">${doc.arquivo?.nomeOriginal || ''}</small>
                </td>
                <td><span class="badge" style="background: rgba(59,130,246,0.12); color: #60a5fa; font-size: 0.75rem;">${doc.tipoDocumento}</span></td>
                <td>
                    <a href="javascript:void(0)" onclick="abrirAlunoPeloId('${doc.alunoId?._id || doc.alunoId}')" style="color: #38bdf8; text-decoration: none; font-weight: 500;">
                        ${alunoNome}
                    </a>
                </td>
                <td style="color: #cbd5e1;">${responsavelNome}</td>
                <td><span class="badge badge-turma">${turmaNome}</span></td>
                <td style="font-size: 0.8rem; color: #94a3b8;">${dataEnvioFormatada}</td>
                <td style="font-size: 0.8rem; color: #94a3b8;">${dataAtualizacaoFormatada}</td>
                <td>
                    <select onchange="atualizarStatusDoc('${docId}', this.value)" style="background: rgba(15,23,42,0.8); border: 1px solid ${statusColor}; color: ${statusColor}; border-radius: 20px; font-size: 0.75rem; padding: 2px 8px; font-weight: 600; cursor: pointer;">
                        <option value="Enviado" ${doc.status === 'Enviado' ? 'selected' : ''}>Enviado</option>
                        <option value="Em Análise" ${doc.status === 'Em Análise' ? 'selected' : ''}>Em Análise</option>
                        <option value="Conferido" ${doc.status === 'Conferido' ? 'selected' : ''}>Conferido</option>
                    </select>
                </td>
                <td style="text-align: right; white-space: nowrap;">
                    <button type="button" class="btn btn-outline btn-sm" onclick="abrirVisualizacaoDoc('${docId}', '${mimeType}', '${nomeDocSafe}')" title="Visualizar documento">
                        <i class="bi bi-eye"></i> Visualizar
                    </button>
                    <a href="${apiBase}/documentos-responsaveis/${docId}/download" class="btn btn-ghost btn-sm" download title="Baixar arquivo">
                        <i class="bi bi-download"></i>
                    </a>
                </td>
            `;

            tableBody.appendChild(tr);
        });
    } catch (err) {
        console.error('Erro ao carregar documentos assinados:', err);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="10" class="text-center" style="padding: 2rem; color: #ef4444;">Erro ao carregar documentos: ${err.message}</td></tr>`;
        }
    }
}
window.carregarTodosDocumentosAssinados = carregarTodosDocumentosAssinados;

window.atualizarStatusDoc = async function(docId, novoStatus) {
    try {
        await window.apiFetch(`/documentos-responsaveis/${docId}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status: novoStatus })
        });
        if (window.utils && window.utils.showToast) {
            window.utils.showToast(`Status atualizado para: ${novoStatus}`, 'success');
        }
        carregarTodosDocumentosAssinados();
    } catch (e) {
        alert('Erro ao atualizar status: ' + e.message);
    }
};

window.limparFiltrosDocs = function() {
    const s = document.getElementById('searchDocAssinado');
    const t = document.getElementById('filtroDocTurma');
    const tp = document.getElementById('filtroDocTipo');
    const st = document.getElementById('filtroDocStatus');
    const di = document.getElementById('filtroDocDataInicio');
    const df = document.getElementById('filtroDocDataFim');

    if (s) s.value = '';
    if (t) t.value = '';
    if (tp) tp.value = '';
    if (st) st.value = '';
    if (di) di.value = '';
    if (df) df.value = '';

    carregarTodosDocumentosAssinados();
};

function abrirVisualizacaoDoc(docId, mimeType, nome) {
    const modal = document.getElementById('modalVisualizarDoc');
    const titulo = document.getElementById('previewDocTitulo');
    const downloadBtn = document.getElementById('previewDocDownloadBtn');
    const corpo = document.getElementById('previewDocCorpo');

    if (!modal || !corpo) return;

    const apiBase = (window.API_BASE_URL || '/api').replace(/\/$/, '');
    const previewUrl = `${apiBase}/documentos-responsaveis/${docId}/preview`;
    const downloadUrl = `${apiBase}/documentos-responsaveis/${docId}/download`;

    if (titulo) titulo.textContent = nome || 'Visualização de Documento';
    if (downloadBtn) downloadBtn.href = downloadUrl;

    const isPdf = (mimeType && mimeType.includes('pdf')) || (nome && nome.toLowerCase().endsWith('.pdf'));

    if (isPdf) {
        corpo.innerHTML = `
            <iframe src="${previewUrl}" style="width: 100%; height: 100%; border: none; border-radius: 8px;" title="${nome}"></iframe>
        `;
    } else {
        corpo.innerHTML = `
            <img src="${previewUrl}" alt="${nome}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 8px;" />
        `;
    }

    modal.style.display = 'flex';
    modal.classList.remove('hidden');
}
window.abrirVisualizacaoDoc = abrirVisualizacaoDoc;

function fecharModalVisualizar() {
    const modal = document.getElementById('modalVisualizarDoc');
    const corpo = document.getElementById('previewDocCorpo');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.add('hidden');
    }
    if (corpo) corpo.innerHTML = '';
}
window.fecharModalVisualizar = fecharModalVisualizar;

function setupRealtimeDocListeners() {
    function conectar() {
        const sock = window.socket || (window.realtime && window.realtime.getSocket ? window.realtime.getSocket() : null);
        if (sock) {
            sock.on('documento_responsavel:novo', (data) => {
                if (window.utils && window.utils.showToast) {
                    window.utils.showToast(`Novo documento assinado recebido: ${data.nomeDocumento || data.tipoDocumento}`, 'info');
                }
                const painelDocs = document.getElementById('painelVisaoDocumentos');
                if (painelDocs && !painelDocs.classList.contains('hidden')) {
                    carregarTodosDocumentosAssinados();
                }
                const currentEditId = document.getElementById('editAlunoId')?.value;
                if (currentEditId && currentEditId === data.alunoId) {
                    carregarAutorizacoesEDocumentos(currentEditId);
                }
            });

            sock.on('documento_responsavel:atualizado', (data) => {
                const painelDocs = document.getElementById('painelVisaoDocumentos');
                if (painelDocs && !painelDocs.classList.contains('hidden')) {
                    carregarTodosDocumentosAssinados();
                }
            });
        } else {
            setTimeout(conectar, 1200);
        }
    }
    conectar();
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

// ============================================================================
// BUSCA DE ALUNO — mesmas regras do servidor (backend/src/utils/buscaAluno.js)
// ============================================================================
// Esta tela filtra no navegador uma lista já baixada, então precisa repetir o
// critério que o backend aplica. Ter os dois lados divergindo é como a mesma
// busca acha o aluno em uma tela e jura que ele não existe na outra.

/** Minúsculo, sem acento, sem espaço duplo. */
function normalizarBusca(texto) {
    return String(texto == null ? '' : texto)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** Quebra o termo digitado em palavras normalizadas. */
function termosDeBusca(texto) {
    return normalizarBusca(texto).split(' ').filter(Boolean);
}

/** Forma canônica de uma sala: "1º A", "1ºA" e "1 A" viram todas "1A". */
function normalizarSala(sala) {
    return normalizarBusca(sala).replace(/[\u00ba\u00b0\u00aa._\-/\s]/g, '').toUpperCase();
}

/** As duas salas são a mesma, escritas de formas diferentes? */
function salasIguais(a, b) {
    const x = normalizarSala(a);
    const y = normalizarSala(b);
    return !!x && x === y;
}
