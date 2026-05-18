/**
 * Logica da ATA - Sistema Escolar (v3 Match Layout)
 * Layout exato conforme imagem "PLANILHA DO CONSELHO DE CLASSE"
 */


import db from './db.js';
// auth is global via window.auth (loaded via script tag)
import students from './students.js';
import ui from './ui.js';

let alunosCarregados = [];
let turmasCache = [];
let selectedStudentId = null;
let pdfGerado = null;
let pdfCarregado = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Inicializa serviços
    await db.init();
    await auth.init();
    ui.init();

    // Verify Auth
    if (!auth.isAuthenticated()) {
        window.location.href = 'index.html';
        return;
    }

    setupEventListeners();
    await loadTurmas();
});

// ... (setupEventListeners remains the same until loadTurmas)
function setupEventListeners() {
    document.getElementById('btnCarregarAlunos')?.addEventListener('click', carregarAlunosDaTurma);
    document.getElementById('btnSalvarAluno')?.addEventListener('click', saveCurrentStudent);
    document.getElementById('btnGerarPreview')?.addEventListener('click', renderPreview);
    document.getElementById('btnExportPDF')?.addEventListener('click', exportarPDF);

    // ATA Tabs
    const tabPrincipal = document.getElementById('tabSalaPrincipal');
    const tabEspeciais = document.getElementById('tabSalasEspeciais');
    const materiaContainer = document.getElementById('materiaContainer');

    tabPrincipal?.addEventListener('click', () => {
        console.log('🖱️ [ATA] Click em Sala Principal');
        tabPrincipal.classList.remove('btn-outline');
        tabPrincipal.classList.add('btn-primary');
        tabEspeciais.classList.remove('btn-primary');
        tabEspeciais.classList.add('btn-outline');
        materiaContainer.style.display = 'none';
        document.body.dataset.ataMode = 'principal';
        loadTurmas(); // Recarrega para mostrar apenas sala principal
    });

    tabEspeciais?.addEventListener('click', () => {
        console.log('🖱️ [ATA] Click em Salas Especiais');
        tabEspeciais.classList.remove('btn-outline');
        tabEspeciais.classList.add('btn-primary');
        tabPrincipal.classList.remove('btn-primary');
        tabPrincipal.classList.add('btn-outline');
        materiaContainer.style.display = 'block';
        document.body.dataset.ataMode = 'especiais';
        loadTurmas(); // Recarrega para mostrar apenas salas adicionais
    });

    document.getElementById('materiaSelect')?.addEventListener('change', () => {
        console.log('🖱️ [ATA] Matéria alterada');
        const turmaId = document.getElementById('turmaSelect').value;
        if (turmaId) {
            updateProfessorName(turmaId);
        }
    });

    // Initialize Default
    if (tabPrincipal) {
        document.body.dataset.ataMode = 'principal';
        tabPrincipal.classList.add('btn-primary');
    }

    // PDF Upload
    document.getElementById('pdfUpload')?.addEventListener('change', handlePDFUpload);

    // Convert menu toggle
    document.getElementById('btnConvertMenu')?.addEventListener('click', toggleConvertMenu);

    // Convert options
    document.querySelectorAll('.convert-option').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const format = e.currentTarget.dataset.format;
            handleConvert(format);
            closeConvertMenu();
        });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        const dropdown = document.querySelector('.convert-dropdown');
        if (dropdown && !dropdown.contains(e.target)) {
            closeConvertMenu();
        }
    });

    document.getElementById('condicaoAluno')?.addEventListener('change', (e) => {
        const otherBox = document.getElementById('condicaoOutroContainer');
        if (e.target.value === 'Outros') otherBox.style.display = 'block';
        else otherBox.style.display = 'none';
        renderPreview();
    });

    // Real-time Preview & Auto-save Updates
    const studentFields = ['checkRecupMat', 'checkRecupLP', 'nivelLeitura', 'faltasAluno', 'studentObs'];
    const globalFields = ['escolaNome', 'professorNome', 'anoLetivo', 'bimestreSelect'];

    studentFields.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
        el.addEventListener(eventType, () => {
            if (id === 'studentObs') autoGrow(el);
            renderPreview();
            scheduleAutoSave();
        });
    });

    globalFields.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const eventType = el.tagName === 'SELECT' ? 'change' : 'input';
        el.addEventListener(eventType, () => {
            renderPreview();
        });
    });
}

let autoSaveTimeout = null;
function scheduleAutoSave() {
    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        console.log('💾 [ATA] Iniciando salvamento automático...');
        saveCurrentStudent(true); // true = silent auto-save
    }, 1500); // 1.5 segundos de espera
}

function autoGrow(element) {
    element.style.height = "auto";
    element.style.height = (element.scrollHeight) + "px";
}

// ---------------------------------------------------------
// DB & LOADERS
// ---------------------------------------------------------

