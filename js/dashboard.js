/**
 * Dashboard Script
 */

// === MAPEAMENTO PROFESSOR → CHAVE DO HORÁRIO ===
/**
 * Deriva a chave do sistema de horários a partir dos dados do perfil do professor.
 * Retorna null se o professor for PEB1 (não tem horário especialista).
 */
function getProfessorKeyFromPerfil(perfil) {
    if (!perfil) return null;
    const nome = (perfil.nome || '').toUpperCase();
    const disc = (perfil.disciplina || '').toUpperCase();
    const esp  = perfil.tipoEspecial;

    // Nomes exatos dos professores especialistas
    if (nome.includes('MARJORIE'))                         return 'MARJORIE';
    if (nome.includes('MARCOS') && (esp || disc.includes('FÍS') || disc.includes('FIS'))) return 'MARCOS';
    if (nome.includes('BIANCA'))                           return 'ARTES1ANO';
    if (nome.includes('MIRIAM'))                           return 'MIRIAM';
    if (nome.includes('SIRLENE'))                          return 'OFMAKER';
    if (nome.includes('CHERLANE'))                         return 'OFSEBRAE';
    if (nome.includes('LIMA') && esp)                      return 'LIMA';

    // Raquel — diferencia pela disciplina
    if (nome.includes('RAQUEL') && disc.includes('LEITURA')) return 'OFLEITURA';
    if (nome.includes('CASTELANELI'))                      return 'OFLEITURA';
    if (nome.includes('PIPOCA'))                           return 'OFLEITURA';

    // Marcelo — Inglês
    if (nome.includes('MARCELO') || disc.includes('INGL')) return 'INGLS';

    // Fallback por disciplina
    if (disc.includes('ED. FÍS') || disc.includes('ED. FIS') || disc.includes('EDUCAÇÍO FÍSICA')) {
        if (esp) return 'MARJORIE'; // fallback para Marjorie se não identificado pelo nome
    }
    if (disc.includes('ARTES') && esp) return 'MIRIAM';
    if (disc.includes('MAKER') && esp) return 'OFMAKER';
    if (disc.includes('LEITURA') && esp) return 'OFLEITURA';
    if ((disc.includes('SEBRAE') || disc.includes('EMOCIONAL')) && esp) return 'OFSEBRAE';

    return null; // PEB1 ou sem mapeamento
}

