/**
 * Dashboard Script
 */

// ============================================
// ESCAPE DE HTML
// ============================================
// Este arquivo injeta em innerHTML títulos de notificação, nomes de insígnia e
// a resposta da IA — todos dados vindos do servidor. Um deles (`title="${...}"`)
// cai DENTRO de atributo, onde escapar aspas é obrigatório.
// Local, para não depender da ordem de carregamento dos <script>.
// Ver js/escape-html.js.
const _ESC_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '`': '&#96;',
};
function escHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/[&<>"'`]/g, (c) => _ESC_MAP[c]);
}

// === MAPEAMENTO PROFESSOR → CHAVE DO HORÁRIO ===
/**
 * Deriva a chave do sistema de horários a partir dos dados do perfil do professor.
 * Retorna null se o professor for PEB1 (não tem horário especialista).
 */
function getProfessorKeyFromPerfil(perfil) {
    if (!perfil) return null;
    const nome = (perfil.nome || '').toUpperCase();
    const disc = (perfil.disciplina || '').toUpperCase();
    const esp = perfil.tipoEspecial;

    // Nomes exatos dos professores especialistas
    if (nome.includes('MARJORIE')) return 'MARJORIE';
    if (nome.includes('MARCOS') && (esp || disc.includes('FÍS') || disc.includes('FIS')))
        return 'MARCOS';
    if (nome.includes('BIANCA')) return 'ARTES1ANO';
    if (nome.includes('MIRIAM')) return 'MIRIAM';
    if (nome.includes('SIRLENE')) return 'OFMAKER';
    if (nome.includes('CHERLANE')) return 'OFSEBRAE';
    if (nome.includes('LIMA') && esp) return 'LIMA';

    // Raquel — diferencia pela disciplina
    if (nome.includes('RAQUEL') && disc.includes('LEITURA')) return 'OFLEITURA';
    if (nome.includes('CASTELANELI')) return 'OFLEITURA';
    if (nome.includes('PIPOCA')) return 'OFLEITURA';

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

// ============================================
// PERFIL ATIVO — A MESMA FONTE QUE ESCREVE O RÓTULO
// ============================================
// `atualizarHeader` já lê o perfil por `resolverPerfilAtivo` (js/auth.js), que
// dá precedência ao cargo do VÍNCULO da escola ativa sobre o campo `perfil` do
// documento. O resto desta tela continuava lendo `user.perfil` cru — e as duas
// leituras discordam justamente em quem tem mais de um vínculo.
//
// O efeito era o defeito relatado: numa conta cujo documento diz `secretaria`
// mas cujo vínculo da escola ativa é `diretor`, o cabeçalho escrevia
// "Diretor(a)" e a barra lateral montava o menu da SECRETARIA logo abaixo —
// incluindo o "Relatórios" que aponta para `/html/secretaria/relatorios.html`.
// A pessoa via a tela de diretora e caía nos relatórios da secretaria.
//
// Uma leitura só, aqui, para toda decisão de navegação e de visibilidade.
// `user.perfil` fica como último recurso: se `js/auth.js` não carregou, é
// melhor decidir pelo documento do que não decidir nada.
function perfilAtivoDoUsuario(user) {
    if (!user) return null;
    if (window.resolverPerfilAtivo) {
        const escola = window.escolaAtivaId ? window.escolaAtivaId() : null;
        const chave = window.resolverPerfilAtivo(user, escola).chave;
        if (chave) return chave;
    }
    return user.perfil || null;
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
                perfil = todos.find((p) => p.email === user.email);
            }

            console.log(
                '📌 Dashboard - Professor encontrado:',
                perfil ? perfil.nome : 'NÃO ENCONTRADO'
            );

            // Se não encontrar perfil estendido, usa dados básicos do login
            if (!perfil) {
                console.warn(
                    '⚠️ Perfil estendido de professor não encontrado. Usando dados do login.'
                );
                perfil = { nome: user.nome };
            }
        } else if (user.perfil === 'diretor') {
            perfil = await db.findByIndex('diretores', 'idUsuario', user._id || user.id);

            // Fallback por email
            if (!perfil && user.email) {
                const todos = await db.getAll('diretores');
                perfil = todos.find((d) => d.email === user.email);
            }

            // Se não encontrar perfil estendido, usa dados básicos do login
            if (!perfil) {
                console.warn(
                    '⚠️ Perfil estendido de diretor não encontrado. Usando dados do login.'
                );
                perfil = { nome: user.nome };
            }
        } else if (user.perfil === 'secretaria') {
            perfil = await db.findByIndex('secretarias', 'idUsuario', user._id || user.id);

            if (!perfil && user.email) {
                const todos = await db.getAll('secretarias');
                perfil = todos.find((s) => s.email === user.email);
            }

            if (!perfil) {
                console.warn(
                    '⚠️ Perfil estendido de secretaria não encontrado. Usando dados do login.'
                );
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

        // Inicializa Widgets da Fase 2
        inicializarWidgets(user, perfil);
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
        showToast('Erro ao carregar dados', 'error');
    }
}