async function loadTurmas() {
    try {
        console.log('🔄 [ATA] loadTurmas: Iniciando carregamento...');
        const select = document.getElementById('turmaSelect');
        if (!select) return console.error('❌ [ATA] Elemento turmaSelect não encontrado!');

        select.innerHTML = '<option value="">Carregando...</option>';

        // Aguarda DB estar pronto se ainda não estiver
        if (!db.initialized) {
            console.log('⏳ [ATA] Aguardando inicialização do DB...');
            await db.init();
        }

        let allTurmas = db.getTurmas();
        console.log('📊 [ATA] Turmas totais do banco:', allTurmas.length);

        // Se db.getTurmas() estiver vazio, tenta forçar um reload das configs
        if (!allTurmas || allTurmas.length === 0) {
            console.log('⚠️ db.getTurmas() vazio. Tentando recarregar configs...');
            await db.loadInitialData(); // Re-fetch data/turmas.json
            allTurmas = db.getTurmas();
        }

        console.log('📊 Turmas disponíveis no sistema:', allTurmas);

        // Determina quem é o usuário
        const user = auth.getCurrentUser();
        // Log de depuração removido

        if (!user) {
            console.error('❌ Usuário não autenticado em loadTurmas');
            return;
        }

        let myTurmasIds = [];
        let me = null;

        // Helper para normalizar (remove 'º', espaços e põe uppercase)
        const normalize = (str) => str ? str.replace(/[^a-zA-Z0-9]/g, '').toUpperCase() : '';

        if (user.perfil === 'professor') {
            const professores = await db.getAll('professores');
            const uEmail = String(user.email || '').toLowerCase();
            const uId = String(user.id || user._id || '').toLowerCase();

            me = professores.find(p => {
                const pEmail = String(p.email || '').toLowerCase();
                const pIdUser = String(p.idUsuario || p.userId || p.usuarioId || '').toLowerCase();
                return (pEmail === uEmail && uEmail !== '') || (pIdUser === uId && uId !== '');
            });

            console.log('👨‍🏫 Professor logado identificado:', me);

            if (me) {
                // Sala Principal
                if (me.salaPrincipal && me.salaPrincipal.toUpperCase() !== 'VARIADOS') {
                    myTurmasIds.push(me.salaPrincipal);
                }
                // Salas Adicionais
                if (me.salasAdicionais && me.salasAdicionais.length > 0) {
                    me.salasAdicionais.forEach(s => myTurmasIds.push(s));
                }
            } else {
                console.warn('⚠️ Professor logado mas não encontrado na coleção "professores"');
            }
        }

        if (user.perfil === 'admin' || user.perfil === 'diretor') {
            // Admin vê todas
            myTurmasIds = allTurmas.map(t => t.id);
            console.log('🛡️ Perfil Admin/Diretor: Acesso a todas as turmas');
        }

        console.log('🎯 Turmas do usuário (IDs crus):', myTurmasIds);

        // Filtra lista final usando normalização robusta e ALÉM DISSO por ATA MODE
        const ataMode = document.body.dataset.ataMode || 'principal';

        const turmasFiltradas = allTurmas.filter(t => {
            if (user.perfil === 'admin' || user.perfil === 'diretor') return true;

            const tIdNorm = normalize(t.id);
            const isMatch = myTurmasIds.some(myId => normalize(myId) === tIdNorm);

            if (!isMatch) return false;

            // Se for Professor, aplica filtro de modo (Principal ou Especial)
            if (user.perfil === 'professor' && me) {
                if (ataMode === 'principal') {
                    // Apenas sala principal
                    return normalize(me.salaPrincipal) === tIdNorm;
                } else {
                    // Apenas salas adicionais
                    return me.salasAdicionais && me.salasAdicionais.some(s => normalize(s) === tIdNorm);
                }
            }
            return true;
        });

        console.log(`✅ [ATA] Turmas filtradas (${ataMode}):`, turmasFiltradas);

        // Ordena turmas alfabeticamente (1A, 1B, 2A...)
        turmasFiltradas.sort((a, b) => {
            const idA = String(a.id || a._id || '');
            const idB = String(b.id || b._id || '');
            return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
        });

        // Renderiza
        select.innerHTML = '<option value="">Selecione...</option>';
        if (turmasFiltradas.length === 0) {
            console.warn('⚠️ [ATA] Nenhuma turma encontrada após filtro para o usuário:', user.email);
            const opt = document.createElement('option');
            opt.disabled = true;
            opt.textContent = "Nenhuma turma disponível neste modo.";
            select.appendChild(opt);
            return;
        }

        turmasFiltradas.forEach(turma => {
            const idTurma = turma.id || turma._id;
            const opt = document.createElement('option');
            opt.value = idTurma;
            
            // Melhora exibição: se for algo como 1A, vira 1ºA
            let displayId = idTurma;
            if (/^\d[A-Z]$/.test(displayId)) {
                displayId = displayId.charAt(0) + 'º' + displayId.charAt(1);
            }
            
            opt.textContent = `Turma ${displayId}`;
            select.appendChild(opt);
        });

        turmasCache = turmasFiltradas;

        // Auto-seleciona se houver apenas uma
        if (turmasFiltradas.length === 1) {
            select.value = turmasFiltradas[0].id;
            updateProfessorName(select.value);
        }

        // Listener para atualizar nome do professor ao trocar turma
        select.removeEventListener('change', handleTurmaChange);
        select.addEventListener('change', handleTurmaChange);

    } catch (e) {
        console.error("❌ Erro fatal em loadTurmas:", e);
        document.getElementById('turmaSelect').innerHTML = '<option value="">Erro ao carregar</option>';
    }
}

function handleTurmaChange(e) {
    if (e.target.value) {
        updateProfessorName(e.target.value);
    }
}

async function updateProfessorName(turmaId) {
    if (!turmaId) return;
    try {
        const professores = await db.getAll('professores');
        const ataMode = document.body.dataset.ataMode || 'principal';
        let nomeProfessor = '';

        if (ataMode === 'principal') {
            const regente = professores.find(p => p.salaPrincipal && p.salaPrincipal.replace('º', '') === turmaId.replace('º', ''));
            if (regente) nomeProfessor = regente.nome;
        } else {
            const materia = document.getElementById('materiaSelect').value;
            const especial = professores.find(p =>
                p.salasAdicionais &&
                p.salasAdicionais.some(s => s.replace('º', '') === turmaId.replace('º', '')) &&
                p.materias && p.materias.includes(materia)
            );
            if (especial) nomeProfessor = especial.nome;
        }

        const input = document.getElementById('professorNome');
        if (input) input.value = nomeProfessor || '';
    } catch (e) {
        console.error('Erro ao atualizar nome do professor:', e);
    }
}

