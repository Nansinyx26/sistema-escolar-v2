/**
 * detalhes/autorizacoes-pais.js
 * Controlador da visão Master-Detail de Autorizações dos Pais
 * Conecta diretamente aos dados do MongoDB Atlas de Produção
 */

// Estado da Aplicação
const state = {
    alunos: [],
    alunosFiltrados: [],
    alunoSelecionado: null,
    documentosAluno: [],
    turmas: [],
    filtroTexto: '',
    filtroTurma: '',
    filtroSerie: '',
    filtroPeriodo: '',
    filtroStatus: '',
    paginaAtual: 1,
    itensPorPagina: 10,
    docsPaginaAtual: 1,
    docsItensPorPagina: 5,
    abaAtiva: 'autorizacoes',
};

// Regras de exibição (detalhes/autorizacoes-pais-dados.js), carregado antes deste módulo.
const D = window.AutorizacoesPaisDados;

// ==========================================================================
// 1. INICIALIZAÇÃO E CONTROLE DE ACESSO
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    verificarAcesso();
    inicializarTema();
    inicializarEventos();
    await carregarTurmas();
    await carregarAlunosAtlas();
    configurarRealtime();
});

function verificarAcesso() {
    try {
        const userSession = JSON.parse(
            sessionStorage.getItem('currentUser') ||
            localStorage.getItem('usuario') ||
            localStorage.getItem('currentUser') ||
            '{}'
        );
        const perfil = (userSession?.perfil || userSession?.role || '').toLowerCase();

        // Se houver perfil detectado e não for gestão, redireciona
        if (perfil && perfil !== 'diretor' && perfil !== 'admin' && perfil !== 'secretaria') {
            alert('Acesso negado: Apenas a Direção e a Secretaria podem acessar as Autorizações dos Pais.');
            window.location.href = '/html/dashboard.html';
            return;
        }

        // Atualizar informações do header
        if (userSession?.nome) {
            const elNome = document.getElementById('headerUserName');
            const elRole = document.getElementById('headerUserRole');
            const elAvatar = document.getElementById('headerUserAvatar');

            if (elNome) elNome.textContent = userSession.nome;
            if (elRole) elRole.textContent = perfil === 'diretor' ? 'Diretora' : (perfil === 'secretaria' ? 'Secretaria' : 'Administrador');
            if (elAvatar) {
                const initials = userSession.nome
                    .split(' ')
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();
                elAvatar.textContent = initials || '—';
            }
        }
    } catch (e) {
        console.warn('Sessão local não disponível, prosseguindo com autenticação de cookie', e);
    }
}

// ==========================================================================
// 2. GERENCIAMENTO DE TEMA (BRANCO & BLACK MINT)
// ==========================================================================
function inicializarTema() {
    const btnToggle = document.getElementById('btnToggleTheme');
    const iconToggle = document.getElementById('themeToggleIcon');
    const brandText = document.getElementById('sidebarBrandText');

    function sincronizarUI(tema) {
        const isDark = tema === 'dark';
        if (iconToggle) {
            iconToggle.className = isDark ? 'bi bi-moon-stars' : 'bi bi-sun';
        }
        if (brandText) {
            brandText.textContent = isDark ? 'Black Mint' : 'Sistema Escolar';
        }
    }

    const temaAtual = (window.ThemeManager && window.ThemeManager.get()) ||
        document.documentElement.getAttribute('data-theme') ||
        'dark';

    sincronizarUI(temaAtual);

    if (btnToggle) {
        btnToggle.addEventListener('click', () => {
            let novoTema = 'dark';
            if (window.ThemeManager) {
                novoTema = window.ThemeManager.toggle();
            } else {
                const atual = document.documentElement.getAttribute('data-theme') || 'dark';
                novoTema = atual === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', novoTema);
                localStorage.setItem('theme', novoTema);
            }
            sincronizarUI(novoTema);
        });
    }

    window.addEventListener('themechange', (e) => {
        if (e.detail?.theme) {
            sincronizarUI(e.detail.theme);
        }
    });
}

