/**
 * Módulo Principal da Aplicação
 * Inicializa e coordena todos os módulos
 */

import db from './db.js';
import auth from './auth-module.js';
import ui from './ui.js';
import students from './students.js';
import notes from './notes.js';
import exportManager from './export.js';

class App {
    constructor() {
        this.initialized = false;
        this.currentPage = null;
    }

    /**
     * Inicializa a aplicação
     */
    async init() {
        try {
            console.log('Inicializando aplicação...');

            // Define tema dark como padrão
            document.documentElement.setAttribute('data-theme', 'dark');

            // Inicializa UI primeiro (para mostrar loading)
            ui.init();
            ui.loading(true, 'Carregando sistema...');

            // Inicializa autenticação
            await auth.init();

            // Inicializa banco de dados
            await db.init();

            // Detecta página atual
            this.detectCurrentPage();

            // Inicializa página específica
            await this.initCurrentPage();

            this.initialized = true;
            ui.loading(false);

            console.log('Aplicação inicializada com sucesso!');
        } catch (error) {
            ui.loading(false);
            console.error('Erro ao inicializar aplicação:', error);
            ui.error('Erro ao carregar o sistema. Por favor, recarregue a página.');
        }
    }

    /**
     * Detecta qual página está sendo acessada
     */
    detectCurrentPage() {
        const path = window.location.pathname;
        const filename = path.split('/').pop() || 'index.html';

        if (filename === 'index.html' || filename === '') {
            this.currentPage = 'login';
        } else if (filename === 'selecionar.html') {
            this.currentPage = 'selecionar';
        } else if (filename === 'turma.html') {
            this.currentPage = 'turma';
        } else if (filename.includes('direcao')) {
            this.currentPage = 'direcao';
        } else if (filename.includes('graficos')) {
            this.currentPage = 'graficos';
        } else if (filename.includes('ata')) {
            this.currentPage = 'ata';
        } else {
            this.currentPage = 'unknown';
        }

        console.log('Página atual:', this.currentPage);
    }

    /**
     * Inicializa a página atual
     */
    async initCurrentPage() {
        switch (this.currentPage) {
            case 'login':
                this.initLoginPage();
                break;
            case 'selecionar':
                this.initSelecionarPage();
                break;
            case 'turma':
                await this.initTurmaPage();
                break;
            case 'direcao':
                await this.initDirecaoPage();
                break;
            case 'graficos':
                await this.initGraficosPage();
                break;
            default:
                console.log('Página não reconhecida');
        }
    }