async function carregarAlunosDaTurma() {
    const turmaId = document.getElementById('turmaSelect').value;
    const bimestre = document.getElementById('bimestreSelect').value;
    if (!turmaId) return alert("Selecione uma turma");

    try {
        const btn = document.getElementById('btnCarregarAlunos');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Carregando...';
        btn.disabled = true;

        // --- TENTATIVA DE BUSCA ROBUSTA (Normalização) ---
        // Tentamos várias combinações para garantir que achamos os alunos
        const normalize = (s) => String(s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const targetNorm = normalize(turmaId);
        
        // 1. Busca direta (ex: 1A ou 1ºC)
        let alunosDB = await students.getByTurma(turmaId);
        
        // 2. Se não achou, tenta com/sem º (ex: 1A -> 1ºA ou 1ºA -> 1A)
        if (alunosDB.length === 0) {
            const retryId = turmaId.includes('º') ? turmaId.replace('º', '') : (turmaId.length === 2 ? turmaId[0] + 'º' + turmaId[1] : turmaId);
            if (retryId !== turmaId) {
                console.log(`🔍 [ATA] Tentando variação: ${retryId}`);
                alunosDB = await students.getByTurma(retryId);
            }
        }
        
        // 3. Se ainda não achou, busca TODOS e filtra manualmente (mais lento, mas garantido)
        if (alunosDB.length === 0) {
            console.log('⚠️ [ATA] Busca direta falhou. Filtrando todos os alunos...');
            const todos = await students.getAll();
            alunosDB = todos.filter(a => normalize(a.turmaId || a.turma) === targetNorm);
        }

        if (alunosDB.length === 0) {
            alert(`Nenhum aluno encontrado na turma "${turmaId}".\n\nVerifique se os alunos foram cadastrados com o nome exato desta turma.`);
            btn.innerHTML = originalText;
            btn.disabled = false;
            return;
        }

        alunosCarregados = alunosDB.sort((a, b) => a.nome.localeCompare(b.nome)).map(a => {
            const bimNum = parseInt(bimestre) || 1;

            // Safe access helpers for nested objects
            const getObj = (obj, key) => (obj && obj[key]) ? obj[key] : null;

            let obs = getObj(a.observacoesBimestre, bimNum) || '';
            let niv = getObj(a.nivelBimestre, bimNum) || 'Não avaliado';
            if (niv === 'Nenhum') niv = 'Não avaliado';

            let recObj = getObj(a.recuperacaoBimestre, bimNum) || { lp: false, mat: false };

            return {
                ...a,
                recupMat: recObj.mat,
                recupLP: recObj.lp,
                nivel: niv,
                // Ensure condicao is populated (legacy fallback)
                condicao: a.condicao || a.deficiencia || '',
                condicaoOutro: a.condicaoOutro || '',
                faltas: getObj(a.faltasBimestre, bimNum) || '',
                observacoes: obs
            };
        });

        renderStudentList();
        document.getElementById('workspaceContainer').classList.remove('hidden');
        document.getElementById('countAlunos').innerText = alunosCarregados.length;

        // Auto-fill Professor Name
        const user = auth.getCurrentUser();
        // Se for o próprio professor, preenche. Se admin, tenta achar o regente da turma.
        const professores = await db.getAll('professores');

        // Find professor logic:
        // Se modo = Principal, busca Regente desta turma
        // Se modo = Especial, busca quem dá a aula Especial selecionada nesta turma

        const ataMode = document.body.dataset.ataMode || 'principal';
        let nomeProfessor = '';

        if (ataMode === 'principal') {
            // Tenta achar Regente
            const regente = professores.find(p => p.salaPrincipal && p.salaPrincipal.replace('º', '') === turmaId.replace('º', ''));
            if (regente) nomeProfessor = regente.nome;
            else if (user.perfil === 'professor') nomeProfessor = user.nome; // Fallback to current user
        } else {
            const materia = document.getElementById('materiaSelect').value;
            // Busca professor especial desta materia que tem esta sala adicional
            const especial = professores.find(p =>
                p.salasAdicionais &&
                p.salasAdicionais.some(s => s.replace('º', '') === turmaId.replace('º', '')) &&
                p.materias && p.materias.includes(materia)
            );
            if (especial) nomeProfessor = especial.nome;
            else if (user.perfil === 'professor') nomeProfessor = user.nome;
        }

        document.getElementById('professorNome').value = nomeProfessor || '';

        renderPreview();

        btn.innerHTML = originalText;
        btn.disabled = false;

    } catch (e) {
        console.error("Detalhes do erro:", e);
        alert("Erro ao buscar alunos: " + (e.message || e));
        document.getElementById('btnCarregarAlunos').disabled = false;
        document.getElementById('btnCarregarAlunos').innerHTML = '<i class="bi bi-arrow-clockwise"></i> Carregar Alunos';
    }
}


// ---------------------------------------------------------
// UI ACTIONS
// ---------------------------------------------------------

function renderStudentList() {
    const container = document.getElementById('alunosList');
    container.innerHTML = '';
    alunosCarregados.forEach(aluno => {
        const div = document.createElement('div');
        div.className = `student-list-item ${selectedStudentId === aluno.id ? 'active' : ''}`;
        div.onclick = () => selectStudent(aluno.id);
        const hasInfo = aluno.recupMat || aluno.recupLP || (aluno.observacoes && aluno.observacoes.length > 2);
        div.innerHTML = `
            <div class="student-avatar">${aluno.foto ? `<img src="${aluno.foto}">` : '👤'}</div>
            <div class="student-name">${aluno.nome} ${hasInfo ? '●' : ''}</div>
        `;
        container.appendChild(div);
    });
}

function selectStudent(id) {
    selectedStudentId = id;
    renderStudentList();
    const aluno = alunosCarregados.find(a => a.id === id);
    if (!aluno) return;

    document.getElementById('studentFormOverlay').classList.remove('active');
    document.getElementById('editorAlunoName').innerText = aluno.nome;

    document.getElementById('checkRecupMat').checked = aluno.recupMat;
    document.getElementById('checkRecupLP').checked = aluno.recupLP;
    document.getElementById('nivelLeitura').value = aluno.nivel || 'Nenhum';
    document.getElementById('faltasAluno').value = aluno.faltas || '';
    const obsEl = document.getElementById('studentObs');
    obsEl.value = aluno.observacoes || '';
    autoGrow(obsEl);

    const condSelect = document.getElementById('condicaoAluno');
    condSelect.value = (aluno.condicao && !['TDAH', 'TOD', 'Autismo'].includes(aluno.condicao)) ? 'Outros' : aluno.condicao;
    if (condSelect.value === 'Outros') promptCondition(true, aluno.condicaoOutro || aluno.condicao);
    else promptCondition(false);
}

function promptCondition(show, val = '') {
    const box = document.getElementById('condicaoOutroContainer');
    box.style.display = show ? 'block' : 'none';
    if (show) document.getElementById('condicaoOutro').value = val;
}

async function saveCurrentStudent(isAuto = false) {
    if (!selectedStudentId) return;

    // CONFIRMAÇÍO OBRIGATÓRIA apenas se NÍO for auto-save
    if (!isAuto) {
        const confirmed = confirm(
            "Esta ação irá alterar a descrição do aluno tanto na ATA quanto no cadastro geral do aluno.\n" +
            "Deseja realmente continuar?"
        );
        if (!confirmed) return;
    }

    const idx = alunosCarregados.findIndex(a => a.id === selectedStudentId);
    if (idx === -1) return;

    // Atualiza objeto local (Interface)
    alunosCarregados[idx].recupMat = document.getElementById('checkRecupMat').checked;
    alunosCarregados[idx].recupLP = document.getElementById('checkRecupLP').checked;
    alunosCarregados[idx].nivel = document.getElementById('nivelLeitura').value;

    const cond = document.getElementById('condicaoAluno').value;
    const condOutro = document.getElementById('condicaoOutro').value;
    // Lógica 'Outros'
    const finalCondicao = (cond === 'Outros') ? condOutro : cond;

    alunosCarregados[idx].condicao = finalCondicao;
    alunosCarregados[idx].condicaoOutro = condOutro;
    alunosCarregados[idx].faltas = document.getElementById('faltasAluno').value;
    alunosCarregados[idx].observacoes = document.getElementById('studentObs').value;

    // Atualiza DB Global (Persistência) via Students Service
    try {
        const btn = document.getElementById('btnSalvarAluno');
        const oldText = btn.innerText;

        if (!isAuto) {
            btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando...';
            btn.disabled = true;
        } else {
            // Visual feedback discreto para auto-save (opcional)
            btn.innerHTML = '<i class="bi bi-cloud-upload"></i> Salvando...';
        }

        const alunoOriginal = await students.getById(selectedStudentId);

        if (alunoOriginal) {
            const bimestre = document.getElementById('bimestreSelect').value;
            const bimNum = parseInt(bimestre) || 1;

            if (!alunoOriginal.observacoesBimestre) alunoOriginal.observacoesBimestre = {};
            if (!alunoOriginal.nivelBimestre) alunoOriginal.nivelBimestre = {};
            if (!alunoOriginal.recuperacaoBimestre) alunoOriginal.recuperacaoBimestre = {};
            if (!alunoOriginal.faltasBimestre) alunoOriginal.faltasBimestre = {};

            alunoOriginal.observacoesBimestre[bimNum] = alunosCarregados[idx].observacoes;
            alunoOriginal.nivelBimestre[bimNum] = (alunosCarregados[idx].nivel === 'Não avaliado') ? 'Nenhum' : alunosCarregados[idx].nivel;
            alunoOriginal.recuperacaoBimestre[bimNum] = {
                lp: alunosCarregados[idx].recupLP,
                mat: alunosCarregados[idx].recupMat
            };
            alunoOriginal.faltasBimestre[bimNum] = alunosCarregados[idx].faltas;

            alunoOriginal.condicao = finalCondicao;
            alunoOriginal.condicaoOutro = condOutro;
            // Legacy sync
            alunoOriginal.deficiencia = finalCondicao;

            // Salva usando serviço
            await students.update(alunoOriginal);

            console.log('Aluno atualizado no DB global com sucesso.');

            if (!isAuto) {
                btn.innerHTML = "Salvo!";
                setTimeout(() => {
                    btn.innerText = oldText;
                    btn.disabled = false;
                }, 800);
            } else {
                btn.innerHTML = '<i class="bi bi-cloud-check"></i> Alterações Salvas';
                setTimeout(() => {
                    btn.innerText = oldText;
                }, 2000);
            }

            renderStudentList();
            renderPreview();
        }

    } catch (e) {
        console.error('❌ [ATA] Erro crítico ao salvar persistência do aluno:', e);
        if (e.response) {
            console.error('Response data:', await e.response.text());
        }
        alert('Erro ao salvar dados no sistema: ' + (e.message || 'Tente novamente.'));
        document.getElementById('btnSalvarAluno').disabled = false;
        document.getElementById('btnSalvarAluno').innerHTML = '<i class="bi bi-check-circle-fill"></i> Tentar Novamente';
    }
}

// ---------------------------------------------------------
// FORMATTERS (Matches Image Layout)
// ---------------------------------------------------------
function getRecuperacaoHTML(aluno) {
    const matText = aluno.recupMat ? "Sim" : "Não";
    const lpText = aluno.recupLP ? "Sim" : "Não";

    const niv = (aluno.nivel === 'Nenhum' || !aluno.nivel) ? 'Não avaliado' : aluno.nivel;
    let circleClass = '';
    let colorHex = '';
    if (niv === 'PS' || niv === '1') { circleClass = 'level-red'; colorHex = '#ff4d4d'; }
    else if (niv === 'SSV') { circleClass = 'level-orange'; colorHex = '#ff9900'; }
    else if (niv === 'SCV' || niv === '2') { circleClass = 'level-yellow'; colorHex = '#ffcc00'; }
    else if (niv === 'SA' || niv === '3') { circleClass = 'level-blue'; colorHex = '#3399ff'; }
    else if (niv === 'A' || niv === '4') { circleClass = 'level-green'; colorHex = '#2eb82e'; }

    const nivelHTML = circleClass 
        ? `<span style="border: 2px solid #000; padding: 2px 6px; border-radius: 4px; display:inline-flex; align-items:center; gap: 6px;"><span class="level-circle ${circleClass}" style="width:14px; height:14px; display:inline-block; border-radius:50%; background-color:${colorHex}; margin:0;"></span><span style="font-weight:bold; color:${colorHex};">${niv}</span></span>` 
        : niv;
    const condText = (aluno.condicao && aluno.condicao !== '') ? aluno.condicao : 'Nenhuma';
    const faltasText = (aluno.faltas !== '' && aluno.faltas !== null && aluno.faltas !== undefined && parseInt(aluno.faltas) > 0) ? `<br><strong>Faltas:</strong> ${aluno.faltas}` : '';

    return `
        <div style="line-height:1.6; font-size: 11pt;">
            <div class="level-badge-container">
                <strong>Nível:</strong> ${nivelHTML}
            </div>
            <strong>L.P.:</strong> ${lpText}<br>
            <strong>Mat.:</strong> ${matText}<br>
            <strong>Condição:</strong> ${condText}${faltasText}
        </div>
    `;
}

// ---------------------------------------------------------
// PREVIEW
// ---------------------------------------------------------

function renderPreview() {
    const container = document.getElementById('documentPreview');
    const escola = document.getElementById('escolaNome').value;
    const professor = document.getElementById('professorNome').value;
    const turma = document.getElementById('turmaSelect').value;
    const bimestre = document.getElementById('bimestreSelect').value;
    const ano = document.getElementById('anoLetivo').value;

    let rows = '';
    alunosCarregados.forEach(aluno => {
        const obs = aluno.observacoes || '';
        rows += `
            <tr>
                <td style="width: 25%; vertical-align: middle; padding: 10px;">
                    <div style="display:flex; align-items:center; gap: 10px;">
                        ${aluno.foto ? `<img src="${aluno.foto}" style="width:60px; height:70px; object-fit:cover; border:1px solid #000;">` : ''}
                        <strong>${aluno.nome}</strong>
                    </div>
                </td>
                <td style="width: 35%; vertical-align: top; padding: 10px;">
                    ${getRecuperacaoHTML(aluno)}
                </td>
                <td style="width: 40%; vertical-align: top; padding: 10px; word-break: break-word; overflow-wrap: break-word;">
                    ${obs.replace(/\n/g, '<br>')}
                </td>
            </tr>
        `;
    });

    container.innerHTML = `
        <div style="border: 2px solid #000; padding: 15px; font-family: 'Arial', sans-serif;">
            <div style="text-align:center; margin-bottom: 20px;">
                <h3 style="margin:0 0 5px 0; font-size: 11pt; font-weight:bold; text-decoration: underline;">
                    SECRETARIA DE EDUCAÇÍO DE AMERICANA – MAPEAMENTO DA ESCOLA – ${bimestre.toUpperCase()} - ${ano}
                </h3>
                <h2 style="margin:0; font-size: 14pt; font-weight:bold;">PLANILHA DO CONSELHO DE CLASSE</h2>
            </div>
            
            <div style="margin-bottom: 20px; font-size: 11pt; border-bottom: 2px solid #000; padding-bottom: 10px;">
                <p style="margin: 5px 0;"><strong>Escola:</strong> ${escola}</p>
                <p style="margin: 5px 0;"><strong>Professor(a):</strong> ${professor}</p>
                <p style="margin: 5px 0;"><strong>Ano/Turma:</strong> ${turma}</p>
            </div>

            <table style="width:100%; border-collapse: collapse; border: 2px solid #000; table-layout: fixed;">
                <thead>
                    <tr style="background: #fff;">
                        <th style="border: 1px solid #000; padding: 10px; text-align:center;">FOTO / NOME DO/A ALUNO(A)</th>
                        <th style="border: 1px solid #000; padding: 10px; text-align:center;">RECUPERAÇÍO/ESTUDO DIRIGIDO/ENCAMINHAMENTOS / NÍVEL DE LEITURA E ESCRITA</th>
                        <th style="border: 1px solid #000; padding: 10px; text-align:center;">PEQUENO RELATÓRIO SOBRE O ALUNO / OBSERVAÇÕES</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

// ---------------------------------------------------------
// EXPORT PDF (Manual Draw for Exact Layout)
// ---------------------------------------------------------

async function exportarPDF() {
    try {
        console.log('🚀 Iniciando exportação de PDF...');

        // Detecta o construtor do jsPDF de forma exaustiva
        let jsPDFConstructor = null;

        if (typeof window.jspdf !== 'undefined') {
            jsPDFConstructor = window.jspdf.jsPDF || window.jspdf;
        } else if (typeof window.jsPDF !== 'undefined') {
            jsPDFConstructor = window.jsPDF;
        }

        console.log('🔍 Busca jsPDF:', {
            'window.jspdf': typeof window.jspdf,
            'window.jsPDF': typeof window.jsPDF,
            'constructorFound': !!jsPDFConstructor
        });

        if (!jsPDFConstructor) {
            console.error('❌ Erro: Biblioteca jsPDF não encontrada no ambiente window.');
            alert('Erro: A ferramenta de geração de PDF não carregou corretamente.\n\nPor favor, tente recarregar a página (F5) ou verifique sua conexão.');
            return;
        }

        if (!alunosCarregados || alunosCarregados.length === 0) {
            const confirmVazio = confirm('A lista de alunos está vazia. Deseja baixar a ATA apenas com o cabeçalho?');
            if (!confirmVazio) return;
        }

        const doc = new jsPDFConstructor('p', 'mm', 'a4');
        console.log('✅ Documento jsPDF criado');

        // Config
        const margin = 10;
        const pageWidth = 210;
        const pageHeight = 297;
        const contentWidth = pageWidth - (margin * 2);

        // Data
        const escola = document.getElementById('escolaNome')?.value || 'Não informada';
        const professor = document.getElementById('professorNome')?.value || 'Não informado';
        const turma = document.getElementById('turmaSelect')?.value || 'Não selecionada';
        const ano = document.getElementById('anoLetivo')?.value || new Date().getFullYear();
        const bimestreVal = document.getElementById('bimestreSelect')?.value || '1';
        const bimestre = bimestreVal.toUpperCase();

        // Helper: Draw box header (Only for first page)
        function drawFullHeader() {
            doc.setLineWidth(0.5);
            doc.rect(margin, margin, contentWidth, 35); // Main Box Header (slightly shorter)

            doc.setFont("helvetica", "bold");
            doc.setFontSize(10);
            const subtitle = `SECRETARIA DE EDUCAÇÍO DE AMERICANA – MAPEAMENTO DA ESCOLA – ${bimestre} - ${ano}`;
            doc.text(subtitle, pageWidth / 2, margin + 7, { align: "center" });
            const textWidth = doc.getTextWidth(subtitle);
            doc.line((pageWidth / 2) - (textWidth / 2), margin + 8, (pageWidth / 2) + (textWidth / 2), margin + 8);

            doc.setFontSize(12);
            doc.text("PLANILHA DO CONSELHO DE CLASSE", pageWidth / 2, margin + 14, { align: "center" });

            doc.line(margin + 5, margin + 18, pageWidth - margin - 5, margin + 18); // Divider line

            // Info - Better positioning
            doc.setFontSize(10);
            doc.setFont("helvetica", "bold");
            doc.text(`Escola:`, margin + 3, margin + 23);
            doc.setFont("helvetica", "normal");
            doc.text(escola, margin + 18, margin + 23);

            doc.setFont("helvetica", "bold");
            doc.text(`Professor(a):`, margin + 3, margin + 28);
            doc.setFont("helvetica", "normal");
            doc.text(professor, margin + 28, margin + 28);

            doc.setFont("helvetica", "bold");
            doc.text(`Ano/Turma:`, margin + 3, margin + 33);
            doc.setFont("helvetica", "normal");
            doc.text(turma, margin + 25, margin + 33);
        }

        // Helper: Draw Table Headers (For every page)
        function drawTableHeaders(startY) {
            doc.setLineWidth(0.5);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8);

            const headerHeight = 16;
            
            // Draw Rectangles
            doc.rect(x1, startY, w1, headerHeight);
            doc.rect(x2, startY, w2, headerHeight);
            doc.rect(x3, startY, w3, headerHeight);

            // Draw Text
            doc.text("FOTO / NOME DO/A", x1 + w1 / 2, startY + 5, { align: "center" });
            doc.text("ALUNO(A)", x1 + w1 / 2, startY + 9, { align: "center" });
            
            doc.text("RECUPERAÇÍO/ESTUDO", x2 + w2 / 2, startY + 5, { align: "center" });
            doc.text("DIRIGIDO/ENCAMINHAMENTOS /", x2 + w2 / 2, startY + 9, { align: "center" });
            doc.text("NÍVEL DE LEITURA E ESCRITA", x2 + w2 / 2, startY + 13, { align: "center" });
            
            doc.text("PEQUENO RELATÓRIO SOBRE O ALUNO /", x3 + w3 / 2, startY + 5, { align: "center" });
            doc.text("OBSERVAÇÕES", x3 + w3 / 2, startY + 9, { align: "center" });

            return headerHeight;
        }

        // Columns X positions (Must be outside helpers to be accessible)
        const x1 = margin;
        const w1 = 50; // Foto/Nome
        const x2 = x1 + w1;
        const w2 = 60; // Recup
        const x3 = x2 + w2;
        const w3 = contentWidth - w1 - w2; // Obs (Remaining)

        drawFullHeader();

        let y = margin + 40; // Start of Table on first page
        y += drawTableHeaders(y);
        doc.setFont("helvetica", "normal");

        if (alunosCarregados && alunosCarregados.length > 0) {
            alunosCarregados.forEach(aluno => {
                doc.setFontSize(9);
                const obsLines = doc.splitTextToSize(aluno.observacoes || '', w3 - 6);
                const nameLines = doc.splitTextToSize(aluno.nome, w1 - 25);
                
                const lp = aluno.recupLP ? "Sim" : "Não";
                const mat = aluno.recupMat ? "Sim" : "Não";
                const cond = (aluno.condicao && aluno.condicao !== '') ? aluno.condicao : 'Nenhuma';
                const fts = (aluno.faltas !== '' && parseInt(aluno.faltas) > 0) ? `Faltas: ${aluno.faltas}` : '';
                const niv = (aluno.nivel === 'Nenhum' || !aluno.nivel) ? 'Não avaliado' : aluno.nivel;

                const condLines = doc.splitTextToSize(`Cond.: ${cond}`, w2 - 6);
                const ftsLines = fts ? doc.splitTextToSize(fts, w2 - 6) : [];

                // Cálculo de altura dinâmica considerando todas as colunas
                // Foto (aprox 25mm) + Nome (linhas * 4) + padding
                const hNome = 30 + (nameLines.length * 4);
                const hMeio = (3 + condLines.length + ftsLines.length) * 5 + 10;
                const hObs = (obsLines.length * 5) + 10;
                
                let rowHeight = Math.max(35, hNome, hMeio, hObs);

                if (y + rowHeight > pageHeight - margin) {
                    doc.addPage();
                    y = margin; // Start directly at top margin on subsequent pages
                    y += drawTableHeaders(y);
                }

                doc.rect(x1, y, w1, rowHeight);
                doc.rect(x2, y, w2, rowHeight);
                doc.rect(x3, y, w3, rowHeight);

                if (aluno.foto) {
                    try {
                        // Foto centralizada (20x24mm)
                        doc.addImage(aluno.foto, 'JPEG', x1 + (w1 / 2 - 10), y + 3, 20, 24);
                    } catch (e) { console.warn('Erro ao carregar foto do aluno:', aluno.nome); }
                }

                doc.setFont("helvetica", "bold");
                doc.setFontSize(8);
                // Nome centralizado ABAIXO da foto
                doc.text(nameLines, x1 + (w1 / 2), y + 31, { align: "center" });

                doc.setFont("helvetica", "normal");
                doc.setFontSize(9);
                // Nível com cor (Agora primeiro)
                let circleColor = null; // [R, G, B]
                if (niv === 'PS' || niv === '1') circleColor = [255, 77, 77];
                else if (niv === 'SSV') circleColor = [255, 153, 0];
                else if (niv === 'SCV' || niv === '2') circleColor = [255, 204, 0];
                else if (niv === 'SA' || niv === '3') circleColor = [51, 153, 255];
                else if (niv === 'A' || niv === '4') circleColor = [46, 184, 46];

                if (circleColor) {
                    doc.text(`Nível: `, x2 + 2, y + 6);
                    
                    doc.setFillColor(circleColor[0], circleColor[1], circleColor[2]);
                    doc.setDrawColor(0, 0, 0); // Moldura preta
                    doc.setLineWidth(0.4);
                    
                    const textStr = `${niv}`;
                    doc.setFont("helvetica", "bold");
                    const tWidth = doc.getTextWidth(textStr);
                    const rectW = tWidth + 8; // padding
                    
                    doc.roundedRect(x2 + 12, y + 2, rectW, 6, 1, 1, 'D'); // Border
                    doc.circle(x2 + 15, y + 5, 1.8, 'F'); // Circle
                    
                    doc.setTextColor(circleColor[0], circleColor[1], circleColor[2]);
                    doc.text(textStr, x2 + 18, y + 6); // Text
                    
                    // Reset
                    doc.setTextColor(0, 0, 0);
                    doc.setDrawColor(0, 0, 0);
                    doc.setLineWidth(0.5);
                    doc.setFont("helvetica", "normal");
                } else {
                    doc.text(`Nível: ${niv}`, x2 + 2, y + 6);
                }

                doc.text(`L.P.: ${lp}`, x2 + 2, y + 11);
                doc.text(`Mat.: ${mat}`, x2 + 2, y + 16);
                
                // Renderiza Condição e Faltas (podem ter múltiplas linhas)
                doc.text(condLines, x2 + 2, y + 21);
                
                if (ftsLines.length > 0) {
                    const yFts = y + 21 + (condLines.length * 5);
                    doc.text(ftsLines, x2 + 2, yFts);
                }

                doc.text(obsLines, x3 + 2, y + 6);

                y += rowHeight;
            });
        }

        pdfGerado = doc;
        doc.save(`ATA_${turma}_${bimestre}.pdf`);
        console.log('✅ PDF gerado e salvo com sucesso!');

    } catch (error) {
        alert('Ocorreu um erro ao gerar o PDF: ' + error.message);
    }
}

// ---------------------------------------------------------
// CONVERT MENU FUNCTIONS
// ---------------------------------------------------------

function toggleConvertMenu() {
    const menu = document.getElementById('convertMenu');
    if (menu.style.display === 'none') {
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
}

function closeConvertMenu() {
    const menu = document.getElementById('convertMenu');
    menu.style.display = 'none';
}

async function handleConvert(format) {
    if (!pdfCarregado && (!alunosCarregados || alunosCarregados.length === 0)) {
        alert('Carregue um PDF ou gere a ATA primeiro!');
        return;
    }

    if (format === 'jpeg') {
        await convertToJPEG();
    } else if (format === 'docx') {
        // DOCX editável só funciona com PDF gerado (precisa dos dados estruturados)
        if (pdfCarregado && (!alunosCarregados || alunosCarregados.length === 0)) {
            alert('⚠️ DOCX editável não disponível para PDFs carregados.\n\n' +
                'Para ter DOCX editável:\n' +
                '1. Carregue os alunos da turma\n' +
                '2. Clique em "Baixar PDF"\n' +
                '3. Use "Converter PDF" → "Converter para DOCX"\n\n' +
                '💡 O DOCX será editável com tabelas e textos!\n' +
                '📸 Para PDF carregado, use "Converter para JPEG"');
            return;
        }
        await convertToDOCX();
    }
}

// ---------------------------------------------------------
// CONVERT PDF TO DOCX VIA API (para PDFs carregados)
// ---------------------------------------------------------

async function convertPDFtoDOCXviaAPI() {
    const turma = document.getElementById('turmaSelect').value || 'ATA';
    const bimestre = document.getElementById('bimestreSelect').value || 'documento';

    // Mostrar loading
    const originalText = document.getElementById('pdfUploadStatus').innerHTML;
    document.getElementById('pdfUploadStatus').innerHTML =
        `<span style="color: var(--accent-blue);"><i class="bi bi-hourglass-split"></i> Convertendo PDF para DOCX...</span>`;

    try {
        // Usar API gratuita do Convertio (sem necessidade de chave para uso limitado)
        // Alternativa: usar pdf2docx simples baseado em estrutura

        // Como não temos API key, vamos usar a melhor conversão possível localmente
        // Renderizando PDF como imagem e inserindo no DOCX
        await convertPDFImageToDOCX();

    } catch (error) {
        console.error('Erro na conversão:', error);
        document.getElementById('pdfUploadStatus').innerHTML = originalText;
        alert('Erro ao converter PDF para DOCX. Tente gerar a ATA pelo sistema para melhor resultado.');
    }
}

// Conversão PDF carregado para DOCX (com imagem)
async function convertPDFImageToDOCX() {
    const { Document, Packer, Paragraph, ImageRun } = window.docx;

    const turma = document.getElementById('turmaSelect').value || 'ATA';
    const bimestre = document.getElementById('bimestreSelect').value || 'documento';

    try {
        // Configurar PDF.js
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        // Carregar PDF
        const loadingTask = pdfjsLib.getDocument({ data: pdfCarregado.data });
        const pdf = await loadingTask.promise;

        // Renderizar primeira página
        const page = await pdf.getPage(1);
        const scale = 2.0;
        const viewport = page.getViewport({ scale: scale });

        // Criar canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        // Converter canvas para blob
        const imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const imageBuffer = await imageBlob.arrayBuffer();

        // Criar documento DOCX com imagem
        const doc = new Document({
            sections: [{
                properties: {
                    page: {
                        margin: { top: 720, right: 720, bottom: 720, left: 720 }
                    }
                },
                children: [
                    new Paragraph({
                        children: [
                            new ImageRun({
                                data: imageBuffer,
                                transformation: {
                                    width: 595,
                                    height: 842
                                }
                            })
                        ]
                    })
                ]
            }]
        });

        const blob = await Packer.toBlob(doc);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ATA_${turma}_${bimestre}.docx`;
        link.click();
        URL.revokeObjectURL(url);

        document.getElementById('pdfUploadStatus').innerHTML =
            `<span style="color: var(--success);"><i class="bi bi-check-circle-fill"></i> PDF convertido para DOCX!</span>`;

        setTimeout(() => {
            const sizeInMB = (pdfCarregado.size / (1024 * 1024)).toFixed(2);
            document.getElementById('pdfUploadStatus').innerHTML = `
                <span style="color: var(--success);">
                    <i class="bi bi-check-circle-fill"></i> 
                    <strong>${pdfCarregado.name}</strong> (${sizeInMB} MB)
                </span>
            `;
        }, 2000);

    } catch (error) {
        console.error('Erro:', error);
        throw error;
    }
}