// ==========================================================================
// 3. CARREGAMENTO DE DADOS DO MONGODB ATLAS
// ==========================================================================
async function carregarTurmas() {
    try {
        const res = await fetch('/api/turmas', { credentials: 'include' });
        if (!res.ok) return;
        const json = await res.json();
        const turmas = json.data || (Array.isArray(json) ? json : []);
        state.turmas = turmas;

        const selectTurma = document.getElementById('filtroTurma');
        if (!selectTurma) return;

        // Manter a primeira opção "Turma: Todas"
        selectTurma.innerHTML = '<option value="">Turma: Todas</option>';
        turmas.forEach((t) => {
            const opt = document.createElement('option');
            const nome = t.nome || t.turma || t.codigo || t._id;
            opt.value = nome;
            opt.textContent = `Turma: ${nome}`;
            selectTurma.appendChild(opt);
        });
    } catch (err) {
        console.warn('Aviso ao carregar turmas:', err);
    }
}

/**
 * Lista de alunos com o resumo REAL das autorizações (Issue #270).
 *
 * O resumo vem de `/api/secretaria/autorizacoes`, que cruza a coleção
 * Autorizacao com o cadastro do aluno e devolve resposta ausente como
 * pendente. `/api/alunos` só complementa série, período e foto; se falhar,
 * a tela segue sem esses campos, mostrando "—". Nada aqui é inventado.
 */
async function carregarAlunosAtlas() {
    const listContainer = document.getElementById('studentsListContainer');
    try {
        const res = await fetch('/api/secretaria/autorizacoes', { credentials: 'include' });
        if (!res.ok) {
            throw new Error(`Erro na API (${res.status})`);
        }
        const json = await res.json();
        const resumos = Array.isArray(json.alunos) ? json.alunos : [];
        const cadastro = await carregarCadastroAlunos();

        state.alunos = resumos.map((r) => montarAluno(r, cadastro.get(String(r.id)) || {}));

        aplicarFiltros();

        if (state.alunosFiltrados.length > 0) {
            selecionarAluno(state.alunosFiltrados[0].id);
        }
    } catch (err) {
        console.error('Erro ao carregar as autorizações dos alunos:', err);
        if (listContainer) {
            listContainer.innerHTML = `
                <div class="ap-empty-state">
                    <i class="bi bi-exclamation-triangle"></i>
                    <p>Não foi possível carregar as autorizações dos alunos.</p>
                    <button type="button" class="ap-btn-action preview" id="btnTentarNovamente">Tentar novamente</button>
                </div>
            `;
            document
                .getElementById('btnTentarNovamente')
                ?.addEventListener('click', () => window.location.reload());
        }
    }
}

/** Série, período e foto do cadastro, por id. Falha aqui não derruba a tela. */
async function carregarCadastroAlunos() {
    const mapa = new Map();
    try {
        const res = await fetch('/api/alunos', { credentials: 'include' });
        if (!res.ok) return mapa;
        const json = await res.json();
        const lista = json.data || (Array.isArray(json) ? json : []);
        lista.forEach((a) => {
            if (a._id) mapa.set(String(a._id), a);
            if (a.id) mapa.set(String(a.id), a);
        });
    } catch (err) {
        console.warn('Cadastro complementar dos alunos indisponível:', err);
    }
    return mapa;
}

/**
 * Aluno como a lista exibe. Só dado real: o que falta vira "—".
 * Série sai do cadastro ou do número da turma ("5ºA" vira "5º ano"); período
 * sai do cadastro ou do nome da turma. Nada é sorteado nem preenchido de exemplo.
 */
