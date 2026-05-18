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
        window.location.href = 'index.html';
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

            console.log('📌 Dashboard - Professor encontrado:', perfil ? perfil.nome : 'NÍO ENCONTRADO');
        } else if (user.perfil === 'diretor') {
            perfil = await db.findByIndex('diretores', 'idUsuario', user._id || user.id);

            // Fallback por email
            if (!perfil && user.email) {
                const todos = await db.getAll('diretores');
                perfil = todos.find(d => d.email === user.email);
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
    const userName = document.getElementById('userName');
    const userRole = document.getElementById('userRole');
    const userAvatar = document.getElementById('userAvatar');

    if (perfil && perfil.nome) {
        userName.textContent = perfil.nome;
    } else if (user.nome) {
        userName.textContent = user.nome;
    } else {
        userName.textContent = user.email;
    }

    // Role baseada no perfil
    if (user.perfil === 'admin') {
        userRole.textContent = 'Administrador';
    } else if (user.perfil === 'professor') {
        userRole.textContent = 'Professor';
    } else {
        userRole.textContent = 'Diretor';
    }

    // Foto
    const foto = perfil && perfil.foto ? perfil.foto : (user.fotoGoogle || '');
    if (foto) {
        userAvatar.innerHTML = `<img src="${foto}" alt="Avatar">`;
    }
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

        // Sempre mostra Meu Horário — especialista (prof=KEY) ou PEB1 (sala=TURMA)
        const profKey        = getProfessorKeyFromPerfil(perfil);
        const cardMeuHorario = document.getElementById('cardMeuHorario');
        const btnMeuHorario  = document.getElementById('btnMeuHorario');

        if (cardMeuHorario) {
            cardMeuHorario.style.display = 'flex';

            if (btnMeuHorario) {
                if (profKey) {
                    // Professor especialista → visualiza por chave de professor
                    btnMeuHorario.onclick = () => {
                        window.location.href = `meu-horario.html?prof=${encodeURIComponent(profKey)}`;
                    };
                } else if (principal) {
                    // Professor de sala regular → visualiza horário da sua sala (PEB1)
                    btnMeuHorario.onclick = () => {
                        window.location.href = `meu-horario.html?sala=${encodeURIComponent(principal)}`;
                    };
                } else if (turmas.length > 0) {
                    // Fallback: usa primeira sala atribuída
                    btnMeuHorario.onclick = () => {
                        window.location.href = `meu-horario.html?sala=${encodeURIComponent(turmas[0])}`;
                    };
                } else {
                    // Sem sala definida: abre grade geral para visualização
                    btnMeuHorario.onclick = () => {
                        window.location.href = `direcao/horario-jaguari.html`;
                    };
                }
            }
        }

    } else if (user.perfil === 'diretor') {
        // Diretor vê todas as turmas e relatórios
        if (turmasCount) turmasCount.textContent = 'Todas';
        if (cardGerencial) cardGerencial.style.display = 'flex';
        if (cardHorariosDir) cardHorariosDir.style.display = 'flex';
        if (cardListaProfessores) cardListaProfessores.style.display = 'flex';
        if (cardGerenciarSalas) cardGerenciarSalas.style.display = 'flex';
        if (cardListaAlunos) cardListaAlunos.style.display = 'flex';
        if (cardNotificacoesResp) cardNotificacoesResp.style.display = 'flex';
        // Diretor não vê ferramentas
        if (cardFerramentas) cardFerramentas.style.display = 'none';
    }
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
            const res = await fetch(`${window.API_BASE_URL}/security/status`);
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
        window.location.href = 'index.html';
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

window.sair = async function () {
    const confirmacao = confirm('Deseja realmente sair do sistema?');
    if (confirmacao) {
        try {
            await auth.logout();
        } catch (error) {
            console.error('Erro ao sair:', error);
            sessionStorage.clear();
            window.location.href = 'index.html';
        }
    }
};