// === INICIALIZAÇÍO ===
document.addEventListener('DOMContentLoaded', async () => {
    await db.init();
    await auth.init();

    // Verifica autenticação
    if (!auth.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    // Verifica se precisa mudar a senha obrigatoriamente
    if (sessionStorage.getItem('forcePasswordChange') === 'true') {
        window.location.href = 'mudar-senha.html';
        return;
    }

    await carregarDados();
});

// === CARREGAR DADOS ===
async function carregarDados() {
    try {
        const user = auth.getCurrentUser();

        // Busca perfil completo (exceto admin)
        let perfil;
        if (user.perfil === 'professor') {
            // Tenta buscar por idUsuario primeiro
            perfil = await db.findByIndex('professores', 'idUsuario', user._id || user.id);

            // Se não encontrar, busca por email
            if (!perfil && user.email) {
                const todos = await db.getAll('professores');
                perfil = todos.find(p => p.email === user.email);
            }

            console.log('📌 Dashboard - Professor encontrado:', perfil ? perfil.nome : 'NÃO ENCONTRADO');

            // Se não encontrar perfil estendido, usa dados básicos do login
            if (!perfil) {
                console.warn('⚠️ Perfil estendido de professor não encontrado. Usando dados do login.');
                perfil = { nome: user.nome };
            }
        } else if (user.perfil === 'diretor') {
            perfil = await db.findByIndex('diretores', 'idUsuario', user._id || user.id);

            // Fallback por email
            if (!perfil && user.email) {
                const todos = await db.getAll('diretores');
                perfil = todos.find(d => d.email === user.email);
            }

            // Se não encontrar perfil estendido, usa dados básicos do login
            if (!perfil) {
                console.warn('⚠️ Perfil estendido de diretor não encontrado. Usando dados do login.');
                perfil = { nome: user.nome };
            }
        } else if (user.perfil === 'admin') {
            // Admin não precisa buscar perfil adicional
            perfil = { nome: user.nome };
        }

        // Atualiza UI
        atualizarHeader(user, perfil);
        atualizarWelcome(user, perfil);
        atualizarCards(user, perfil);
        setupSecurityPanel(user);

    } catch (error) {
        console.error('Erro ao carregar dados:', error);
        showToast('Erro ao carregar dados', 'error');
    }
}

// === ATUALIZAR HEADER ===
function atualizarHeader(user, perfil) {
    const nomeExibir = (perfil && perfil.nome) ? perfil.nome : (user.nome || user.email);

    // Role baseada no perfil
    const roleLabel = user.perfil === 'admin' ? 'Administrador'
        : user.perfil === 'professor' ? 'Professor'
        : 'Diretor';

    // Foto (perfil.foto > user.fotoGoogle > fallback)
    const foto = (perfil && perfil.foto) ? perfil.foto : (user.fotoGoogle || '');

    // === ATUALIZAR SIDEBAR (foto, nome e role) ===
    const sidebarAvatar = document.getElementById('sidebarAvatar');
    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarUserRole = document.getElementById('sidebarUserRole');

    if (sidebarAvatar) sidebarAvatar.src = foto || '/img/default-avatar.png';
    if (sidebarUserName) sidebarUserName.textContent = nomeExibir;
    if (sidebarUserRole) sidebarUserRole.textContent = roleLabel;
}

// === ATUALIZAR WELCOME ===
function atualizarWelcome(user, perfil) {
    const welcomeTitle = document.getElementById('welcomeTitle');
    const welcomeMessage = document.getElementById('welcomeMessage');

    const primeiroNome = (perfil && perfil.nome) ? perfil.nome.split(' ')[0] :
        (user.nome ? user.nome.split(' ')[0] : 'Usuário');

    welcomeTitle.textContent = `Olá, ${primeiroNome}! 👋`;

    if (user.perfil === 'admin') {
        welcomeMessage.textContent = 'Você tem acesso total ao sistema como Administrador.';
    } else if (user.perfil === 'professor') {
        welcomeMessage.textContent = 'Pronto para gerenciar suas turmas e atividades.';
    } else {
        welcomeMessage.textContent = 'Acesse todas as ferramentas administrativas da escola.';
    }
}

// === ATUALIZAR CARDS ===
async function atualizarCards(user, perfil) {
    const turmasCount = document.getElementById('turmasCount');
    const cardGerencial = document.getElementById('cardGerencial');
    const cardFerramentas = document.getElementById('cardFerramentas');
    const cardListaProfessores = document.getElementById('cardListaProfessores');
    const cardGestaoGrade = document.getElementById('cardGestaoGrade');
    const cardGerenciarSalas = document.getElementById('cardGerenciarSalas');
    const cardHorariosDir = document.getElementById('cardHorariosDir');
    const cardListaAlunos = document.getElementById('cardListaAlunos');
    const cardNotificacoesResp = document.getElementById('cardNotificacoesResp');

    const cardSecretCodes = document.getElementById('cardSecretCodes');

    if (user.perfil === 'admin') {
        // Admin vê tudo
        if (turmasCount) turmasCount.textContent = 'Todas';
        if (cardGerencial) cardGerencial.style.display = 'flex';
        if (cardFerramentas) cardFerramentas.style.display = 'flex';
        const cardContas = document.getElementById('cardContasAdmin');
        if (cardContas) cardContas.style.display = 'flex';
        if (cardGestaoGrade) cardGestaoGrade.style.display = 'flex';
        if (cardListaProfessores) cardListaProfessores.style.display = 'flex';
        if (cardGerenciarSalas) cardGerenciarSalas.style.display = 'flex';
        if (cardHorariosDir) cardHorariosDir.style.display = 'flex';
        if (cardListaAlunos) cardListaAlunos.style.display = 'flex';
        if (cardNotificacoesResp) cardNotificacoesResp.style.display = 'flex';
        if (cardSecretCodes) cardSecretCodes.style.display = 'flex';
    } else if (user.perfil === 'professor' && perfil) {
        // ... (existing teacher logic) ...
        const principal = perfil.salaPrincipal || '';
        const adicionais = Array.isArray(perfil.salasAdicionais) ? perfil.salasAdicionais : [];
        const turmas = principal ? [principal, ...adicionais] : adicionais;

        if (turmasCount) turmasCount.textContent = turmas.length;

        // Professor não vê ferramentas nem lista de professores
        if (cardFerramentas) cardFerramentas.style.display = 'none';
        if (cardGestaoGrade) cardGestaoGrade.style.display = 'none';
        if (cardListaProfessores) cardListaProfessores.style.display = 'none';
        if (cardGerenciarSalas) cardGerenciarSalas.style.display = 'none';
        if (cardGerencial) cardGerencial.style.display = 'none';
        if (cardListaAlunos) cardListaAlunos.style.display = 'none';
        if (cardNotificacoesResp) cardNotificacoesResp.style.display = 'none';
        if (cardSecretCodes) cardSecretCodes.style.display = 'none';

        // Sempre mostra Meu Horário — especialista (prof=KEY) ou PEB1 (sala=TURMA)
        const profKey        = getProfessorKeyFromPerfil(perfil);
        const cardMeuHorario = document.getElementById('cardMeuHorario');
        const btnMeuHorario  = document.getElementById('btnMeuHorario');
        const sidebarHorario = document.getElementById('sidebar-horario');

        if (sidebarHorario) {
            sidebarHorario.style.display = 'flex';
            if (profKey) {
                sidebarHorario.href = `meu-horario.html?prof=${encodeURIComponent(profKey)}`;
            } else if (principal) {
                sidebarHorario.href = `meu-horario.html?sala=${encodeURIComponent(principal)}`;
            } else if (turmas.length > 0) {
                sidebarHorario.href = `meu-horario.html?sala=${encodeURIComponent(turmas[0])}`;
            } else {
                sidebarHorario.href = `direcao/horario-jaguari.html`;
            }
        }

        if (cardMeuHorario) {
            cardMeuHorario.style.display = 'flex';
            // ... (rest of card logic if still needed, but sidebar is priority)
        }

    } else if (user.perfil === 'diretor') {
        const directorSummary = document.getElementById('directorDashboardSummary');
        const directorActivity = document.getElementById('directorActivityGrid');
        
        // Exibe nova área de resumo
        if (directorSummary) directorSummary.style.display = 'grid';
        if (directorActivity) directorActivity.style.display = 'grid';

        // Oculta cards antigos para o Diretor (solicitação do usuário)
        if (cardGerencial) cardGerencial.style.display = 'none';
        if (cardHorariosDir) cardHorariosDir.style.display = 'none';
        if (cardListaProfessores) cardListaProfessores.style.display = 'none';
        if (cardGerenciarSalas) cardGerenciarSalas.style.display = 'none';
        if (cardListaAlunos) cardListaAlunos.style.display = 'none';
        if (cardNotificacoesResp) cardNotificacoesResp.style.display = 'none';
        if (cardSecretCodes) cardSecretCodes.style.display = 'none';
        
        // Diretor não vê ferramentas
        if (cardFerramentas) cardFerramentas.style.display = 'none';

        // Carregar dados reais para o resumo do diretor
        await carregarResumoDiretor();
    }

    // --- ATUALIZAR VISIBILIDADE DA SIDEBAR ---
    atualizarVisibilidadeSidebar(user.perfil);
}

// === CARREGA ESTATÍSTICAS DO DIRETOR ===
async function carregarResumoDiretor() {
    try {
        const response = await fetch(`${window.API_BASE_URL}/dashboard/summary`, { credentials: 'include' });
        const json = await response.json();

        if (json.success) {
            const data = json.data;
            animateValue('stat-total-alunos', 0, data.totalAlunos || 0, 1000);
            animateValue('stat-total-professores', 0, data.totalProfessores || 0, 1000);
            animateValue('stat-total-turmas', 0, data.totalTurmas || 0, 1000);
        }

        // Carregar últimos avisos
        const resNotices = await fetch(`${window.API_BASE_URL}/dashboard/summary/notices`, { credentials: 'include' });
        const jsonNotices = await resNotices.json();
        
        if (jsonNotices.success) {
            atualizarListaAvisosMini(jsonNotices.data.slice(0, 5));
        }

        // Mock de atividades (pode ser expandido futuramente)
        atualizarGridAtividade();

    } catch (error) {
        console.warn('Erro ao carregar resumo do diretor:', error);
    }
}

function atualizarVisibilidadeSidebar(perfil) {
    const directorItems = document.querySelectorAll('.director-only');
    const teacherItems = document.querySelectorAll('.teacher-only');

    if (perfil === 'diretor' || perfil === 'admin') {
        directorItems.forEach(el => el.style.display = 'flex');
        teacherItems.forEach(el => el.style.display = 'none');
    } else if (perfil === 'professor') {
        directorItems.forEach(el => el.style.display = 'none');
        teacherItems.forEach(el => el.style.display = 'flex');
    }
}

function animateValue(id, start, end, duration) {
    const obj = document.getElementById(id);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start);
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}