function montarAluno(resumo, cadastro) {
    const turma = D.ouAusente(resumo.turma === 'Sem Turma' ? '' : resumo.turma);

    let serie = cadastro.serie || '';
    if (!serie && turma !== D.AUSENTE) {
        const numero = turma.match(/(\d+)/);
        if (numero) serie = `${numero[1]}º ano`;
    }

    let periodo = cadastro.periodo || cadastro.turno || '';
    if (!periodo) {
        const t = turma.toLowerCase();
        if (t.includes('manh')) periodo = 'Manhã';
        else if (t.includes('tard')) periodo = 'Tarde';
        else if (t.includes('integr')) periodo = 'Integral';
    }

    const status = D.resumoDoAluno(resumo);

    return {
        id: String(resumo.id),
        nome: D.ouAusente(resumo.nome),
        ra: D.ouAusente(resumo.matricula),
        turma,
        serie: D.ouAusente(serie),
        periodo: D.ouAusente(periodo),
        responsavel: D.ouAusente(resumo.responsavel === 'Não informado' ? '' : resumo.responsavel),
        foto: cadastro.foto || cadastro.fotoUrl || null,
        statusGeral: status.grupo,
        statusTexto: status.texto,
        statusBadgeTipo: status.tipo,
        statusIcone: status.icone,
    };
}

/** Linha de espera enquanto a tabela carrega. */
function linhaDeCarregamento(colunas) {
    return `
        <tr>
            <td colspan="${colunas}" style="text-align: center; padding: 2rem;">
                <div class="ap-skeleton" style="height: 24px; width: 60%; margin: 0 auto 8px;"></div>
                <div class="ap-skeleton" style="height: 24px; width: 40%; margin: 0 auto;"></div>
            </td>
        </tr>
    `;
}

/** Linha única com uma mensagem (tabela vazia ou erro). */
function linhaDeMensagem(colunas, texto) {
    return `
        <tr>
            <td colspan="${colunas}" style="text-align: center; color: var(--ap-text-muted); padding: 2rem;">
                ${D.esc(texto)}
            </td>
        </tr>
    `;
}