// === ATUALIZAR HEADER ===
function atualizarHeader(user, perfil) {
    const nomeExibir = perfil && perfil.nome ? perfil.nome : user.nome || user.email;

    // Role baseada no perfil — fonte única em js/auth.js.
    // A cadeia anterior terminava em `: 'Diretor'`, então responsável (e
    // qualquer perfil novo) era rotulado como diretor sem que nada avisasse.
    const roleLabel = window.rotuloPerfilAtivo
        ? window.rotuloPerfilAtivo(user, window.escolaAtivaId && window.escolaAtivaId())
        : '—';

    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarUserRole = document.getElementById('sidebarUserRole');

    if (sidebarUserName) sidebarUserName.textContent = nomeExibir;
    if (sidebarUserRole) sidebarUserRole.textContent = roleLabel;

    // Sincroniza fotos em toda a interface.
    // Só sobrescreve a foto do login se o perfil estendido realmente tiver uma
    // — antes, o fallback (perfil = { nome }) zerava a foto real do usuário.
    const fotoPerfil = perfil && (perfil.foto || perfil.fotoGoogle);
    const userToUpdate = fotoPerfil ? { ...user, foto: fotoPerfil } : user;
    if (window.updateAllAvatars) {
        window.updateAllAvatars(userToUpdate);
    }
}

// === ATUALIZAR WELCOME ===
function atualizarWelcome(user, perfil) {
    const welcomeTitle = document.getElementById('welcomeTitle');
    const welcomeMessage = document.getElementById('welcomeMessage');

    const primeiroNome =
        perfil && perfil.nome
            ? perfil.nome.split(' ')[0]
            : user.nome
              ? user.nome.split(' ')[0]
              : 'Usuário';

    welcomeTitle.textContent = `Olá, ${primeiroNome}! 👋`;

    if (user.perfil === 'admin') {
        welcomeMessage.textContent = 'Você tem acesso total ao sistema como Administrador.';
    } else if (user.perfil === 'professor') {
        welcomeMessage.textContent = 'Pronto para gerenciar suas turmas e atividades.';
    } else if (user.perfil === 'secretaria') {
        welcomeMessage.textContent = 'Gerencie matrículas, documentos e comunicados da escola.';
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
    const cardCodigosEscolas = document.getElementById('cardCodigosEscolas');
    const cardIaAssistant = document.getElementById('cardIaAssistant');

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
        if (cardCodigosEscolas) cardCodigosEscolas.style.display = 'flex';
        if (cardIaAssistant) cardIaAssistant.style.display = 'flex';
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
        if (cardIaAssistant) cardIaAssistant.style.display = 'flex';

        // Sempre mostra Meu Horário — especialista (prof=KEY) ou PEB1 (sala=TURMA)
        const profKey = getProfessorKeyFromPerfil(perfil);
        const cardMeuHorario = document.getElementById('cardMeuHorario');
        const btnMeuHorario = document.getElementById('btnMeuHorario');
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
    } else if (user.perfil === 'secretaria') {
        // Secretaria vê lista de alunos mas não vê ferramentas admin, horários, gerencial
        if (cardGerencial) cardGerencial.style.display = 'none';
        if (cardFerramentas) cardFerramentas.style.display = 'none';
        if (cardHorariosDir) cardHorariosDir.style.display = 'none';
        if (cardGestaoGrade) cardGestaoGrade.style.display = 'none';
        if (cardListaProfessores) cardListaProfessores.style.display = 'none';
        if (cardGerenciarSalas) cardGerenciarSalas.style.display = 'none';
        if (cardNotificacoesResp) cardNotificacoesResp.style.display = 'none';
        if (cardSecretCodes) cardSecretCodes.style.display = 'none';
        if (cardListaAlunos) cardListaAlunos.style.display = 'flex'; // Secretaria acessa alunos
        if (cardIaAssistant) cardIaAssistant.style.display = 'flex';
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
        if (cardIaAssistant) cardIaAssistant.style.display = 'flex';

        // Carregar dados reais para o resumo do diretor
        await carregarResumoDiretor();
    }

    // --- ATUALIZAR VISIBILIDADE DA SIDEBAR ---
    // Perfil ATIVO, não o campo cru: quem tem vínculo de direção nesta escola
    // não pode receber o bloco da secretaria, que leva aos relatórios dela.
    atualizarVisibilidadeSidebar(perfilAtivoDoUsuario(user));
}