// ---------------------------------------------------------
// PDF UPLOAD HANDLER
// ---------------------------------------------------------

async function handlePDFUpload(event) {
    const file = event.target.files[0];

    if (!file) return;

    if (file.type !== 'application/pdf') {
        alert('Por favor, selecione um arquivo PDF válido!');
        return;
    }

    const statusDiv = document.getElementById('pdfUploadStatus');
    statusDiv.innerHTML = `<span style="color: var(--accent-blue);"><i class="bi bi-hourglass-split"></i> Carregando PDF...</span>`;

    try {
        // Ler o arquivo como ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();

        // Armazenar o PDF carregado
        pdfCarregado = {
            data: arrayBuffer,
            name: file.name,
            size: file.size
        };

        // Atualizar status
        const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
        statusDiv.innerHTML = `
            <span style="color: var(--success);">
                <i class="bi bi-check-circle-fill"></i> 
                <strong>${file.name}</strong> (${sizeInMB} MB)
            </span>
        `;

        console.log('PDF carregado com sucesso:', file.name);

    } catch (error) {
        console.error('Erro ao carregar PDF:', error);
        statusDiv.innerHTML = `<span style="color: var(--danger);"><i class="bi bi-x-circle-fill"></i> Erro ao carregar PDF</span>`;
        alert('Erro ao carregar o PDF. Tente novamente.');
    }
}