// ==========================================================================
// 4. FILTROS E PESQUISA
// ==========================================================================
function inicializarEventos() {
    const inputBusca = document.getElementById('filtroTexto');
    const selectTurma = document.getElementById('filtroTurma');
    const selectSerie = document.getElementById('filtroSerie');
    const selectPeriodo = document.getElementById('filtroPeriodo');
    const selectStatus = document.getElementById('filtroStatus');
    const btnLimpar = document.getElementById('btnLimparFiltros');
    const btnPrevPage = document.getElementById('btnPrevPage');
    const btnNextPage = document.getElementById('btnNextPage');
    const tabAutorizacoes = document.getElementById('tabBtnAutorizacoes');
    const tabDocumentos = document.getElementById('tabBtnDocumentos');
    const modalClose = document.getElementById('modalPreviewCloseBtn');
    const modalBackdrop = document.getElementById('modalPreviewDocumento');

    if (inputBusca) {
        inputBusca.addEventListener('input', (e) => {
            state.filtroTexto = e.target.value.toLowerCase().trim();
            state.paginaAtual = 1;
            aplicarFiltros();
        });
    }

    if (selectTurma) {
        selectTurma.addEventListener('change', (e) => {
            state.filtroTurma = e.target.value;
            state.paginaAtual = 1;
            aplicarFiltros();
        });
    }

    if (selectSerie) {
        selectSerie.addEventListener('change', (e) => {
            state.filtroSerie = e.target.value;
            state.paginaAtual = 1;
            aplicarFiltros();
        });
    }

    if (selectPeriodo) {
        selectPeriodo.addEventListener('change', (e) => {
            state.filtroPeriodo = e.target.value;
            state.paginaAtual = 1;
            aplicarFiltros();
        });
    }

    if (selectStatus) {
        selectStatus.addEventListener('change', (e) => {
            state.filtroStatus = e.target.value;
            state.paginaAtual = 1;
            aplicarFiltros();
        });
    }

    if (btnLimpar) {
        btnLimpar.addEventListener('click', () => {
            state.filtroTexto = '';
            state.filtroTurma = '';
            state.filtroSerie = '';
            state.filtroPeriodo = '';
            state.filtroStatus = '';
            state.paginaAtual = 1;

            if (inputBusca) inputBusca.value = '';
            if (selectTurma) selectTurma.value = '';
            if (selectSerie) selectSerie.value = '';
            if (selectPeriodo) selectPeriodo.value = '';
            if (selectStatus) selectStatus.value = '';

            aplicarFiltros();
        });
    }

    if (btnPrevPage) {
        btnPrevPage.addEventListener('click', () => {
            if (state.paginaAtual > 1) {
                state.paginaAtual--;
                renderizarListaAlunos();
            }
        });
    }

    if (btnNextPage) {
        btnNextPage.addEventListener('click', () => {
            const totalPaginas = Math.ceil(state.alunosFiltrados.length / state.itensPorPagina);
            if (state.paginaAtual < totalPaginas) {
                state.paginaAtual++;
                renderizarListaAlunos();
            }
        });
    }

    // Alternador de Abas (Autorizações / Documentos)
    if (tabAutorizacoes && tabDocumentos) {
        tabAutorizacoes.addEventListener('click', () => {
            state.abaAtiva = 'autorizacoes';
            tabAutorizacoes.classList.add('active');
            tabAutorizacoes.setAttribute('aria-selected', 'true');
            tabDocumentos.classList.remove('active');
            tabDocumentos.setAttribute('aria-selected', 'false');
            document.getElementById('sectionAutorizacoes').style.display = 'block';
            document.getElementById('sectionDocumentos').style.display = 'block';
        });

        tabDocumentos.addEventListener('click', () => {
            state.abaAtiva = 'documentos';
            tabDocumentos.classList.add('active');
            tabDocumentos.setAttribute('aria-selected', 'true');
            tabAutorizacoes.classList.remove('active');
            tabAutorizacoes.setAttribute('aria-selected', 'false');
            // Role para a seção de documentos suavemente
            document.getElementById('sectionDocumentos')?.scrollIntoView({ behavior: 'smooth' });
        });
    }

    // Fechar Modal de Preview
    if (modalClose && modalBackdrop) {
        modalClose.addEventListener('click', () => {
            modalBackdrop.classList.remove('open');
            document.getElementById('modalPreviewBody').innerHTML = '';
        });

        modalBackdrop.addEventListener('click', (e) => {
            if (e.target === modalBackdrop) {
                modalBackdrop.classList.remove('open');
                document.getElementById('modalPreviewBody').innerHTML = '';
            }
        });
    }
}

function aplicarFiltros() {
    state.alunosFiltrados = state.alunos.filter((aluno) => {
        // Filtro de Texto (Nome ou RA)
        if (state.filtroTexto) {
            const matchNome = aluno.nome.toLowerCase().includes(state.filtroTexto);
            const matchRa = aluno.ra.toLowerCase().includes(state.filtroTexto);
            if (!matchNome && !matchRa) return false;
        }

        // Filtro de Turma
        if (state.filtroTurma && aluno.turma !== state.filtroTurma) {
            return false;
        }

        // Filtro de Série
        if (state.filtroSerie && !aluno.serie.includes(state.filtroSerie)) {
            return false;
        }

        // Filtro de Período
        if (state.filtroPeriodo && aluno.periodo.toLowerCase() !== state.filtroPeriodo.toLowerCase()) {
            return false;
        }

        // Filtro de Status
        if (state.filtroStatus && aluno.statusGeral !== state.filtroStatus) {
            return false;
        }

        return true;
    });

    // Atualizar Contador do Cabeçalho
    const elContador = document.getElementById('masterTitleCount');
    if (elContador) {
        elContador.textContent = `Alunos (${state.alunosFiltrados.length})`;
    }

    renderizarListaAlunos();
}