function atualizarListaAvisosMini(notices) {
    const list = document.getElementById('latestNoticesList');
    if (!list || notices.length === 0) return;

    list.innerHTML = notices.map(n => `
        <div class="activity-item-mini">
            <div class="activity-dot" style="background: #10b981;"></div>
            <div class="activity-text">
                <strong>${n.titulo}</strong>
                <span class="activity-time">${new Date(n.dataCriacao).toLocaleDateString('pt-BR')}</span>
            </div>
        </div>
    `).join('');
}

function atualizarGridAtividade() {
    const list = document.getElementById('recentActivityList');
    if (!list) return;

    // Mock para visual inicial premium
    const activities = [
        { text: 'Novo professor cadastrado: Marcos Silva', time: 'Há 2 horas', color: '#3b82f6' },
        { text: 'Relatório mensal de frequência gerado', time: 'Há 5 horas', color: '#10b981' },
        { text: 'Aviso enviado para a Turma 2º Ano A', time: 'Ontem às 18:30', color: '#f59e0b' }
    ];

    list.innerHTML = activities.map(a => `
        <div class="activity-item-mini">
            <div class="activity-dot" style="background: ${a.color};"></div>
            <div class="activity-text">
                ${a.text}
                <span class="activity-time">${a.time}</span>
            </div>
        </div>
    `).join('');
}