// ---------------------------------------------------------
// CONVERT TO JPEG
// ---------------------------------------------------------

async function convertToJPEG() {
    // Prioridade: PDF carregado > PDF gerado
    let pdfSource = pdfCarregado || pdfGerado;

    if (!pdfSource) {
        alert('Por favor, clique em "Baixar PDF" para gerar ou faça upload de um PDF!');
        return;
    }

    const turma = document.getElementById('turmaSelect').value || 'ATA';
    const bimestre = document.getElementById('bimestreSelect').value || 'documento';

    try {
        // Configurar PDF.js worker
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        let pdfData;

        // Obter dados do PDF
        if (pdfCarregado) {
            // PDF carregado via upload
            pdfData = pdfCarregado.data;
        } else {
            // PDF gerado pelo sistema - converter para ArrayBuffer
            const pdfBlob = pdfGerado.output('blob');
            pdfData = await pdfBlob.arrayBuffer();
        }

        // Carregar o PDF com PDF.js
        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdf = await loadingTask.promise;

        // Renderizar primeira página
        const page = await pdf.getPage(1);

        // Configurar escala para alta qualidade (300 DPI)
        const scale = 3.0;
        const viewport = page.getViewport({ scale: scale });

        // Criar canvas
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        // Renderizar PDF no canvas
        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };

        await page.render(renderContext).promise;

        // Converter canvas para JPEG
        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `ATA_${turma}_${bimestre}.jpeg`;
            link.click();
            URL.revokeObjectURL(url);
        }, 'image/jpeg', 0.95);

    } catch (error) {
        console.error('Erro ao converter PDF para JPEG:', error);
        alert('Erro ao converter PDF para JPEG. Verifique se o PDF está correto.');
    }
}