// ==========================================================================
// 5. RENDERIZAÇÃO DA LISTA DE ALUNOS (COLUNA ESQUERDA)
// ==========================================================================
function renderizarListaAlunos() {
    const container = document.getElementById('studentsListContainer');
    if (!container) return;

    if (state.alunosFiltrados.length === 0) {
        container.innerHTML = `
            <div class="ap-empty-state">
                <i class="bi bi-people"></i>
                <p>Nenhum estudante encontrado com os filtros selecionados.</p>
            </div>
        `;
        renderizarPaginacaoAlunos(0, 0);
        return;
    }

    const totalItens = state.alunosFiltrados.length;
    const totalPaginas = Math.ceil(totalItens / state.itensPorPagina);
    if (state.paginaAtual > totalPaginas) state.paginaAtual = totalPaginas;

    const inicio = (state.paginaAtual - 1) * state.itensPorPagina;
    const fim = inicio + state.itensPorPagina;
    const paginaAlunos = state.alunosFiltrados.slice(inicio, fim);

    container.innerHTML = '';
    paginaAlunos.forEach((aluno) => {
        const isSelected = state.alunoSelecionado?.id === aluno.id;
        const card = document.createElement('div');
        card.className = `ap-student-card ${isSelected ? 'selected' : ''}`;
        card.setAttribute('data-id', aluno.id);

        card.innerHTML = `
            <div class="ap-student-card-left">
                <div class="ap-student-avatar">
                    ${aluno.foto ? `<img src="${D.esc(aluno.foto)}" alt="${D.esc(aluno.nome)}">` : D.esc(aluno.nome.charAt(0))}
                </div>
                <div class="ap-student-info">
                    <div class="ap-student-name" title="${D.esc(aluno.nome)}">${D.esc(aluno.nome)}</div>
                    <div class="ap-student-meta">
                        RA: ${D.esc(aluno.ra)} &nbsp;•&nbsp; Turma: ${D.esc(aluno.turma)} &nbsp;•&nbsp; ${D.esc(aluno.serie)} &nbsp;•&nbsp; ${D.esc(aluno.periodo)}
                    </div>
                </div>
            </div>
            <div class="ap-student-card-right">
                <span class="ap-status-badge ${aluno.statusBadgeTipo}">
                    <i class="bi ${aluno.statusIcone}"></i> ${D.esc(aluno.statusTexto)}
                </span>
                <i class="bi bi-chevron-right ap-chevron"></i>
            </div>
        `;

        card.addEventListener('click', () => selecionarAluno(aluno.id));
        container.appendChild(card);
    });

    renderizarPaginacaoAlunos(totalPaginas, state.paginaAtual);
}

function renderizarPaginacaoAlunos(totalPaginas, paginaAtual) {
    const container = document.getElementById('masterPageNumbers');
    const btnPrev = document.getElementById('btnPrevPage');
    const btnNext = document.getElementById('btnNextPage');

    if (btnPrev) btnPrev.disabled = paginaAtual <= 1;
    if (btnNext) btnNext.disabled = paginaAtual >= totalPaginas || totalPaginas === 0;

    if (!container) return;
    container.innerHTML = '';

    for (let p = 1; p <= totalPaginas; p++) {
        // Se houver muitas páginas, mostrar de forma concisa
        if (totalPaginas > 5 && (p > 4 && p !== totalPaginas)) {
            if (p === 5) {
                const dots = document.createElement('span');
                dots.textContent = '...';
                dots.style.cssText = 'color:var(--ap-text-muted);font-size:0.75rem;padding:0 2px;';
                container.appendChild(dots);
            }
            continue;
        }

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `ap-page-btn ${p === paginaAtual ? 'active' : ''}`;
        btn.textContent = String(p);
        btn.addEventListener('click', () => {
            state.paginaAtual = p;
            renderizarListaAlunos();
        });
        container.appendChild(btn);
    }
}