    /**
     * Inicializa página de login
     */
    initLoginPage() {
        // Redireciona se já estiver logado
        if (auth.redirectIfLoggedIn()) return;

        const form = document.getElementById('loginForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }
    }

    /**
     * Processa login
     */
    handleLogin() {
        const usuario = document.getElementById('username')?.value;
        const senha = document.getElementById('password')?.value;

        if (!usuario || !senha) {
            ui.error('Preencha todos os campos');
            return;
        }

        const config = db.getConfig();
        const user = auth.login(usuario, senha, config.usuarios);

        if (user) {
            ui.success(`Bem-vindo, ${user.nome}!`);
            setTimeout(() => {
                window.location.href = 'selecionar.html';
            }, 1000);
        } else {
            ui.error('Usuário ou senha inválidos');
        }
    }

    /**
     * Inicializa página de seleção de turmas
     */
    initSelecionarPage() {
        if (!auth.requireAuth()) return;

        this.updateUserNavbar(); // Atualizar foto/nome do usuário
        this.renderTurmasGrid();
        this.setupSelecionarEvents();
    }

    /**
     * Atualiza navbar com foto e nome do usuário logado
     */
    async updateUserNavbar() {
        const user = auth.getCurrentUser();
        if (!user) return;

        let nomeExibir = user.nome || 'Usuário';
        let fotoUrl = null;

        // Para professores, busca dados atualizados do banco
        if (user.perfil === 'professor') {
            try {
                const professores = await db.getAll('professores');
                const professor = professores.find(p =>
                    (user._id && p.idUsuario === user._id) ||
                    (user.id && p.idUsuario === user.id) ||
                    (user.email && p.email === user.email)
                );

                if (professor) {
                    nomeExibir = professor.nome || user.nome;
                    fotoUrl = professor.foto || null;
                    console.log('📌 Professor encontrado:', professor.nome, '| Sala:', professor.salaPrincipal);
                }
            } catch (e) {
                console.error('Erro ao buscar dados do professor:', e);
            }
        } else if (user.perfil === 'diretor' || user.perfil === 'admin') {
            // Para outros perfis, usa dados do sessionStorage
            const userData = JSON.parse(sessionStorage.getItem('currentUser') || '{}');
            fotoUrl = userData.foto || null;
        }

        // Atualizar nome na navbar (turma.html)
        const navUserName = document.getElementById('navUserName');
        if (navUserName) {
            navUserName.textContent = nomeExibir;
        }

        // Atualizar avatar na navbar (turma.html)
        const userAvatar = document.getElementById('userAvatar');
        if (userAvatar) {
            if (fotoUrl) {
                userAvatar.innerHTML = `<img src="${fotoUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
            } else {
                userAvatar.textContent = nomeExibir.charAt(0)?.toUpperCase() || 'U';
            }
        }

        // Atualizar perfil em selecionar.html
        const userNameSelecionar = document.getElementById('userNameSelecionar');
        if (userNameSelecionar) {
            userNameSelecionar.textContent = nomeExibir;
        }

        const userAvatarSelecionar = document.getElementById('userAvatarSelecionar');
        if (userAvatarSelecionar) {
            if (fotoUrl) {
                userAvatarSelecionar.innerHTML = `<img src="${fotoUrl}" style="width:100%; height:100%; object-fit:cover; border-radius:50%;">`;
            } else {
                userAvatarSelecionar.textContent = nomeExibir.charAt(0)?.toUpperCase() || 'U';
            }
        }
    }

    /**
     * Renderiza grid de turmas (filtrado por permissão do usuário)
     */
    async renderTurmasGrid() {
        const container = document.getElementById('turmasGrid');
        if (!container) return;

        let turmas = db.getTurmas();

        // Verifica se é professor e filtra turmas permitidas
        const user = auth.getCurrentUser();
        if (user && user.perfil === 'professor') {
            // Default: Show nothing if logic fails to find specific classes (Security First)
            let filtered = false;
            let myTurmas = [];

            const sessionData = sessionStorage.getItem('currentUser');
            if (sessionData) {
                try {
                    const userData = JSON.parse(sessionData);
                    const turmasPermitidas = await this.getTurmasPermitidasProfessor(userData._id || userData.id);

                    if (turmasPermitidas && turmasPermitidas.length > 0) {
                        const mapName = (name) => {
                            let n = name.replace('º', '').trim();
                            n = n.replace(/^Primeiro\s*/i, '1');
                            n = n.replace(/^Segundo\s*/i, '2');
                            n = n.replace(/^Terceiro\s*/i, '3');
                            n = n.replace(/^Quarto\s*/i, '4');
                            n = n.replace(/^Quinto\s*/i, '5');
                            n = n.replace(/\s+/g, ''); // Remove spaces "1 A" -> "1A"
                            return n;
                        };

                        const turmasNormalizadas = turmasPermitidas.map(t => mapName(t));

                        // Strict filter
                        myTurmas = turmas.filter(turma => {
                            const turmaIdNorm = mapName(turma.id);
                            // Check both exact match and mapped match
                            return turmasNormalizadas.includes(turma.id) || turmasNormalizadas.includes(turmaIdNorm);
                        });
                        filtered = true;
                    }
                } catch (e) {
                    console.error('Erro ao filtrar turmas:', e);
                }
            }

            // If filtered is true, use myTurmas. If false (error or no profile found), use empty.
            // DO NOT fall back to 'turmas' (all)
            turmas = filtered ? myTurmas : [];
        }

        const professoresCadastrados = await this.getProfessoresPorTurma();
        const turmasPorAno = {};
        for (const turma of turmas) {
            if (!turmasPorAno[turma.ano]) turmasPorAno[turma.ano] = [];

            const stats = await notes.getStatsTurma(turma.id);
            turma.media = stats.media;
            const profsDaTurma = professoresCadastrados[turma.id] || { regente: null, especiais: [] };
            turma.professorRegente = profsDaTurma.regente;
            turma.professoresEspeciais = profsDaTurma.especiais;
            turmasPorAno[turma.ano].push(turma);
        }

        let html = '';

        if (Object.keys(turmasPorAno).length === 0) {
            html = `
                <div class="empty-state">
                    <i class="bi bi-inbox"></i>
                    <h3>Nenhuma turma encontrada</h3>
                    <p>Você não tem turmas atribuídas ou os dados ainda não foram carregados.</p>
                </div>
            `;
        } else {
            Object.keys(turmasPorAno).sort().forEach(ano => {
                html += `
                    <div class="ano-section">
                        <h3 class="ano-title">${ano}º Ano</h3>
                        <div class="turmas-row">
                            ${turmasPorAno[ano].map(turma => {
                    const mediaClass = turma.media !== null ? ui.getNotaClass(turma.media) : '';
                    const mediaDisplay = turma.media !== null ? ui.formatNota(turma.media) : '-';
                    const nomeRegente = turma.professorRegente ? turma.professorRegente.nome : (turma.professor || 'Sem Professor');
                    const fotoRegente = turma.professorRegente && turma.professorRegente.foto ? turma.professorRegente.foto : null;

                    // Materias buttons
                    const materias = ['Sala Principal', 'Artes', 'Inglês', 'Educação Física', 'SEBRAE', 'Oficina de Leitura'];

                    return `
                        <div class="turma-card" id="card-${turma.id}">
                            <!-- Header do Card (Clicável para expandir via delegation) -->
                            <div class="turma-card-content">
                                <div class="turma-card-header" style="display:flex; justify-content:space-between; align-items:flex-start; width:100%;">
                                    <div class="turma-icon">${turma.ano}${turma.sala}</div>
                                    <div class="turma-media-badge media-valor ${mediaClass}" style="padding: 4px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: bold;">
                                        Média: ${mediaDisplay}
                                    </div>
                                </div>
                                <div class="turma-info">
                                    <h4>Turma ${turma.id}</h4>
                                    <p>${turma.turno}</p>
                                    <div class="professor-info" style="display:flex; align-items:center; gap:8px; margin-top:5px;">
                                        <div class="foto-mini" style="width:24px; height:24px; border-radius:50%; overflow:hidden; background:#eee;">
                                            ${fotoRegente
                            ? `<img src="${fotoRegente}" style="width:100%; height:100%; object-fit:cover;">`
                            : `<div style="display:flex; align-items:center; justify-content:center; width:100%; height:100%; font-size:10px; color:#666;">${nomeRegente.charAt(0)}</div>`}
                                        </div>
                                        <p class="professor" style="margin:0;">${nomeRegente}</p>
                                    </div>
                                    <i class="bi bi-chevron-down expand-icon" style="margin-top:10px; opacity:0.5;"></i>
                                </div>
                            </div>

                            <!-- Abas Expansíveis -->
                            <div class="turma-expand-tabs" id="tabs-${turma.id}">
                                ${materias.map(mat => `
                                    <button class="turma-tab-btn ${mat === 'Sala Principal' ? 'sala-principal' : ''}" 
                                            data-turma="${turma.id}" data-materia="${mat}">
                                        <i class="bi ${this.getMateriaIcon(mat)}"></i> ${mat}
                                    </button>
                                `).join('')}
                            </div>
                        </div>
                    `}).join('')}
                        </div>
                    </div>
                `;
            });
        }

        container.innerHTML = html;
        this.setupSelecionarEvents();
    }

    getMateriaIcon(mat) {
        const icons = {
            'Sala Principal': 'bi-people-fill',
            'Artes': 'bi-palette-fill',
            'Inglês': 'bi-translate',
            'Educação Física': 'bi-bicycle',
            'SEBRAE': 'bi-lightbulb-fill',
            'Oficina de Leitura': 'bi-book-half'
        };
        return icons[mat] || 'bi-book';
    }

    /**
     * Expande ou colapsa o card da turma
     */
    toggleTurmaCard(turmaId) {
        const card = document.getElementById(`card-${turmaId}`);
        if (card) {
            // Fecha outros abertos
            document.querySelectorAll('.turma-card.expanded').forEach(c => {
                if (c.id !== `card-${turmaId}`) c.classList.remove('expanded');
            });
            card.classList.toggle('expanded');
        }
    }

    /**
     * Busca professores organizados por turma
     * Retorna: { "1A": { regente: {...}, especiais: [{...}] }, ... }
     */
    async getProfessoresPorTurma() {
        const resultado = {};

        try {
            const professores = await db.getAll('professores');
            console.log('📚 Professores carregados do banco:', professores.length);

            for (const prof of professores) {
                console.log('  -> Professor:', prof.nome, '| Sala:', prof.salaPrincipal);

                // Verifica se é professor especial (Artes, Ed. Física, Inglês)
                const materiasEspeciais = ['Inglês', 'Educação Física', 'Artes', 'SEBRAE', 'Oficina de Leitura'];
                const ehEspecial = prof.tipoEspecial ||
                    (prof.materias && prof.materias.some(m => materiasEspeciais.includes(m)));

                if (ehEspecial) {
                    // Professor especial - adiciona a todas as turmas que ele selecionou
                    const turmasDoProf = prof.salasAdicionais || [];
                    for (const turmaId of turmasDoProf) {
                        const turmaIdNormalizado = turmaId.replace('º', '');
                        if (!resultado[turmaIdNormalizado]) {
                            resultado[turmaIdNormalizado] = { regente: null, especiais: [] };
                        }
                        resultado[turmaIdNormalizado].especiais.push({
                            nome: prof.nome,
                            materias: prof.materias || []
                        });
                    }
                } else {
                    // Professor regente - sala principal
                    const salaPrincipal = prof.salaPrincipal?.replace('º', '');
                    console.log('    Sala normalizada:', salaPrincipal);
                    if (salaPrincipal && salaPrincipal !== 'VARIADOS') {
                        if (!resultado[salaPrincipal]) {
                            resultado[salaPrincipal] = { regente: null, especiais: [] };
                        }
                        resultado[salaPrincipal].regente = {
                            nome: prof.nome,
                            foto: prof.foto || null,
                            materias: prof.materias || []
                        };
                    }
                }
            }

            console.log('📊 Mapa de professores por turma:', resultado);
        } catch (e) {
            console.error('Erro ao buscar professores por turma:', e);
        }

        return resultado;
    }

    async getTurmasPermitidasProfessor(userId) {
        try {
            const user = auth.getCurrentUser();
            const userEmail = user?.email;

            // Busca diretamente do perfil do professor no MongoDB
            const professores = await db.getAll('professores');

            console.log('Buscando turmas para:', userEmail, 'userId:', userId);
            console.log('Professores no banco:', professores.length);

            // Tenta encontrar por ID ou Email
            const professor = professores.find(p =>
                (p.idUsuario && (p.idUsuario === userId || p.idUsuario === user?.id || p.idUsuario === user?._id)) ||
                (userEmail && p.email === userEmail)
            );

            console.log('Professor encontrado:', professor ? professor.nome : 'NENHUM');

            if (professor) {
                const turmas = [];
                // Se tiver sala principal definida e não for VARIADOS
                if (professor.salaPrincipal && professor.salaPrincipal !== 'VARIADOS') {
                    turmas.push(professor.salaPrincipal);
                }

                // Adiciona salas adicionais
                if (professor.salasAdicionais && professor.salasAdicionais.length > 0) {
                    turmas.push(...professor.salasAdicionais);
                }

                // Se for professor especial sem turmas explicitas, talvez tenha que permitir todas ou vazio
                // Mas a lógica atual pede turmas explicitas.

                console.log('Turmas permitidas:', turmas);
                return turmas;
            }

            return [];
        } catch (e) {
            console.error('Erro ao buscar turmas permitidas:', e);
            return [];
        }
    }

    /**
     * Configura eventos da página de seleção
     */
    /**
     * Configura eventos da página de seleção
     */
    setupSelecionarEvents() {
        const grid = document.getElementById('turmasGrid');
        if (grid) {
            // Remove listener antigo se existir para evitar duplicação (embora replaceElement previna isso, listeners anônimos acumulam se a função for chamada múltiplas vezes sem limpeza, mas aqui é inicialização única geralmente)
            // Melhor abordagem: Delegated Event Listener

            grid.removeEventListener('click', this.handleGridClick); // Safety cleanup
            this.handleGridClick = (e) => {
                // 1. Click no botão da aba (Matéria)
                const tabBtn = e.target.closest('.turma-tab-btn');
                if (tabBtn) {
                    e.stopPropagation();
                    e.preventDefault();
                    // Suporte tanto para dataset quanto para atributos legados se a renderização antiga persistir
                    const turmaId = tabBtn.dataset.turma || tabBtn.getAttribute('onclick')?.match(/'([^']+)'/)[1];
                    const materia = tabBtn.dataset.materia || tabBtn.innerText.trim();

                    // Fallback se o regex falhar ou attributes não existirem (caso do render antigo)
                    if (tabBtn.onclick) {
                        // Se tiver onclick inline, deixa o navegador processar (mas estamos tentando mover para delegate)
                        // Se removermos o onclick do HTML, este código aqui roda.
                        // O código abaixo assume que o HTML foi limpo de onclicks.
                        // Se não foi, o onclick roda primeiro usually.
                    }

                    // Se migrarmos para data-attributes:
                    if (turmaId && materia) {
                        this.abrirTurma(turmaId, 1, materia);
                    }
                    return;
                }

                // 2. Click no Header do Card (Expandir)
                const cardContent = e.target.closest('.turma-card-content');
                if (cardContent) {
                    const card = cardContent.closest('.turma-card');
                    if (card) {
                        const turmaId = card.id.replace('card-', '');
                        this.toggleTurmaCard(turmaId);
                    }
                }
            };
            grid.addEventListener('click', this.handleGridClick);
        }

        // Botão de logout
        document.getElementById('btnLogout')?.addEventListener('click', () => {
            this.handleLogout();
        });

        // Botão Dashboard
        document.getElementById('btnDashboard')?.addEventListener('click', () => {
            window.location.href = 'dashboard.html';
        });

        // Botão de direção
        document.getElementById('btnDirecao')?.addEventListener('click', () => {
            window.location.href = 'direcao/index.html';
        });

        // Exibe nome do usuário
        const user = auth.getCurrentUser();
        const userNameEl = document.getElementById('userName');
        if (userNameEl && user) {
            userNameEl.textContent = user.nome;
        }

        // Mostra card Ferramentas apenas para administradores
        const cardFerramentas = document.getElementById('cardFerramentasSelecionar');
        if (cardFerramentas && user && user.perfil === 'admin') {
            cardFerramentas.classList.remove('hidden');
        }
    }

    /**
     * Abre página de uma turma
     * @param {string} turmaId - ID da turma
     * @param {number} bimestre - Bimestre (padrão: 1)
     * @param {string} materia - Matéria selecionada (opcional)
     */
    abrirTurma(turmaId, bimestre = 1, materia = 'Sala Principal') {
        const params = new URLSearchParams();
        params.set('turma', turmaId);
        params.set('bim', bimestre);
        params.set('materia', materia);
        window.location.href = `turma.html?${params.toString()}`;
    }

    /**
     * Inicializa página de turma
     */
    async initTurmaPage() {
        if (!auth.requireAuth()) return;

        this.updateUserNavbar(); // Atualizar foto/nome do usuário

        // Obtém parâmetros da URL
        const params = new URLSearchParams(window.location.search);
        const turmaId = params.get('turma');
        const bimestre = parseInt(params.get('bim')) || 1;
        const materia = params.get('materia') || 'Sala Principal';

        if (!turmaId) {
            ui.error('Turma não especificada');
            setTimeout(() => window.location.href = 'selecionar.html', 2000);
            return;
        }

        ui.loading(true, 'Carregando dados da turma...');

        students.setCurrentTurma(turmaId);
        students.setCurrentBimestre(bimestre);

        try {
            await this.renderTurmaPage(turmaId, bimestre, materia);
            this.setupTurmaEvents(turmaId, bimestre, materia);
        } finally {
            ui.loading(false);
        }
    }

    /**
     * Renderiza página da turma
     * @param {string} turmaId - ID da turma
     * @param {number} bimestre - Bimestre atual
     * @param {string} materia - Matéria atual
     */
    async renderTurmaPage(turmaId, bimestre, materia = null) {
        if (!materia) {
            const params = new URLSearchParams(window.location.search);
            materia = params.get('materia') || 'Sala Principal';
        }
        const turma = db.getTurmaById(turmaId);
        const alunos = await students.getByTurma(turmaId);

        // Atualiza título com Matéria
        if (document.getElementById('turmaTitle')) {
            const el = document.getElementById('turmaTitle');
            el.innerHTML = `${turmaId} <span class="badge-materia" style="font-size:0.6em; background:var(--primary); padding:2px 8px; border-radius:12px; vertical-align:middle; margin-left:10px;">${materia}</span>`;
        }

        // Atualiza ícone da turma (quadrado lateral)
        const icone = document.getElementById('turmaIcone');
        if (icone) {
            icone.textContent = turmaId;
        }

        document.getElementById('bimestreTitle')?.textContent &&
            (document.getElementById('bimestreTitle').textContent = `${bimestre}º Bimestre`);

        const professoresPorTurma = await this.getProfessoresPorTurma();
        const profDaTurma = professoresPorTurma[turmaId] || { regente: null };
        const nomeProfessor = profDaTurma.regente ? profDaTurma.regente.nome : (turma?.professor || '');

        document.getElementById('professorName')?.textContent &&
            (document.getElementById('professorName').textContent = nomeProfessor);

        // Renderiza tabs de bimestre
        this.renderBimestreTabs(bimestre);

        // Renderiza tabela de alunos
        await this.renderAlunosTable(alunos, turmaId, bimestre, materia);
    }

    /**
     * Renderiza tabs de bimestre
     * @param {number} bimestreAtual - Bimestre selecionado
     */
    renderBimestreTabs(bimestreAtual) {
        const container = document.getElementById('bimestreTabs');
        if (!container) return;

        const bimestres = [1, 2, 3, 4];
        container.innerHTML = bimestres.map(bim => `
            <button class="bimestre-tab ${bim === bimestreAtual ? 'active' : ''}" data-bimestre="${bim}">
                ${bim}º Bim
            </button>
        `).join('');
    }

    /**
     * Renderiza tabela de alunos
     * @param {Array} alunos - Lista de alunos
     * @param {string} turmaId - ID da turma
     * @param {number} bimestre - Bimestre
     */
    async renderAlunosTable(alunos, turmaId, bimestre, materia = 'Sala Principal') {
        const tbody = document.getElementById('alunosTableBody');
        if (!tbody) return;

        // Dynamic Headers
        const theadRow = document.querySelector('.alunos-table thead tr');
        if (theadRow) {
            let mediaHeader = theadRow.querySelector('.col-media');
            let mediaGeralHeader = theadRow.querySelector('.col-media-geral');

            if (materia === 'Sala Principal') {
                if (mediaHeader) mediaHeader.textContent = 'Média Interna';
                if (!mediaGeralHeader && mediaHeader) {
                    const th = document.createElement('th');
                    th.className = 'col-media col-media-geral'; // Re-use styling
                    th.textContent = 'Média Geral';
                    mediaHeader.after(th);
                }
            } else {
                if (mediaHeader) mediaHeader.textContent = 'Média';
                if (mediaGeralHeader) mediaGeralHeader.remove();
            }
        }

        if (alunos.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="${materia === 'Sala Principal' ? 10 : 9}" class="empty-message">
                        Nenhum aluno cadastrado nesta turma.
                        <button class="btn btn-primary btn-sm" id="btnAddFirstStudent">
                            Adicionar Aluno
                        </button>
                    </td>
                </tr>
            `;
            return;
        }

        // Preload notes for the entire class to prevent making an HTTP request for every single student!
        const preloadedNotas = await notes.getByTurma(turmaId);

        let html = '';

        for (const [index, aluno] of alunos.entries()) {
            let media, mediaGeral = null;

            if (materia === 'Sala Principal') {
                media = await notes.getMediaSalaPrincipal(aluno.id, bimestre, preloadedNotas);
                mediaGeral = await notes.getMediaGeralAluno(aluno.id, bimestre, preloadedNotas);
            } else {
                media = await notes.getMediaAlunoMateria(aluno.id, materia, bimestre, preloadedNotas);
            }

            const mediaClass = media !== null ? ui.getNotaClass(media) : '';
            const mediaGeralClass = mediaGeral !== null ? ui.getNotaClass(mediaGeral) : '';

            html += `
                <tr data-aluno-id="${aluno.id}">
                    <td class="col-num">${index + 1}</td>
                    <td class="col-foto">
                        <div class="foto-container" onclick="app.triggerPhotoUpload('${aluno.id}')" style="cursor: pointer;">
                            ${aluno.foto
                    ? `<img src="${aluno.foto}" alt="${aluno.nome}" class="foto-aluno">`
                    : `<div class="foto-placeholder">${aluno.nome.charAt(0)}</div>`
                }
                        </div>
                    </td>
                    <td class="col-nome">
                        <div class="nome-wrapper">
                            <span class="nome">${aluno.nome}</span>
                            ${aluno.deficiencia ? `<span class="badge-deficiencia" title="${aluno.deficiencia}">PCD</span>` : ''}
                        </div>
                        ${(aluno.observacoesBimestre)
                    ? (aluno.observacoesBimestre[bimestre] ? `<small class="observacoes">${aluno.observacoesBimestre[bimestre]}</small>` : '')
                    : (aluno.observacoes ? `<small class="observacoes">${aluno.observacoes}</small>` : '')}
                    </td>
                    <td class="col-nivel">
                        <div class="level-badge-container">
                            ${(() => {
                    const niv = (aluno.nivelBimestre && aluno.nivelBimestre[bimestre]) ? aluno.nivelBimestre[bimestre] : '-';
                    let circleClass = '';
                    if (niv === 'PS' || niv === '1') circleClass = 'level-red';
                    else if (['S', 'SCV', 'S/V/S', '2'].includes(niv)) circleClass = 'level-yellow';
                    else if (niv === 'SA' || niv === '3') circleClass = 'level-blue';
                    else if (niv === 'A' || niv === '4') circleClass = 'level-green';

                    return circleClass ? `<span class="level-circle ${circleClass}"></span><span>${niv}</span>` : niv;
                })()}
                        </div>
                    </td>
                    <td class="col-condicao">${aluno.condicao || aluno.deficiencia || '-'}</td>
                    <td class="col-matricula">${aluno.matricula || '-'}</td>
                    <td class="col-recuperacao">
                        ${(() => {
                    if (aluno.recuperacaoBimestre && aluno.recuperacaoBimestre[bimestre]) {
                        const rec = aluno.recuperacaoBimestre[bimestre];
                        let tags = [];
                        if (rec.lp) tags.push('<span class="badge badge-warning">LP</span>');
                        if (rec.mat) tags.push('<span class="badge badge-warning">Mat</span>');
                        return tags.length ? tags.join(' ') : '-';
                    }
                    return '-';
                })()}
                    </td>
                    <td class="col-media">
                        <span class="media-valor ${mediaClass}">
                            ${media !== null ? ui.formatNota(media) : '-'}
                        </span>
                    </td>
                    ${materia === 'Sala Principal' ? `
                    <td class="col-media col-media-geral">
                        <span class="media-valor ${mediaGeralClass}">
                            ${mediaGeral !== null ? ui.formatNota(mediaGeral) : '-'}
                        </span>
                    </td>
                    ` : ''}
                    <td class="col-acoes">
                        <button class="btn-icon btn-editar" title="Editar" data-action="editar">
                            <i class="bi bi-pencil-fill"></i>
                        </button>
                        <button class="btn-icon btn-notas" title="Notas" data-action="notas">
                            <i class="bi bi-file-earmark-text-fill"></i>
                        </button>
                        <button class="btn-icon btn-excluir" title="Excluir" data-action="excluir">
                            <i class="bi bi-trash-fill"></i>
                        </button>
                    </td>
                </tr>
            `;
        }

        tbody.innerHTML = html;

        // Atualiza contador
        const totalAlunosEl = document.getElementById('totalAlunos');
        if (totalAlunosEl) totalAlunosEl.textContent = alunos.length;
    }

    /**
     * Configura eventos da página de turma
     * @param {string} turmaId - ID da turma
     * @param {number} bimestre - Bimestre atual
     */
    setupTurmaEvents(turmaId, bimestre) {
        // Voltar
        document.getElementById('btnVoltar')?.addEventListener('click', () => {
            window.location.href = 'selecionar.html';
        });

        // Toggle View Tabs (Alunos, Faltas, Relatorios)
        const viewTabs = document.querySelectorAll('#viewTabs button');
        viewTabs.forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Remove active class
                viewTabs.forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');

                const view = e.currentTarget.dataset.view;

                // Toggle containers
                const alunosContainer = document.querySelector('.alunos-container');
                const faltasContainer = document.querySelector('.faltas-container');
                const relatoriosContainer = document.querySelector('.relatorios-container');

                if (alunosContainer) alunosContainer.style.display = view === 'notas' ? 'block' : 'none';
                if (faltasContainer) faltasContainer.style.display = view === 'faltas' ? 'block' : 'none';
                if (relatoriosContainer) relatoriosContainer.style.display = view === 'relatorios' ? 'block' : 'none';

                if (view === 'faltas') this.renderFaltas(turmaId, bimestre);
                if (view === 'relatorios') this.renderRelatorios(turmaId, bimestre);
            });
        });

        // Adicionar aluno
        document.getElementById('btnAddAluno')?.addEventListener('click', () => {
            this.showAddAlunoModal(turmaId);
        });

        // Exportar DOCX
        document.getElementById('btnExportDocx')?.addEventListener('click', () => {
            exportManager.exportarTurmaDOCX(turmaId, bimestre);
        });

        // Exportar CSV
        document.getElementById('btnExportCsv')?.addEventListener('click', () => {
            exportManager.exportarAlunosCSV(turmaId);
        });

        // Tabs de bimestre
        document.getElementById('bimestreTabs')?.addEventListener('click', (e) => {
            const tab = e.target.closest('.bimestre-tab');
            if (tab) {
                const novoBimestre = parseInt(tab.dataset.bimestre);
                // Obtem materia da URL para manter o contexto
                const params = new URLSearchParams(window.location.search);
                const materia = params.get('materia') || 'Sala Principal';
                this.abrirTurma(turmaId, novoBimestre, materia);
            }
        });

        // Ações na tabela de alunos
        document.getElementById('alunosTableBody')?.addEventListener('click', (e) => {
            // Check for Photo Click
            const fotoContainer = e.target.closest('.foto-container');
            if (fotoContainer) {
                const row = fotoContainer.closest('tr');
                const alunoId = row.dataset.alunoId;
                this.triggerPhotoUpload(alunoId);
                return;
            }

            const btn = e.target.closest('[data-action]');
            if (!btn) return;

            const row = btn.closest('tr');
            const alunoId = row.dataset.alunoId;
            const action = btn.dataset.action;

            switch (action) {
                case 'editar':
                    this.showEditAlunoModal(alunoId);
                    break;
                case 'notas':
                    this.showNotasModal(alunoId, turmaId, bimestre);
                    break;
                case 'grafico':
                    window.location.href = `graficos/index.html?aluno=${alunoId}`;
                    break;
                case 'excluir':
                    const alunoNomeExcluir = row.querySelector('.nome')?.textContent || 'Aluno';
                    this.confirmDeleteAluno(alunoId, alunoNomeExcluir);
                    break;
            }
        });
    }

    /**
     * Renderiza a aba de Faltas
     */
    async renderFaltas(turmaId, bimestre) {
        const container = document.querySelector('.faltas-container');
        if (!container) return;

        const params = new URLSearchParams(window.location.search);
        const materia = params.get('materia') || 'Sala Principal';
        const hoje = new Date().toISOString().split('T')[0];

        const alunos = await students.getByTurma(turmaId);
        const totalAlunos = alunos.length;

        // Buscar dados do professor e escola
        let nomeProfessor = 'Professor';
        let nomeEscola = 'Escola';

        try {
            const user = auth.getCurrentUser();
            if (user) {
                if (user.perfil === 'professor') {
                    // Busca perfil completo para ter a escola
                    const professores = await db.getAll('professores');
                    const professor = professores.find(p => p.idUsuario === user._id || p.email === user.email);
                    if (professor) {
                        nomeProfessor = professor.nome || user.nome;
                        nomeEscola = professor.escola || 'Escola não informada';
                    }
                } else if (user.perfil === 'diretor') {
                    // Busca perfil completo do diretor
                    const diretores = await db.getAll('diretores');
                    const diretor = diretores.find(d => d.idUsuario === user._id);
                    if (diretor) {
                        nomeProfessor = user.nome; // No caso de diretor vendo, mostra nome dele ou generic? 
                        // O user pediu "nome do professor". Se for diretor vendo a turma, deveria ser o prof da turma?
                        // Por simplificação e segurança no momento, assumimos o usuário logado se for prof. 
                        // Se for diretor, talvez quisesse ver o prof da turma.
                        // Vamos tentar pegar o prof da turma se possível.
                        nomeEscola = diretor.escola || 'Escola não informada';
                    }
                } else if (user.perfil === 'admin' || user.perfil === 'diretor') {
                    // Admin or Director seeing - get dynamic teacher
                    const professoresPorTurma = await this.getProfessoresPorTurma();
                    const profDaTurma = professoresPorTurma[turmaId];
                    if (profDaTurma && profDaTurma.regente) {
                        nomeProfessor = profDaTurma.regente.nome;
                    } else {
                        const turmaInfo = db.getTurmaById(turmaId);
                        if (turmaInfo && turmaInfo.professor) {
                            nomeProfessor = turmaInfo.professor;
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Erro ao carregar dados do professor:', e);
        }

        // Sistema de persistência com API Backend
        const salvarFaltas = async (data, presencas) => {
            try {
                const response = await fetch(`${db.baseUrl}/faltas/sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        turma: turmaId,
                        data: data,
                        materia: materia,
                        nomeProfessor: nomeProfessor, // Necessário para validação de grade
                        presencas: presencas // [{ alunoId, presente }]
                    })
                });
                const json = await response.json();
                if (!json.success) throw new Error(json.error);
                return true;
            } catch (e) {
                console.error('Erro ao salvar faltas:', e);
                ui.error('Erro ao salvar frequência: ' + e.message);
                return false;
            }
        };

        const carregarFaltas = async (data) => {
            try {
                const response = await fetch(`${db.baseUrl}/faltas?turma=${turmaId}&data=${data}`);
                const json = await response.json();
                if (json.success) {
                    // Filtra apenas as faltas (presente: false) para manter compatibilidade com a lógica visual
                    return json.data.filter(a => !a.presente && a.materia === materia).map(a =>
                        (typeof a.aluno === 'string' ? a.aluno : a.aluno._id)
                    );
                }
                return [];
            } catch (e) {
                console.error('Erro ao carregar faltas:', e);
                return [];
            }
        };

        const atualizarMarcadores = async () => {
            const dataAtual = document.getElementById('dataChamada').value;
            ui.loading(true, 'Carregando frequência...');
            const faltasSalvas = await carregarFaltas(dataAtual);
            ui.loading(false);

            const totalFaltas = faltasSalvas.length;
            const totalPresentes = totalAlunos - totalFaltas;

            // Atualizar checkboxes e visual
            document.querySelectorAll('.falta-check').forEach(chk => {
                const isAbsent = faltasSalvas.includes(chk.dataset.alunoId);
                chk.checked = isAbsent;
                const card = document.getElementById(`card-aluno-${chk.dataset.alunoId}`);
                if (card) {
                    if (isAbsent) card.classList.add('absent');
                    else card.classList.remove('absent');
                }
            });

            // Atualizar contadores
            const marcadorPresentes = document.getElementById('marcadorPresentes');
            const marcadorFaltas = document.getElementById('marcadorFaltas');

            if (marcadorPresentes) marcadorPresentes.textContent = totalPresentes;
            if (marcadorFaltas) marcadorFaltas.textContent = totalFaltas;
        };


        container.innerHTML = `
            <div class="faltas-content">
                <!-- Header Moderno -->
                <div class="faltas-header-modern">
                    <div class="faltas-title-group">
                        <div class="faltas-title-icon">
                            <i class="bi bi-calendar-check-fill"></i>
                        </div>
                        <div class="faltas-title-text">
                            <h3>Frequência</h3>
                            <p class="text-secondary" style="margin: 2px 0 0 0; font-size: 0.9rem;">
                                <strong>${materia}</strong> 
                                <span style="opacity:0.5; margin:0 5px;">|</span> 
                                <i class="bi bi-person-video3"></i> ${nomeProfessor}
                                <span style="opacity:0.5; margin:0 5px;">|</span>
                                <i class="bi bi-building"></i> ${nomeEscola}
                            </p>
                        </div>
                    </div>

                    <div class="faltas-control-bar">
                        <div class="date-control">
                            <input type="date" id="dataChamada" value="${hoje}">
                        </div>

                        <div class="placar-modern">
                            <div class="placar-item presentes">
                                <div class="placar-dot"></div>
                                <span class="placar-count" id="marcadorPresentes">0</span>
                                <span class="placar-label">Presentes</span>
                            </div>
                            <div class="placar-item faltas">
                                <div class="placar-dot"></div>
                                <span class="placar-count" id="marcadorFaltas">0</span>
                                <span class="placar-label">Faltas</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Lista de Alunos (Grid) -->
                <div class="attendance-grid">
                    ${alunos.length > 0 ? alunos.map(aluno => `
                        <div class="student-attendance-card" id="card-aluno-${aluno.id}" onclick="document.getElementById('check-${aluno.id}').click()">
                            <div class="student-data">
                                <div class="student-mini-avatar">
                                    ${aluno.foto
                ? `<img src="${aluno.foto}">`
                : aluno.nome.charAt(0)}
                                </div>
                                <div class="student-names">
                                    <h4>${aluno.nome.split(' ')[0]} ${aluno.nome.split(' ')[1] || ''}</h4>
                                    <small>Mat: ${aluno.matricula || '-'}</small>
                                </div>
                            </div>
                            
                            <label class="attendance-toggle" onclick="event.stopPropagation()">
                                <input type="checkbox" class="falta-check" id="check-${aluno.id}" data-aluno-id="${aluno.id}">
                                <span class="slider"></span>
                            </label>
                        </div>
                    `).join('') : '<div class="empty-state"><p>Nenhum aluno encontrado para esta turma.</p></div>'}
                </div>

                <!-- Botão Flutuante Salvar -->
                <div class="save-bar-floating">
                    <button class="btn-floating-save" id="btnSalvarChamada">
                        <i class="bi bi-check2-circle"></i> Salvar Chamada
                    </button>
                </div>
            </div>
        `;

        // Carregar dados da data atual
        await atualizarMarcadores();

        // Atualizar marcadores ao marcar/desmarcar checkbox
        document.querySelectorAll('.falta-check').forEach(chk => {
            chk.addEventListener('change', (e) => {
                const isAbsent = e.target.checked;
                const card = document.getElementById(`card-aluno-${e.target.dataset.alunoId}`);
                if (card) {
                    if (isAbsent) card.classList.add('absent');
                    else card.classList.remove('absent');
                }

                const faltasAtuais = document.querySelectorAll('.falta-check:checked').length;
                const totalPresentes = totalAlunos - faltasAtuais;

                document.getElementById('marcadorPresentes').textContent = totalPresentes;
                document.getElementById('marcadorFaltas').textContent = faltasAtuais;
            });
        });

        // Event listener para mudar data
        document.getElementById('dataChamada')?.addEventListener('change', async () => {
            await atualizarMarcadores();
        });

        // Event listener para salvar e avançar
        document.getElementById('btnSalvarChamada')?.addEventListener('click', async () => {
            const dataInput = document.getElementById('dataChamada');
            const data = dataInput.value;

            ui.loading(true, 'Salvando chamada...');

            // Prepara presenças de TODOS os alunos
            const presencas = [];
            document.querySelectorAll('.falta-check').forEach(chk => {
                presencas.push({
                    alunoId: chk.dataset.alunoId,
                    presente: !chk.checked
                });
            });

            // Salvar no Backend
            const sucesso = await salvarFaltas(data, presencas);
            ui.loading(false);

            if (sucesso) {
                const faltasCount = presencas.filter(p => !p.presente).length;
                ui.success(`✅ Chamada salva e sincronizada! ${new Date(data + 'T00:00:00').toLocaleDateString('pt-BR')} - ${faltasCount} falta(s).`);

                // Avançar para o próximo dia? 
                // Talvez melhor deixar o usuário ver o feedback, mas vou manter a lógica original de avançar.
                // Mas geralmente professores lançam um dia por vez.
                const dataAtual = new Date(data + 'T00:00:00');
                dataAtual.setDate(dataAtual.getDate() + 1);
                dataInput.value = dataAtual.toISOString().split('T')[0];

                // Carregar dados do próximo dia
                await atualizarMarcadores();
            }
        });
    }

    async renderRelatorios(turmaId, bimestre, quinzenaOffset = 0) {
        const container = document.querySelector('.relatorios-container');
        if (!container) return;

        const params = new URLSearchParams(window.location.search);
        const materia = params.get('materia') || 'Sala Principal';

        // Calcular quinzena baseada no offset (0 = atual, -1 = anterior, +1 = próxima)
        const hoje = new Date();
        hoje.setDate(hoje.getDate() + (quinzenaOffset * 15)); // Mover 15 dias por vez

        const dias = [];
        for (let i = 0; i < 15; i++) {
            const d = new Date(hoje);
            d.setDate(hoje.getDate() - (14 - i));
            dias.push(d);
        }

        // Formatar período da quinzena
        const dataInicio = dias[0].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
        const dataFim = dias[14].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

        const boxesHtml = dias.map((data, index) => {
            const dia = data.getDate();
            const mes = data.toLocaleDateString('pt-BR', { month: 'long' });
            const ano = data.getFullYear();
            const dataKey = data.toISOString().split('T')[0];

            return `
                <div class="report-card">
                    <div class="report-card-header">
                        <div class="report-date-badge">
                            <span class="report-day">${dia}</span>
                        </div>
                        <div class="report-date-info">
                            <span class="report-month-year">${mes} de ${ano}</span>
                        </div>
                    </div>
                    <div class="report-card-body">
                        <textarea 
                            class="form-input relatorio-text" 
                            data-date="${dataKey}" 
                            rows="4" 
                            placeholder="Descreva as atividades e observações do dia..."
                        ></textarea>
                    </div>
                    <div class="report-card-footer">
                        <button class="btn btn-primary btn-salvar-individual" data-date="${dataKey}">
                            <i class="bi bi-check2-circle"></i> Salvar
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="relatorios-modern-layout">
                <div class="relatorios-header-card">
                    <div class="header-title">
                        <div class="icon-wrapper">
                            <i class="bi bi-journal-richtext"></i>
                        </div>
                        <div class="title-text">
                            <h3>Relatórios Diários</h3>
                            <p>${materia}</p>
                        </div>
                    </div>
                    
                    <div class="date-navigation">
                        <button class="btn btn-outline btn-sm btn-quinzena" id="btnQuinzenaAnterior">
                            <i class="bi bi-chevron-left"></i> Anterior
                        </button>
                        <div class="current-period">
                            <span class="period-badge">${dataInicio} - ${dataFim}</span>
                        </div>
                        <button class="btn btn-outline btn-sm btn-quinzena" id="btnQuinzenaSeguinte">
                            Próxima <i class="bi bi-chevron-right"></i>
                        </button>
                    </div>
                </div>

                <div class="relatorios-grid">
                    ${boxesHtml}
                </div>
                
                <div class="relatorios-bottom-bar">
                    <div class="autosave-info">
                        <i class="bi bi-arrow-repeat"></i>
                        <span><strong>Auto-save ativado:</strong> As alterações são salvas automaticamente após digitar.</span>
                    </div>
                    <button class="btn btn-success btn-salvar-todos" id="btnSalvarTodos">
                        <i class="bi bi-cloud-check-fill"></i> Salvar Todos os Registros
                    </button>
                </div>
            </div>
        `;

        // Sistema de persistência com API Backend
        const salvarRelatorio = async (data, texto, turmaId, materia) => {
            try {
                // Verificar se já existe relatório para este dia/turma/materia
                // Como não temos ID, buscamos primeiro? Ou o backend trata upsert?
                // Backend 'create' é insert. 'list' filtra.
                // Vamos tentar salvar novo. O ideal seria update se existe.
                // Para simplificar, vou buscar todos da API primeiro e ver se tem update.

                // Melhor abordagem: POST para criar ou atualizar (backend deve lidar, mas ReportController é simples CRUD)
                // Vou implementar Logica de Busca e Update aqui no front

                // Otimização: buscar apenas desta turma
                const reports = await db.getByIndex('relatorios', 'turma', turmaId);
                const existing = reports.find(r =>
                    r.turma === turmaId &&
                    r.materia === materia &&
                    new Date(r.data).toISOString().split('T')[0] === data
                );

                const payload = {
                    turma: turmaId,
                    materia: materia,
                    data: new Date(data),
                    conteudo: texto,
                    periodo: 'diario',
                    autor: auth.getCurrentUser()._id
                };

                if (existing) {
                    payload.id = existing.id || existing._id;
                    await db.update('relatorios', payload);
                    console.log('Relatório atualizado:', data);
                } else {
                    await db.insert('relatorios', payload);
                    console.log('Relatório criado:', data);
                }
                return true;
            } catch (e) {
                console.error('Erro ao salvar relatório:', e);
                return false;
            }
        };

        const carregarRelatorios = async () => {
            try {
                // Fetch only for this class (backend filtering)
                const reports = await db.getByIndex('relatorios', 'turma', turmaId);
                // Still filter by materia on client as getByIndex only supports one field usually
                return reports.filter(r => r.materia === materia);
            } catch (e) {
                console.error('Erro ao carregar relatórios:', e);
                return [];
            }
        };

        // Carregar dados salvos
        const relatoriosSalvos = await carregarRelatorios();

        document.querySelectorAll('.relatorio-text').forEach(textarea => {
            const data = textarea.dataset.date;
            const report = relatoriosSalvos.find(r => new Date(r.data).toISOString().split('T')[0] === data);
            if (report) {
                textarea.value = report.conteudo;
            }
        });

        // Auto-save ao digitar
        let saveTimeout;
        document.querySelectorAll('.relatorio-text').forEach(textarea => {
            textarea.addEventListener('input', (e) => {
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(async () => {
                    const data = e.target.dataset.date;
                    const texto = e.target.value;

                    // Salvar no Backend
                    const sucesso = await salvarRelatorio(data, texto, turmaId, materia);

                    // Feedback visual
                    if (sucesso) {
                        e.target.style.borderColor = '#4caf50';
                        setTimeout(() => { e.target.style.borderColor = '#555'; }, 1000);
                    } else {
                        e.target.style.borderColor = '#f44336';
                    }
                }, 2000);
            });
        });

        // Navegação entre quinzenas
        document.getElementById('btnQuinzenaAnterior')?.addEventListener('click', () => {
            this.renderRelatorios(turmaId, bimestre, quinzenaOffset - 1);
        });

        document.getElementById('btnQuinzenaSeguinte')?.addEventListener('click', () => {
            this.renderRelatorios(turmaId, bimestre, quinzenaOffset + 1);
        });

        // Botões de salvar individual
        document.querySelectorAll('.btn-salvar-individual').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const btnOriginal = e.currentTarget;
                const textoOriginal = btnOriginal.innerHTML;
                btnOriginal.innerHTML = '<i class="bi bi-hourglass-split"></i> ...';

                const data = e.currentTarget.dataset.date;
                const textarea = document.querySelector(`textarea[data-date="${data}"]`);
                const texto = textarea.value;

                const sucesso = await salvarRelatorio(data, texto, turmaId, materia);

                if (sucesso) {
                    btnOriginal.innerHTML = '<i class="bi bi-check-all"></i> Salvo!';
                    btnOriginal.style.background = 'linear-gradient(135deg, #3498db, #2980b9)';
                    setTimeout(() => {
                        btnOriginal.innerHTML = textoOriginal;
                        btnOriginal.style.background = 'linear-gradient(135deg, #27ae60, #229954)';
                    }, 2000);
                    ui.success(`✅ Relatório salvo!`);
                } else {
                    btnOriginal.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Erro';
                    btnOriginal.style.background = '#e74c3c';
                    ui.error('Erro ao salvar relatório.');
                }
            });
        });

        // Botão Salvar Todos
        document.getElementById('btnSalvarTodos')?.addEventListener('click', async () => {
            ui.loading(true, 'Salvando relatórios...');
            let contador = 0;
            const promises = [];

            document.querySelectorAll('.relatorio-text').forEach(textarea => {
                const data = textarea.dataset.date;
                const texto = textarea.value;
                if (texto.trim()) {
                    promises.push(salvarRelatorio(data, texto, turmaId, materia).then(res => {
                        if (res) contador++;
                    }));
                }
            });

            await Promise.all(promises);
            ui.loading(false);
            ui.success(`✅ ${contador} relatório(s) processados/salvos!`);
        });
    }

    /**
     * Trigger photo upload for specific student
     */
    triggerPhotoUpload(alunoId) {
        let input = document.getElementById('hiddenPhotoInput');
        if (!input) {
            input = document.createElement('input');
            input.type = 'file';
            input.id = 'hiddenPhotoInput';
            input.accept = 'image/*';
            input.style.display = 'none';
            document.body.appendChild(input);

            input.addEventListener('change', async (e) => {
                if (e.target.files && e.target.files[0]) {
                    const file = e.target.files[0];
                    const currentAlunoId = input.dataset.targetAlunoId;

                    try {
                        ui.loading(true, 'Salvando foto...');
                        const base64 = await this.fileToBase64(file);

                        // Update student in DB
                        const aluno = await students.getById(currentAlunoId);
                        if (aluno) {
                            aluno.foto = base64;
                            await students.update(aluno);

                            // Refresh Page
                            const params = new URLSearchParams(window.location.search);
                            const turmaId = params.get('turma');
                            const bimestre = parseInt(params.get('bim')) || 1;
                            const materia = params.get('materia') || 'Sala Principal';
                            await this.renderTurmaPage(turmaId, bimestre, materia);

                            ui.success('Foto atualizada com sucesso!');
                        }
                    } catch (e) {
                        console.error(e);
                        ui.error('Erro ao salvar foto.');
                    } finally {
                        ui.loading(false);
                        input.value = '';
                    }
                }
            });
        }
        input.dataset.targetAlunoId = alunoId;
        input.click();
    }

    /**
     * Confirma e exclui um aluno
     * @param {string} alunoId - ID do aluno
     * @param {string} alunoNome - Nome do aluno para exibição
     */
    async confirmDeleteAluno(alunoId, alunoNome) {
        const confirmado = confirm(`⚠️ ATENÇÃO!\n\nDeseja realmente excluir o aluno "${alunoNome}"?\n\nEsta ação é IRREVERSÍVEL e removerá:\n• Todos os dados do aluno\n• Todas as notas\n• Todas as faltas\n\nClique OK para confirmar.`);

        if (confirmado) {
            try {
                ui.loading(true, 'Excluindo aluno...');

                // Deleta do banco de dados
                await students.delete(alunoId);

                ui.success(`Aluno "${alunoNome}" excluído com sucesso!`);

                // Aguarda um pouco e recarrega
                setTimeout(() => {
                    location.reload();
                }, 1000);

            } catch (error) {
                console.error('Erro ao excluir aluno:', error);
                ui.error('Erro ao excluir aluno: ' + error.message);
                ui.loading(false);
            }
        }
    }


    // ... (ShowEditAlunoModal mantido igual até showNotasModal)

    /**
     * Exibe modal de notas do aluno
     * @param {number} alunoId - ID do aluno
     * @param {string} turmaId - ID da turma
     * @param {number} bimestre - Bimestre
     */


    /**
     * Helper: File to Base64 (com conversão para WebP)
     */
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    // Dimensões máximas
                    const maxSize = 800;
                    if (width > height && width > maxSize) {
                        height *= maxSize / width;
                        width = maxSize;
                    } else if (height > maxSize) {
                        width *= maxSize / height;
                        height = maxSize;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // Converte para WebP com 80% de qualidade
                    resolve(canvas.toDataURL('image/webp', 0.8));
                };
                img.onerror = error => reject(error);
                img.src = e.target.result;
            };
            reader.onerror = error => reject(error);
            reader.readAsDataURL(file);
        });
    }

    /**
     * Exibe modal para adicionar aluno
     * @param {string} turmaId - ID da turma
     */
    showAddAlunoModal(turmaId) {
        const content = `
            <form id="formAddAluno" class="form-aluno">
                <div class="form-group">
                    <label for="alunoNome">Nome Completo *</label>
                    <input type="text" id="alunoNome" class="form-input" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="alunoNascimento">Data de Nascimento</label>
                        <input type="date" id="alunoNascimento" class="form-input">
                    </div>
                    <div class="form-group">
                        <label for="alunoMatricula">Matrícula</label>
                        <input type="text" id="alunoMatricula" class="form-input" placeholder="Gerada automaticamente">
                    </div>
                </div>
                <div class="form-group">
                    <label for="alunoResponsavel">Responsável</label>
                    <input type="text" id="alunoResponsavel" class="form-input">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="alunoTelefone">Telefone</label>
                        <input type="tel" id="alunoTelefone" class="form-input">
                    </div>
                    <div class="form-group">
                        <label for="alunoEmail">Email</label>
                        <input type="email" id="alunoEmail" class="form-input">
                    </div>
                </div>
                <div class="form-group">
                    <label for="alunoDeficiencia">Deficiência/Necessidade Especial</label>
                    <input type="text" id="alunoDeficiencia" class="form-input" placeholder="Deixe em branco se não houver">
                </div>
                <div class="form-group">
                    <label for="alunoObservacoes">Observações</label>
                    <textarea id="alunoObservacoes" class="form-input" rows="3"></textarea>
                </div>
            </form>
        `;

        ui.showModal({
            id: 'modal-add-aluno',
            title: 'Adicionar Novo Aluno',
            content,
            size: 'medium',
            buttons: [
                {
                    text: 'Cancelar',
                    class: 'btn-secondary',
                    action: 'cancel',
                    onClick: () => ui.closeModal('modal-add-aluno')
                },
                {
                    text: 'Salvar',
                    class: 'btn-primary',
                    action: 'save',
                    onClick: async () => {
                        await this.saveNewAluno(turmaId);
                    }
                }
            ]
        });
    }

    /**
     * Salva novo aluno
     * @param {string} turmaId - ID da turma
     */
    async saveNewAluno(turmaId) {
        const nome = document.getElementById('alunoNome')?.value?.trim();

        if (!nome) {
            ui.error('Nome é obrigatório');
            return;
        }

        const alunoData = {
            nome,
            turmaId,
            dataNascimento: document.getElementById('alunoNascimento')?.value || '',
            matricula: document.getElementById('alunoMatricula')?.value || '',
            responsavel: document.getElementById('alunoResponsavel')?.value || '',
            telefone: document.getElementById('alunoTelefone')?.value || '',
            email: document.getElementById('alunoEmail')?.value || '',
            deficiencia: document.getElementById('alunoDeficiencia')?.value || '',
            observacoes: document.getElementById('alunoObservacoes')?.value || ''
        };

        try {
            await students.add(alunoData);
            ui.closeModal('modal-add-aluno');

            // Recarrega a página
            const params = new URLSearchParams(window.location.search);
            const bimestre = parseInt(params.get('bim')) || 1;
            await this.renderTurmaPage(turmaId, bimestre);
        } catch (error) {
            // Erro já tratado no módulo students
        }
    }

    /**
     * Exibe modal para editar aluno
     * @param {number} alunoId - ID do aluno
     */
    async showEditAlunoModal(alunoId) {
        const aluno = await students.getById(alunoId);
        if (!aluno) return;

        // Determine currest bimestre from URL
        const params = new URLSearchParams(window.location.search);
        const currentBimestre = parseInt(params.get('bim')) || 1;

        // Get Obs for current bimestre
        let obsVal = '';
        if (aluno.observacoesBimestre) {
            obsVal = aluno.observacoesBimestre[currentBimestre] || '';
        } else {
            obsVal = aluno.observacoes || '';
        }

        // Get Nivel for current bimestre
        let nivelVal = 'Nenhum';
        if (aluno.nivelBimestre) {
            nivelVal = aluno.nivelBimestre[currentBimestre] || 'Nenhum';
        }

        // Get Faltas for current bimester
        let faltasVal = 0;
        if (aluno.faltasBimestre) {
            faltasVal = aluno.faltasBimestre[currentBimestre] || 0;
        }

        const content = `
            <form id="formEditAluno" class="form-aluno">
                <div class="form-group">
                    <label>Foto do Aluno</label>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <div class="foto-preview" style="width:50px; height:50px; border-radius:50%; overflow:hidden; border:1px solid #ccc;">
                            ${aluno.foto ? `<img src="${aluno.foto}" style="width:100%; height:100%; object-fit:cover;">` : '<div style="width:100%; height:100%; background:#eee;"></div>'}
                        </div>
                        <input type="file" id="editAlunoFoto" class="form-input" accept="image/*">
                    </div>
                </div>
                <div class="form-group">
                    <label for="editAlunoNome">Nome Completo *</label>
                    <input type="text" id="editAlunoNome" class="form-input" value="${aluno.nome}" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="editAlunoNascimento">Data de Nascimento</label>
                        <input type="date" id="editAlunoNascimento" class="form-input" value="${aluno.dataNascimento}">
                    </div>
                    <div class="form-group">
                        <label for="editAlunoMatricula">Matrícula</label>
                        <input type="text" id="editAlunoMatricula" class="form-input" value="${aluno.matricula}">
                    </div>
                </div>
                <!-- ... other fields ... -->
                <div class="form-group">
                    <label>Descrição do Aluno (${currentBimestre}º Bimestre)</label>
                    <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                        <div style="flex: 1;">
                            <label style="font-size: 0.8rem; color: #aaa; margin-bottom: 2px; display: block;">Nível</label>
                            <select id="editAlunoNivel" class="form-input">
                                <option value="Nenhum" ${nivelVal === 'Nenhum' ? 'selected' : ''}>Nenhum</option>
                                <option value="1" ${nivelVal === '1' ? 'selected' : ''}>1</option>
                                <option value="2" ${nivelVal === '2' ? 'selected' : ''}>2</option>
                                <option value="3" ${nivelVal === '3' ? 'selected' : ''}>3</option>
                                <option value="4" ${nivelVal === '4' ? 'selected' : ''}>4</option>
                                <option value="PS" ${nivelVal === 'PS' ? 'selected' : ''}>🔴 PS (Pré-Silábico)</option>
                                <option value="S" ${nivelVal === 'S' ? 'selected' : ''}>🟡 S (Silábica)</option>
                                <option value="SCV" ${nivelVal === 'SCV' ? 'selected' : ''}>🟡 SCV (Silábica com Valor Sonoro)</option>
                                <option value="S/V/S" ${nivelVal === 'S/V/S' ? 'selected' : ''}>🟡 S/V/S (Silábica com Valor Sonoro)</option>
                                <option value="SA" ${nivelVal === 'SA' ? 'selected' : ''}>🔵 SA (Silábico-Alfabético)</option>
                                <option value="A" ${nivelVal === 'A' ? 'selected' : ''}>🟢 A (Alfabética)</option>
                            </select>
                        </div>
                        <div style="flex: 1;">
                            <label style="font-size: 0.8rem; color: #aaa; margin-bottom: 2px; display: block;">Faltas</label>
                            <input type="number" id="editAlunoFaltas" class="form-input" min="0" value="${faltasVal}" placeholder="Faltas no bimestre...">
                        </div>
                        <div style="flex: 1;">
                            <label style="font-size: 0.8rem; color: #aaa; margin-bottom: 2px; display: block;">Condição</label>
                            <select id="editAlunoCondicao" class="form-input" onchange="document.getElementById('editAlunoCondicaoOutroContainer').style.display = (this.value === 'Outros' ? 'block' : 'none')">
                                <option value="" ${!aluno.condicao ? 'selected' : ''}>Nenhuma</option>
                                <option value="TDAH" ${aluno.condicao === 'TDAH' ? 'selected' : ''}>TDAH</option>
                                <option value="TOD" ${aluno.condicao === 'TOD' ? 'selected' : ''}>TOD</option>
                                <option value="Autismo" ${aluno.condicao === 'Autismo' ? 'selected' : ''}>Autismo</option>
                                <option value="Outros" ${(aluno.condicao && !['TDAH', 'TOD', 'Autismo'].includes(aluno.condicao)) ? 'selected' : ''}>Outros</option>
                            </select>
                            <div id="editAlunoCondicaoOutroContainer" style="display: ${(aluno.condicao && !['TDAH', 'TOD', 'Autismo'].includes(aluno.condicao)) ? 'block' : 'none'}; margin-top: 5px;">
                                <input type="text" id="editAlunoCondicaoOutro" class="form-input" placeholder="Especifique a condição..." value="${(aluno.condicao && !['TDAH', 'TOD', 'Autismo'].includes(aluno.condicao)) ? aluno.condicao : ''}">
                            </div>
                        </div>
                    </div>
                    
                    <div style="margin-bottom: 15px; display: flex; gap: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e9ecef;">
                        <label style="display:flex; align-items:center; gap: 10px; cursor:pointer; flex: 1; user-select: none;">
                            <input type="checkbox" id="editAlunoRecupLP" style="transform: scale(1.6); cursor: pointer; margin: 5px;" ${(aluno.recuperacaoBimestre && aluno.recuperacaoBimestre[currentBimestre] && aluno.recuperacaoBimestre[currentBimestre].lp) ? 'checked' : ''}>
                            <span style="font-size:1rem; font-weight: 500; color: #333;">Recuperação em Português</span>
                        </label>
                        <label style="display:flex; align-items:center; gap: 10px; cursor:pointer; flex: 1; user-select: none;">
                            <input type="checkbox" id="editAlunoRecupMat" style="transform: scale(1.6); cursor: pointer; margin: 5px;" ${(aluno.recuperacaoBimestre && aluno.recuperacaoBimestre[currentBimestre] && aluno.recuperacaoBimestre[currentBimestre].mat) ? 'checked' : ''}>
                            <span style="font-size:1rem; font-weight: 500; color: #333;">Recuperação em Matemática</span>
                        </label>
                    </div>

                    <textarea id="editAlunoObservacoes" class="form-input" rows="3" placeholder="Digite a descrição do aluno neste bimestre...">${obsVal}</textarea>
                    <small class="text-secondary">Estes dados são específicos para o ${currentBimestre}º bimestre.</small>
                </div>
            </form>
        `;

        ui.showModal({
            id: 'modal-edit-aluno',
            title: 'Editar Aluno',
            content,
            size: 'medium',
            buttons: [
                {
                    text: 'Cancelar',
                    class: 'btn-secondary',
                    action: 'cancel',
                    onClick: () => ui.closeModal('modal-edit-aluno')
                },
                {
                    text: 'Salvar',
                    class: 'btn-primary',
                    action: 'save',
                    onClick: async () => {
                        await this.saveEditedAluno(alunoId, currentBimestre);
                    }
                }
            ]
        });
    }

    async saveEditedAluno(alunoId, bimestre) {
        const aluno = await students.getById(alunoId);
        if (!aluno) return;

        aluno.nome = document.getElementById('editAlunoNome').value;
        aluno.dataNascimento = document.getElementById('editAlunoNascimento').value;
        aluno.matricula = document.getElementById('editAlunoMatricula').value;

        // Handle Photo
        const fileInput = document.getElementById('editAlunoFoto');
        if (fileInput && fileInput.files[0]) {
            aluno.foto = await this.fileToBase64(fileInput.files[0]);
        }

        const newObs = document.getElementById('editAlunoObservacoes').value;
        const newNivel = document.getElementById('editAlunoNivel').value;
        const newFaltas = parseInt(document.getElementById('editAlunoFaltas').value) || 0;
        let newCondicao = document.getElementById('editAlunoCondicao').value;
        const newCondicaoOutro = document.getElementById('editAlunoCondicaoOutro').value;
        const newRecupLP = document.getElementById('editAlunoRecupLP').checked;
        const newRecupMat = document.getElementById('editAlunoRecupMat').checked;

        // If 'Outros' is selected, use the text input value
        if (newCondicao === 'Outros') {
            newCondicao = newCondicaoOutro;
        }

        if (!aluno.observacoesBimestre) aluno.observacoesBimestre = {};
        if (!aluno.nivelBimestre) aluno.nivelBimestre = {};
        if (!aluno.recuperacaoBimestre) aluno.recuperacaoBimestre = {};
        if (!aluno.faltasBimestre) aluno.faltasBimestre = {};

        aluno.observacoesBimestre[bimestre] = newObs;
        aluno.nivelBimestre[bimestre] = newNivel;
        aluno.recuperacaoBimestre[bimestre] = { lp: newRecupLP, mat: newRecupMat };
        aluno.faltasBimestre[bimestre] = newFaltas;

        // Save Condition Globally
        if (newCondicao) {
            aluno.condicao = newCondicao;
            // Also sync deficiencia for legacy support if needed
            aluno.deficiencia = newCondicao;
        } else {
            aluno.condicao = '';
            aluno.deficiencia = '';
        }

        // Sync disabled to enforce strict per-bimester separation
        // aluno.observacoes = newObs;

        await students.update(aluno);
        ui.closeModal('modal-edit-aluno');

        // Reload
        const params = new URLSearchParams(window.location.search);
        await this.renderTurmaPage(aluno.turmaId, bimestre);
    }

    /**
     * Exibe modal de notas do aluno
     * @param {number} alunoId - ID do aluno
     * @param {string} turmaId - ID da turma
     * @param {number} bimestre - Bimestre
     */
    async showNotasModal(alunoId, turmaId, bimestre, materia = 'Sala Principal') {
        const aluno = await students.getById(alunoId);
        let notasAluno = await notes.getByAlunoBimestre(alunoId, bimestre);

        // Filter by materia if not Sala Principal
        if (materia !== 'Sala Principal') {
            notasAluno = notasAluno.filter(n => n.materiaId === materia);
        }

        const materias = db.getMaterias();
        const tiposAvaliacao = db.getTiposAvaliacao();

        const content = `
            <div class="notas-modal">
                <div class="notas-header">
                    <h4>${aluno.nome}</h4>
                    <p>Turma ${turmaId} - ${bimestre}º Bimestre</p>
                </div>

                <div class="notas-add">
                    <h5>Adicionar Nova Avaliação</h5>
                    <form id="formAddNota" class="form-nota">
                        <div class="form-row">
                            <div class="form-group">
                                <label>Matéria *</label>
                                <select id="notaMateria" class="form-input" required>
                                    <option value="">Selecione...</option>
                                    ${materias.map(m => {
            const selected = (materia !== 'Sala Principal' && (m.nome === materia || m.id === materia)) ? 'selected' : '';
            return `<option value="${m.id}" ${selected}>${m.icone} ${m.nome}</option>`;
        }).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Tipo *</label>
                                <select id="notaTipo" class="form-input" required>
                                    ${tiposAvaliacao.map(t => `<option value="${t.id}" data-peso="${t.pesoDefault}">${t.nome}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label>Nota (0-10) *</label>
                                <input type="number" id="notaValor" class="form-input" min="0" max="10" step="0.1" required>
                            </div>
                            <div class="form-group">
                                <label>Peso</label>
                                <input type="number" id="notaPeso" class="form-input" min="1" max="5" value="1">
                            </div>
                            <div class="form-group">
                                <label>Data</label>
                                <input type="date" id="notaData" class="form-input" value="${new Date().toISOString().split('T')[0]}">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Descrição</label>
                            <input type="text" id="notaDescricao" class="form-input" placeholder="Ex: Prova de Matemática">
                        </div>
                        <button type="submit" class="btn btn-primary">Adicionar Nota</button>
                    </form>
                </div>

                <div class="notas-lista">
                    <h5>Notas Registradas</h5>
                    ${notasAluno.length === 0
                ? '<p class="empty-notas">Nenhuma nota registrada neste bimestre.</p>'
                : `<table class="table-notas">
                            <thead>
                                <tr>
                                    <th>Matéria</th>
                                    <th>Tipo</th>
                                    <th>Descrição</th>
                                    <th>Nota</th>
                                    <th>Peso</th>
                                    <th>Data</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${notasAluno.map(nota => {
                    const materia = materias.find(m => m.id === nota.materiaId);
                    return `
                                        <tr data-nota-id="${nota.id}">
                                            <td>${materia?.icone || ''} ${materia?.nome || nota.materiaId}</td>
                                            <td>${nota.tipo}</td>
                                            <td>${nota.descricao || '-'}</td>
                                            <td class="${ui.getNotaClass(nota.nota)}">${ui.formatNota(nota.nota)}</td>
                                            <td>${nota.peso}</td>
                                            <td>${ui.formatDate(nota.data)}</td>
                                            <td>
                                                <button class="btn-icon btn-delete-nota" data-nota-id="${nota.id}">🗑️</button>
                                            </td>
                                        </tr>
                                    `;
                }).join('')}
                            </tbody>
                        </table>`
            }
                </div>
            </div>
        `;

        const modal = ui.showModal({
            id: 'modal-notas',
            title: 'Gerenciar Notas',
            content,
            size: 'large',
            buttons: [
                {
                    text: 'Fechar',
                    class: 'btn-secondary',
                    action: 'close',
                    onClick: () => {
                        ui.closeModal('modal-notas');
                        // Recarrega tabela para atualizar médias
                        this.renderTurmaPage(turmaId, bimestre);
                    }
                }
            ]
        });

        // Eventos do modal
        document.getElementById('formAddNota')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.addNota(alunoId, turmaId, bimestre, materia);
        });

        // Atualiza peso ao mudar tipo
        document.getElementById('notaTipo')?.addEventListener('change', (e) => {
            const peso = e.target.selectedOptions[0]?.dataset.peso || 1;
            document.getElementById('notaPeso').value = peso;
        });

        // Excluir nota
        modal.querySelectorAll('.btn-delete-nota').forEach(btn => {
            btn.addEventListener('click', async () => {
                const notaId = parseInt(btn.dataset.notaId);
                const confirmado = await ui.confirm('Deseja realmente excluir esta nota?');
                if (confirmado) {
                    await notes.delete(notaId);
                    // Recarrega modal
                    ui.closeModal('modal-notas');
                    this.showNotasModal(alunoId, turmaId, bimestre, materia);
                }
            });
        });
    }

    /**
     * Adiciona nova nota
     * @param {number} alunoId - ID do aluno
     * @param {string} turmaId - ID da turma
     * @param {number} bimestre - Bimestre
     */
    async addNota(alunoId, turmaId, bimestre, currentMateria = 'Sala Principal') {
        const materiaId = document.getElementById('notaMateria')?.value;
        const tipo = document.getElementById('notaTipo')?.value;
        const valor = document.getElementById('notaValor')?.value;

        if (!materiaId || !tipo || valor === '') {
            ui.error('Preencha todos os campos obrigatórios');
            return;
        }

        try {
            await notes.add({
                alunoId,
                turmaId,
                materiaId,
                bimestre,
                tipo,
                nota: parseFloat(valor),
                peso: parseInt(document.getElementById('notaPeso')?.value) || 1,
                data: document.getElementById('notaData')?.value || new Date().toISOString().split('T')[0],
                descricao: document.getElementById('notaDescricao')?.value || ''
            });

            // Recarrega modal
            ui.closeModal('modal-notas');
            this.showNotasModal(alunoId, turmaId, bimestre, currentMateria);
        } catch (error) {
            // Erro já tratado
        }
    }

    /**
     * Confirma exclusão de aluno
     * @param {number} alunoId - ID do aluno
     * @param {string} turmaId - ID da turma
     * @param {number} bimestre - Bimestre
     */
    async confirmarExclusaoAluno(alunoId, turmaId, bimestre) {
        const aluno = await students.getById(alunoId);
        const confirmado = await ui.confirm(
            `Deseja realmente excluir o aluno "${aluno.nome}"? Esta ação não pode ser desfeita.`,
            { title: 'Confirmar Exclusão', confirmText: 'Excluir', confirmClass: 'btn-danger' }
        );

        if (confirmado) {
            await students.delete(alunoId);
            await this.renderTurmaPage(turmaId, bimestre);
        }
    }

    /**
     * Processa logout
     */
    handleLogout() {
        auth.logout();
        ui.success('Logout realizado com sucesso!');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1000);
    }

    /**
     * Inicializa página de direção
     */
    async initDirecaoPage() {
        if (!auth.requireAuth()) return;
        // Lógica específica da direção será carregada do módulo direcao.js
    }

    /**
     * Inicializa página de gráficos
     */
    async initGraficosPage() {
        if (!auth.requireAuth()) return;
        // Lógica específica de gráficos será carregada do módulo graficos.js
    }
}

// Inicializa aplicação quando DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.init();
});

// Exporta para uso em outros módulos
export default App;