// ---------------------------------------------------------
// CONVERT TO DOCX
//----------------------------------------------------------

async function convertToDOCX() {
    // Verificar se temos os dados estruturados necessários
    if (!alunosCarregados || alunosCarregados.length === 0) {
        if (pdfCarregado) {
            alert('⚠️ Conversão para DOCX não disponível para PDFs carregados.\n\n' +
                'Para converter para DOCX:\n' +
                '1. Carregue os alunos da turma\n' +
                '2. Clique em "Baixar PDF" para gerar\n' +
                '3. Use "Converter PDF" → "Converter para DOCX"\n\n' +
                '💡 Para JPEG, você pode usar o PDF carregado!');
        } else {
            alert('Por favor, carregue os alunos e gere a ATA primeiro para converter para DOCX!');
        }
        return;
    }

    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType, convertInchesToTwip, UnderlineType } = window.docx;

    const escola = document.getElementById('escolaNome').value;
    const professor = document.getElementById('professorNome').value;
    const turma = document.getElementById('turmaSelect').value;
    const ano = document.getElementById('anoLetivo').value;
    const bimestre = document.getElementById('bimestreSelect').value.toUpperCase();

    const borderConfig = {
        top: { style: BorderStyle.SINGLE, size: 20, color: "000000" },
        bottom: { style: BorderStyle.SINGLE, size: 20, color: "000000" },
        left: { style: BorderStyle.SINGLE, size: 20, color: "000000" },
        right: { style: BorderStyle.SINGLE, size: 20, color: "000000" }
    };

    const headerRow = new TableRow({
        children: [
            new TableCell({
                children: [
                    new Paragraph({
                        children: [new TextRun({ text: "FOTO / NOME DO/A ALUNO(A)", bold: true, size: 16 })],
                        alignment: AlignmentType.CENTER
                    })
                ],
                borders: borderConfig,
                width: { size: 26, type: WidthType.PERCENTAGE },
                margins: { top: 100, bottom: 100, left: 100, right: 100 }
            }),
            new TableCell({
                children: [
                    new Paragraph({
                        children: [new TextRun({ text: "RECUPERAÇÍO/ESTUDO DIRIGIDO/ENCAMINHAMENTOS / NÍVEL DE LEITURA E ESCRITA", bold: true, size: 16 })],
                        alignment: AlignmentType.CENTER
                    })
                ],
                borders: borderConfig,
                width: { size: 32, type: WidthType.PERCENTAGE },
                margins: { top: 100, bottom: 100, left: 100, right: 100 }
            }),
            new TableCell({
                children: [
                    new Paragraph({
                        children: [new TextRun({ text: "PEQUENO RELATÓRIO SOBRE O ALUNO / OBSERVAÇÕES", bold: true, size: 16 })],
                        alignment: AlignmentType.CENTER
                    })
                ],
                borders: borderConfig,
                width: { size: 42, type: WidthType.PERCENTAGE },
                margins: { top: 100, bottom: 100, left: 100, right: 100 }
            })
        ]
    });

    const dataRows = alunosCarregados.map(aluno => {
        const lp = aluno.recupLP ? "Sim" : "Não";
        const mat = aluno.recupMat ? "Sim" : "Não";
        const niv = (aluno.nivel === 'Nenhum') ? 'Não avaliado' : aluno.nivel;

        return new TableRow({
            children: [
                new TableCell({
                    children: [
                        new Paragraph({
                            children: [new TextRun({ text: aluno.nome, bold: true, size: 22 })],
                            alignment: AlignmentType.LEFT
                        })
                    ],
                    borders: borderConfig,
                    verticalAlign: "center",
                    margins: { top: 150, bottom: 150, left: 150, right: 150 }
                }),
                new TableCell({
                    children: [
                        new Paragraph({
                            children: [
                                new TextRun({ text: "L.P.: ", bold: true, size: 22 }),
                                new TextRun({ text: lp, size: 22 })
                            ],
                            spacing: { after: 100 }
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: "Mat.: ", bold: true, size: 22 }),
                                new TextRun({ text: mat, size: 22 })
                            ],
                            spacing: { after: 100 }
                        }),
                        new Paragraph({
                            children: [
                                new TextRun({ text: "Nível: ", bold: true, size: 22 }),
                                new TextRun({ text: niv, size: 22 })
                            ]
                        })
                    ],
                    borders: borderConfig,
                    verticalAlign: "top",
                    margins: { top: 150, bottom: 150, left: 150, right: 150 }
                }),
                new TableCell({
                    children: [
                        new Paragraph({
                            children: [new TextRun({ text: aluno.observacoes || "", size: 22 })],
                            alignment: AlignmentType.LEFT
                        })
                    ],
                    borders: borderConfig,
                    verticalAlign: "top",
                    margins: { top: 150, bottom: 150, left: 150, right: 150 }
                })
            ]
        });
    });

    const mainTable = new Table({
        rows: [headerRow, ...dataRows],
        width: { size: 100, type: WidthType.PERCENTAGE },
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    margin: {
                        top: convertInchesToTwip(0.79),
                        bottom: convertInchesToTwip(0.79),
                        left: convertInchesToTwip(0.79),
                        right: convertInchesToTwip(0.79)
                    }
                }
            },
            children: [
                new Paragraph({
                    children: [new TextRun({
                        text: `SECRETARIA DE EDUCAÇÍO DE AMERICANA – MAPEAMENTO DA ESCOLA – ${bimestre} - ${ano}`,
                        bold: true,
                        size: 22,
                        font: "Arial",
                        underline: { type: UnderlineType.SINGLE }
                    })],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 100 }
                }),
                new Paragraph({
                    children: [new TextRun({ text: "PLANILHA DO CONSELHO DE CLASSE", bold: true, size: 28, font: "Arial" })],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 200 }
                }),
                new Paragraph({
                    children: [
                        new TextRun({ text: "Escola: ", bold: true, size: 22, font: "Arial" }),
                        new TextRun({ text: escola, size: 22, font: "Arial" })
                    ],
                    spacing: { after: 100 }
                }),
                new Paragraph({
                    children: [
                        new TextRun({ text: "Professor(a): ", bold: true, size: 22, font: "Arial" }),
                        new TextRun({ text: professor, size: 22, font: "Arial" })
                    ],
                    spacing: { after: 100 }
                }),
                new Paragraph({
                    children: [
                        new TextRun({ text: "Ano/Turma: ", bold: true, size: 22, font: "Arial" }),
                        new TextRun({ text: turma, size: 22, font: "Arial" })
                    ],
                    spacing: { after: 300 }
                }),
                mainTable
            ]
        }]
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ATA_${turma}_${bimestre}.docx`;
    link.click();
}