// ==========================================================================
// 6. SELEÇÃO DE ALUNO E DETALHES (COLUNA DIREITA)
// ==========================================================================
async function selecionarAluno(alunoId) {
    const aluno = state.alunos.find((a) => a.id === alunoId);
    if (!aluno) return;

    state.alunoSelecionado = aluno;

    // Atualizar classe selecionada nos cards
    document.querySelectorAll('.ap-student-card').forEach((el) => {
        el.classList.toggle('selected', el.getAttribute('data-id') === alunoId);
    });

    // Atualizar Card de Perfil do Estudante
    const elName = document.getElementById('detailStudentName');
    const elMeta = document.getElementById('detailStudentMeta');
    const elResp = document.getElementById('detailStudentResp');
    const elAvatar = document.getElementById('detailAvatar');
    const elBadge = document.getElementById('detailStudentStatusBadge');

    if (elName) elName.textContent = aluno.nome;
    if (elMeta) {
        elMeta.textContent = `RA: ${aluno.ra}  |  Turma: ${aluno.turma}  |  Série: ${aluno.serie}  |  Período: ${aluno.periodo}`;
    }
    if (elResp) {
        elResp.innerHTML = `Responsável: <strong>${D.esc(aluno.responsavel)}</strong>`;
    }
    if (elAvatar) {
        if (aluno.foto) {
            elAvatar.innerHTML = `<img src="${D.esc(aluno.foto)}" alt="${D.esc(aluno.nome)}">`;
        } else {
            elAvatar.textContent = aluno.nome
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')
                .toUpperCase();
        }
    }
    if (elBadge) {
        elBadge.innerHTML = `
            <span class="ap-status-badge ${aluno.statusBadgeTipo}">
                <i class="bi ${aluno.statusIcone}"></i> ${D.esc(aluno.statusTexto)}
            </span>
        `;
    }

    // As duas tabelas vêm do banco: autorizações respondidas e documentos enviados.
    await Promise.all([carregarAutorizacoesAluno(aluno), carregarDocumentosAluno(aluno.id)]);
}

/**
 * As sete autorizações do aluno, como o responsável respondeu (Issue #270).
 * Sem resposta é "Sem resposta", sem data — nunca "Aceita".
 */
async function carregarAutorizacoesAluno(aluno) {
    const tbody = document.getElementById('tableAutorizacoesBody');
    if (!tbody) return;

    tbody.innerHTML = linhaDeCarregamento(6);

    try {
        const res = await fetch(`/api/secretaria/autorizacoes/aluno/${encodeURIComponent(aluno.id)}`, {
            credentials: 'include',
        });
        if (!res.ok) {
            throw new Error(`Erro na API (${res.status})`);
        }
        const json = await res.json();

        // O usuário pode ter trocado de aluno enquanto a resposta chegava.
        if (state.alunoSelecionado?.id !== aluno.id) return;

        const nomeResp = json.responsavel?.nome === 'Não informado' ? '' : json.responsavel?.nome;
        const linhas = (Array.isArray(json.autorizacoes) ? json.autorizacoes : []).map((item) =>
            D.linhaDaAutorizacao(item, nomeResp)
        );
        renderizarTabelaAutorizacoes(linhas);
    } catch (err) {
        console.error('Erro ao carregar as autorizações do aluno:', err);
        if (state.alunoSelecionado?.id !== aluno.id) return;
        tbody.innerHTML = linhaDeMensagem(6, 'Não foi possível carregar as autorizações deste aluno.');
    }
}