// === CARREGA ESTATÍSTICAS DO DIRETOR ===
async function carregarResumoDiretor() {
    try {
        const response = await fetch(`${window.API_BASE_URL}/dashboard/summary`, {
            credentials: 'include',
        });
        const json = await response.json();

        if (json.success) {
            const data = json.data;
            animateValue('stat-total-alunos', 0, data.totalAlunos || 0, 1000);
            animateValue('stat-total-professores', 0, data.totalProfessores || 0, 1000);
            animateValue('stat-total-turmas', 0, data.totalTurmas || 0, 1000);
        }

        // Carregar últimos avisos
        try {
            const resNotices = await fetch(`${window.API_BASE_URL}/dashboard/summary/notices`, {
                credentials: 'include',
            });
            const jsonNotices = await resNotices.json();

            if (jsonNotices.success) {
                atualizarListaAvisosMini(jsonNotices.data.slice(0, 5));
            } else {
                atualizarListaAvisosMini([]);
            }
        } catch (e) {
            console.warn('Erro ao carregar últimos avisos:', e);
            atualizarListaAvisosMini([]);
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
    const sharedItems = document.querySelectorAll('.director-teacher-shared');

    const secretariaItems = document.querySelectorAll('.secretaria-only');

    // `forEach` com corpo entre chaves, e não `(el) => (el.style... = 'none')`:
    // a forma curta DEVOLVE o valor atribuído, e o Biome reprova callback de
    // iterável que retorna algo (lint/suspicious/useIterableCallbackReturn).
    const esconder = (itens) => {
        itens.forEach((el) => {
            el.style.display = 'none';
        });
    };
    // `comBotoes` reproduz a diferença que já existia entre os ramos: o bloco
    // do PRÓPRIO setor também aceita `.btn` como linha (`flex`), enquanto o
    // bloco compartilhado olha só para `.sidebar-item`. Manter isso idêntico
    // evita trocar a caixa de algum botão de graça nesta correção.
    const mostrar = (itens, comBotoes) => {
        itens.forEach((el) => {
            const ehLinha =
                el.classList.contains('sidebar-item') ||
                (comBotoes && el.classList.contains('btn'));
            el.style.display = ehLinha ? 'flex' : 'block';
        });
    };

    if (perfil === 'diretor' || perfil === 'admin') {
        mostrar(directorItems, true);
        esconder(teacherItems);
        esconder(secretariaItems);
        mostrar(sharedItems, false);
    } else if (perfil === 'secretaria') {
        esconder(directorItems);
        esconder(teacherItems);
        mostrar(secretariaItems, true);
        mostrar(sharedItems, false);
    } else if (perfil === 'professor') {
        esconder(directorItems);
        esconder(secretariaItems);
        mostrar(teacherItems, false);
        mostrar(sharedItems, false);
    } else {
        // Perfil não resolvido: FECHA. Antes não havia este ramo — a função
        // simplesmente não mexia em nada e a barra ficava como o HTML a
        // entregou. Hoje isso é inofensivo porque todo item restrito nasce com
        // `display: none` inline, mas é uma garantia que mora no HTML, não
        // aqui: basta alguém tirar o estilo inline de um item para a barra de
        // outro setor aparecer para quem não tem perfil nenhum.
        esconder(directorItems);
        esconder(teacherItems);
        esconder(secretariaItems);
        esconder(sharedItems);
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
    if (!list) return;

    if (!notices || notices.length === 0) {
        list.innerHTML =
            '<div class="activity-item-mini" style="justify-content: center; color: #94a3b8; padding: 1rem;"><i class="bi bi-check-circle" style="margin-right: 6px;"></i> Nenhum aviso recente</div>';
        return;
    }

    list.innerHTML = notices
        .map(
            (n) => `
        <div class="activity-item-mini">
            <div class="activity-dot" style="background: #10b981;"></div>
            <div class="activity-text">
                <strong>${escHtml(n.titulo)}</strong>
                <span class="activity-time">${new Date(n.dataCriacao).toLocaleDateString('pt-BR')}</span>
            </div>
        </div>
    `
        )
        .join('');
}

function atualizarGridAtividade() {
    const list = document.getElementById('recentActivityList');
    if (!list) return;

    // Mock para visual inicial premium
    const activities = [
        { text: 'Novo professor cadastrado: Marcos Silva', time: 'Há 2 horas', color: '#3b82f6' },
        { text: 'Relatório mensal de frequência gerado', time: 'Há 5 horas', color: '#10b981' },
        { text: 'Aviso enviado para a Turma 2º Ano A', time: 'Ontem às 18:30', color: '#f59e0b' },
    ];

    list.innerHTML = activities
        .map(
            (a) => `
        <div class="activity-item-mini">
            <div class="activity-dot" style="background: ${a.color};"></div>
            <div class="activity-text">
                ${escHtml(a.text)}
                <span class="activity-time">${escHtml(a.time)}</span>
            </div>
        </div>
    `
        )
        .join('');
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
            const res = await fetch(`${window.API_BASE_URL}/security/status`, {
                credentials: 'include',
            });
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

// Relatórios de cada perfil. A tabela é explícita de propósito: a versão
// anterior decidia por uma cadeia de `if`, e o ramo final — o que atende todo
// perfil não listado — mandava para os relatórios da SECRETARIA. Bastava o
// perfil não bater na comparação (conta multi-escola, `auth` ainda não
// carregado) para uma diretora terminar na tela da secretaria.
//
// Agora só quem é secretaria chega lá; qualquer outro perfil, e também o caso
// "não sei quem é", vai para o BI Pedagógico da direção — a tela de relatórios
// que admin, diretor e professor podem abrir.
const RELATORIOS_POR_PERFIL = {
    secretaria: '/html/secretaria/relatorios.html',
};
const RELATORIOS_PADRAO = '/html/direcao/bi-pedagogico.html';

window.verRelatorios = function () {
    const user = window.auth && window.auth.getCurrentUser ? window.auth.getCurrentUser() : null;
    const perfil = perfilAtivoDoUsuario(user);
    window.location.href = RELATORIOS_POR_PERFIL[perfil] || RELATORIOS_PADRAO;
};

window.abrirFerramentas = function () {
    const user = auth.getCurrentUser();

    if (!user || user.perfil !== 'admin') {
        if (typeof showToast === 'function') {
            showToast(
                'Acesso negado. Apenas administradores podem acessar as ferramentas.',
                'error'
            );
        }
        return;
    }

    // Caminho resolvido por js/rotas.js: a área administrativa pode estar atrás
    // do prefixo secreto (ADMIN_PATH), e 'admin/configuracoes.html' batia num
    // 404 sempre que ele estava configurado.
    if (window.ROTAS) {
        window.ROTAS.ir('admin.configuracoes');
        return;
    }
    console.error('[dashboard] js/rotas.js não carregado — navegação cancelada.');
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
// === WIDGETS E GAMIFICAÇÍO (PHASE 2) ===
async function inicializarWidgets(user, perfil) {
    const iaContent = document.getElementById('ia-prediction-content');
    const badgesGrid = document.getElementById('badges-grid-dashboard');
    const widgetIA = document.getElementById('widget-ia-insights');

    // 1. Insights da IA (Predições)
    if (iaContent) {
        try {
            // Se for responsável, busca predição do filho
            if (user.perfil === 'responsavel') {
                const res = await fetch(`${window.API_BASE_URL || '/api'}/ia/chatbot`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': document.cookie.match(/csrf_token=([^;]+)/)?.[1] || '',
                    },
                    body: JSON.stringify({
                        message: 'como está o desempenho?',
                        perfil: 'responsavel',
                    }),
                    credentials: 'include',
                });
                const json = (await res.ok) ? await res.json() : null;
                if (json && json.success) {
                    iaContent.innerHTML = `
                        <div style="position: relative;">
                            <p style="line-height:1.4; padding-right: 40px;">${escHtml(json.data.response)}</p>
                            <button id="btn-speak-insight" class="btn btn-sm btn-outline-primary" style="position: absolute; top: 0; right: 0; border: none;">
                                <i class="bi bi-volume-up-fill"></i>
                            </button>
                        </div>
                    `;
                    document.getElementById('btn-speak-insight')?.addEventListener('click', () => {
                        if (window.speak) window.speak(json.data.response);
                    });
                } else {
                    iaContent.innerHTML = `<p>Olá! Estou analisando os dados pedagógicos para gerar insights exclusivos em breve.</p>`;
                }
            } else {
                iaContent.innerHTML = `<p>Olá, ${escHtml(user.perfil)}! No momento estou processando novos dados da escola para te dar insights exclusivos.</p>`;
            }
        } catch (e) {
            console.warn('Erro ao carregar insights:', e);
            iaContent.textContent = 'Insights indisponíveis no momento.';
        }
    }

    // 2. Gamificação (Badges)
    if (badgesGrid && user.perfil === 'responsavel') {
        try {
            const al = await db.findByIndex('alunos', 'responsavelEmail', user.email);
            if (al) {
                // Recalcula e busca — apiFetch autentica pelo cookie HttpOnly
                // (JWT) e anexa o CSRF; nenhum token sai de storage.
                const alunoId = al._id || al.id;
                await apiFetch(`/gamificacao/recalcular/${alunoId}`, { method: 'POST' });
                const json = await apiFetch(`/gamificacao/aluno/${alunoId}`);

                if (json.data && json.data.length > 0) {
                    badgesGrid.innerHTML = json.data
                        .map(
                            (b) => `
                        <div class="badge-conquest" title="${escHtml(b.descricao)}">
                            <div class="badge-icon"><i class="bi ${escHtml(b.icone)}"></i></div>
                            <span style="font-size: 0.65rem; color: #94a3b8; font-weight: 600;">${escHtml(b.titulo)}</span>
                        </div>
                    `
                        )
                        .join('');
                } else {
                    badgesGrid.innerHTML =
                        '<p style="font-size:0.75rem; color:#64748b;">Nenhuma insígnia ainda. Continue focado!</p>';
                }
            }
        } catch (e) {
            console.error('Erro badges:', e);
        }
    } else if (document.getElementById('widget-badges')) {
        document.getElementById('widget-badges').style.display = 'none';
    }
}