// === CONFIGURAR PAINEL DE SEGURANÇA ===
async function setupSecurityPanel(user) {
    const securityPanel = document.getElementById('securityPanel');
    const codeDisplay = document.getElementById('dashboardDailyCode');
    const btnAuditoria = document.getElementById('btnAuditoriaDash');

    if (!securityPanel) return;

    // Apenas Admin e Diretor vêem o painel
    if (user.perfil === 'admin' || user.perfil === 'diretor') {
        securityPanel.style.display = 'block';

        // Admin vê botão de auditoria, Diretor não
        if (user.perfil === 'admin' && btnAuditoria) {
            btnAuditoria.style.display = 'inline-flex';
        }

        // Busca o código na API
        try {
            const res = await fetch(`${window.API_BASE_URL}/security/status`, { credentials: 'include' });
            const json = await res.json();
            if (json.success && codeDisplay) {
                codeDisplay.setAttribute('data-code', json.data.codigo);
                codeDisplay.innerText = '••••••'; // Mantém oculto por padrão
            }
        } catch (e) {
            console.error('Erro ao buscar código de segurança:', e);
            if (codeDisplay) codeDisplay.innerText = 'ERRO';
        }
    } else {
        securityPanel.style.display = 'none';
    }
}

// === TRATAMENTO DE ERROS GLOBAL ===
window.onerror = function (msg, url, lineNo, columnNo, error) {
    const errorMsg = `Erro no Dashboard: ${msg}\nLinha: ${lineNo}\nURL: ${url}`;
    console.error(errorMsg, error);
    if (typeof showToast === 'function') {
        showToast('Erro interno no Dashboard. Verifique o console.', 'error');
    }
    return false;
};

// === NAVEGAÇÍO ===
window.irParaTurmas = function () {
    console.log('🚀 Navegando para turmas...');
    const user = auth.getCurrentUser();

    if (!user) {
        console.error('❌ Usuário não encontrado no auth');
        window.location.href = 'login.html';
        return;
    }

    if (user.perfil === 'diretor') {
        window.location.href = 'selecionar.html';
    } else {
        window.location.href = 'selecionar.html';
    }
};

window.verPerfil = function () {
    window.location.href = 'perfil.html';
};

window.verRelatorios = function () {
    window.location.href = 'direcao/index.html';
};

window.abrirFerramentas = function () {
    const user = auth.getCurrentUser();

    if (!user || user.perfil !== 'admin') {
        if (typeof showToast === 'function') {
            showToast('Acesso negado. Apenas administradores podem acessar as ferramentas.', 'error');
        }
        return;
    }

    window.location.href = 'admin/configuracoes.html';
};

// Preferências de voz agora são gerenciadas por sidebar-voice.js (initVoiceToggles)

window.sair = async function () {
    const confirmacao = confirm('Deseja realmente sair do sistema?');
    if (confirmacao) {
        try {
            await auth.logout();
        } catch (error) {
            console.error('Erro ao sair:', error);
            sessionStorage.clear();
            window.location.href = 'login.html';
        }
    }
};