function renderizarTabelaAutorizacoes(linhas) {
    const tbody = document.getElementById('tableAutorizacoesBody');
    if (!tbody) return;

    if (linhas.length === 0) {
        tbody.innerHTML = linhaDeMensagem(6, 'Nenhuma autorização registrada para este aluno.');
        return;
    }

    tbody.innerHTML = '';
    linhas.forEach((item) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 600; color: var(--ap-text-title);">${D.esc(item.titulo)}</td>
            <td style="color: var(--ap-text-muted);">${D.esc(item.descricao)}</td>
            <td>
                <span class="ap-status-badge ${item.statusTipo}">
                    <i class="bi ${item.icone}"></i> ${D.esc(item.statusLabel)}
                </span>
            </td>
            <td>${D.esc(item.dataResposta)}</td>
            <td>${D.esc(item.responsavel)}</td>
            <td style="color: var(--ap-text-muted); font-size: 0.8rem;">${D.esc(item.observacoes)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================================================
// 7. DOCUMENTOS ASSINADOS (MONGODB ATLAS & GRIDFS)
// ==========================================================================
async function carregarDocumentosAluno(alunoId) {
    const tbody = document.getElementById('tableDocumentosBody');
    if (!tbody) return;

    tbody.innerHTML = linhaDeCarregamento(4);

    try {
        const res = await fetch(`/api/documentos-responsaveis?alunoId=${encodeURIComponent(alunoId)}`, {
            credentials: 'include',
        });
        if (!res.ok) {
            throw new Error(`Erro na API (${res.status})`);
        }
        const json = await res.json();

        if (state.alunoSelecionado?.id !== alunoId) return;

        // Só o que o responsável enviou. Sem envio, a tabela fica vazia (Issue #270).
        state.documentosAluno = D.normalizarDocumentos(json.data || (Array.isArray(json) ? json : []));
        state.docsPaginaAtual = 1;
        renderizarTabelaDocumentos();
    } catch (err) {
        console.error('Erro ao carregar documentos do aluno:', err);
        if (state.alunoSelecionado?.id !== alunoId) return;
        state.documentosAluno = [];
        tbody.innerHTML = linhaDeMensagem(4, 'Não foi possível carregar os documentos deste aluno.');
        renderizarPaginacaoDocumentos(0, 0);
    }
}

function renderizarTabelaDocumentos() {
    const tbody = document.getElementById('tableDocumentosBody');
    if (!tbody) return;

    if (state.documentosAluno.length === 0) {
        tbody.innerHTML = linhaDeMensagem(4, 'Nenhum documento enviado pelo responsável.');
        renderizarPaginacaoDocumentos(0, 0);
        return;
    }

    const totalItens = state.documentosAluno.length;
    const totalPaginas = Math.ceil(totalItens / state.docsItensPorPagina);
    const inicio = (state.docsPaginaAtual - 1) * state.docsItensPorPagina;
    const fim = inicio + state.docsItensPorPagina;
    const docsPagina = state.documentosAluno.slice(inicio, fim);

    tbody.innerHTML = '';
    docsPagina.forEach((doc) => {
        const tr = document.createElement('tr');
        const nomeArquivo = `${doc.nome}.${doc.ext.toLowerCase()}`;

        tr.innerHTML = `
            <td>
                <div class="ap-doc-name-cell">
                    <span class="ap-doc-type-icon ${doc.extClass}">${D.esc(doc.ext)}</span>
                    <span>${D.esc(doc.nome)}</span>
                </div>
            </td>
            <td><span style="font-weight: 600;">${D.esc(doc.ext)}</span></td>
            <td>${D.esc(doc.dataEnvio)}</td>
            <td style="text-align: right;">
                <div class="ap-actions-group" style="justify-content: flex-end;">
                    <button type="button" class="ap-btn-action preview">
                        <i class="bi bi-eye"></i> Visualizar
                    </button>
                    <a href="${D.esc(doc.urlDownload)}" class="ap-btn-action download" target="_blank" download="${D.esc(nomeArquivo)}">
                        <i class="bi bi-download"></i> Baixar
                    </a>
                </div>
            </td>
        `;

        tr.querySelector('.ap-btn-action.preview')?.addEventListener('click', () => {
            abrirPreviewDocumento(doc.nome, doc.urlPreview, doc.urlDownload, doc.ext);
        });

        tbody.appendChild(tr);
    });

    renderizarPaginacaoDocumentos(totalPaginas, state.docsPaginaAtual);
}

function renderizarPaginacaoDocumentos(totalPaginas, paginaAtual) {
    const container = document.getElementById('docsPageNumbers');
    const btnPrev = document.getElementById('btnDocsPrevPage');
    const btnNext = document.getElementById('btnDocsNextPage');

    if (btnPrev) {
        btnPrev.disabled = paginaAtual <= 1;
        btnPrev.onclick = () => {
            if (state.docsPaginaAtual > 1) {
                state.docsPaginaAtual--;
                renderizarTabelaDocumentos();
            }
        };
    }

    if (btnNext) {
        btnNext.disabled = paginaAtual >= totalPaginas || totalPaginas === 0;
        btnNext.onclick = () => {
            if (state.docsPaginaAtual < totalPaginas) {
                state.docsPaginaAtual++;
                renderizarTabelaDocumentos();
            }
        };
    }

    if (!container) return;
    container.innerHTML = '';

    for (let p = 1; p <= totalPaginas; p++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `ap-page-btn ${p === paginaAtual ? 'active' : ''}`;
        btn.textContent = String(p);
        btn.addEventListener('click', () => {
            state.docsPaginaAtual = p;
            renderizarTabelaDocumentos();
        });
        container.appendChild(btn);
    }
}

function abrirPreviewDocumento(titulo, previewUrl, downloadUrl, extensao) {
    const backdrop = document.getElementById('modalPreviewDocumento');
    const elTitle = document.getElementById('modalPreviewTitle');
    const elBody = document.getElementById('modalPreviewBody');
    const elDownload = document.getElementById('modalDownloadBtn');

    if (!backdrop || !elBody) return;

    if (elTitle) {
        elTitle.innerHTML = `<i class="bi bi-file-earmark-text"></i> ${D.esc(titulo || 'Pré-visualização do Documento')}`;
    }

    if (elDownload) {
        elDownload.href = downloadUrl;
    }

    elBody.innerHTML = '';
    const extUpper = (extensao || '').toUpperCase();

    if (extUpper === 'JPG' || extUpper === 'JPEG' || extUpper === 'PNG') {
        const img = document.createElement('img');
        img.src = previewUrl;
        img.alt = titulo || 'Documento';
        img.onerror = () => {
            elBody.innerHTML = `
                <div style="color:#ffffff;text-align:center;padding:2rem;">
                    <i class="bi bi-file-earmark-image" style="font-size:3rem;display:block;margin-bottom:1rem;color:#94a3b8;"></i>
                    <p style="font-size:1rem;margin-bottom:1rem;">Visualização direta da imagem do documento.</p>
                    <a href="${downloadUrl}" class="ap-btn-action download" target="_blank">Baixar para visualizar</a>
                </div>
            `;
        };
        elBody.appendChild(img);
    } else {
        const iframe = document.createElement('iframe');
        iframe.src = previewUrl;
        iframe.title = titulo || 'Documento PDF';
        iframe.onerror = () => {
            elBody.innerHTML = `
                <div style="color:#ffffff;text-align:center;padding:2rem;">
                    <i class="bi bi-file-earmark-pdf" style="font-size:3rem;display:block;margin-bottom:1rem;color:#ef4444;"></i>
                    <p style="font-size:1rem;margin-bottom:1rem;">Pré-visualização em PDF assinada.</p>
                    <a href="${downloadUrl}" class="ap-btn-action download" target="_blank">Baixar PDF completo</a>
                </div>
            `;
        };
        elBody.appendChild(iframe);
    }

    backdrop.classList.add('open');
}

// ==========================================================================
// 8. TEMPO REAL (SOCKET.IO)
// ==========================================================================
function configurarRealtime() {
    if (typeof window.io === 'function') {
        try {
            const socket = window.io();
            socket.on('documento_responsavel:novo', (doc) => {
                if (state.alunoSelecionado && String(doc.alunoId) === String(state.alunoSelecionado.id)) {
                    carregarDocumentosAluno(state.alunoSelecionado.id);
                }
            });
            socket.on('documento_responsavel:atualizado', (doc) => {
                if (state.alunoSelecionado && String(doc.alunoId) === String(state.alunoSelecionado.id)) {
                    carregarDocumentosAluno(state.alunoSelecionado.id);
                }
            });
        } catch (e) {
            console.warn('Socket.IO não disponível para tempo real:', e);
        }
    }
}
