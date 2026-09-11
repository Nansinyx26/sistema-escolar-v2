/**
 * autorizacoes-alunos.js
 * Gerenciamento e consulta em tempo real das autorizações escolares dos alunos.
 * Acessível exclusivamente para Secretaria e Direção.
 */

(function () {
    'use strict';

    // Estado da Aplicação
    const state = {
        alunos: [],
        turmas: [],
        kpis: {},
        filtroTexto: '',
        filtroTurma: '',
        filtroStatus: '',
        ordenacao: {
            coluna: 'nome',
            ascendente: true,
        },
        paginacao: {
            paginaAtual: 1,
            itensPorPagina: 25,
        },
        carregando: false,
        timerAutoRefresh: null,
    };

    // Elementos DOM
    const dom = {};

    function initElements() {
        dom.kpiTotalAlunos = document.getElementById('kpiTotalAlunos');
        dom.kpiTotalAceitas = document.getElementById('kpiTotalAceitas');
        dom.kpiTotalNaoAceitas = document.getElementById('kpiTotalNaoAceitas');
        dom.kpiTaxaAceitacao = document.getElementById('kpiTaxaAceitacao');
        dom.kpiTotalPendentes = document.getElementById('kpiTotalPendentes');

        dom.inputBusca = document.getElementById('inputBusca');
        dom.selectTurma = document.getElementById('selectTurma');
        dom.pillsStatus = document.getElementById('pillsStatus');
        dom.contadorAlunos = document.getElementById('contadorAlunos');

        dom.tabela = document.getElementById('tabelaAutorizacoes');
        dom.corpoTabela = document.getElementById('corpoTabela');
        dom.selectPorPagina = document.getElementById('selectPorPagina');
        dom.infoPaginacao = document.getElementById('infoPaginacao');
        dom.paginacaoBotoes = document.getElementById('paginacaoBotoes');

        dom.btnRecarregar = document.getElementById('btnRecarregar');
        dom.iconeRecarregar = document.getElementById('iconeRecarregar');
        dom.tagUltimaSincronizacao = document.getElementById('tagUltimaSincronizacao');

        dom.drawerBackdrop = document.getElementById('drawerBackdrop');
        dom.drawerDetalhes = document.getElementById('drawerDetalhes');
        dom.drawerTituloAluno = document.getElementById('drawerTituloAluno');
        dom.drawerSubAluno = document.getElementById('drawerSubAluno');
        dom.drawerNomeResp = document.getElementById('drawerNomeResp');
        dom.drawerContatoResp = document.getElementById('drawerContatoResp');
        dom.drawerBadgesResumo = document.getElementById('drawerBadgesResumo');
        dom.drawerListaItens = document.getElementById('drawerListaItens');
        dom.btnFecharDrawer = document.getElementById('btnFecharDrawer');
        dom.btnFecharDrawerRodape = document.getElementById('btnFecharDrawerRodape');
    }

    /**
     * Utilitário para formatar datas em pt-BR
     */
    function formatarData(dataIso) {
        if (!dataIso) return 'Pendente';
        const d = new Date(dataIso);
        if (Number.isNaN(d.getTime())) return 'Pendente';
        return d.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    /**
     * Renderiza o badge do Status Geral
     */
    function renderBadgeStatus(status) {
        switch (status) {
            case 'todas_aceitas':
                return '<span class="chip chip-verde"><i class="bi bi-check2-all"></i> Todas Aceitas</span>';
            case 'com_recusas':
                return '<span class="chip chip-vermelho"><i class="bi bi-x-circle"></i> Com Recusas</span>';
            case 'parcial':
                return '<span class="chip chip-azul"><i class="bi bi-dash-circle"></i> Parcial</span>';
            default:
                return '<span class="chip chip-amarelo"><i class="bi bi-clock"></i> Pendente</span>';
        }
    }

    /**
     * Renderiza skeleton loading na tabela
     */
    function renderSkeletons() {
        if (!dom.corpoTabela) return;
        const rows = Array.from({ length: 6 })
            .map(
                () => `
            <tr>
                <td><div class="skeleton" style="height: 18px; width: 160px;"></div></td>
                <td><div class="skeleton" style="height: 18px; width: 60px;"></div></td>
                <td><div class="skeleton" style="height: 18px; width: 140px;"></div></td>
                <td style="text-align: center;"><div class="skeleton" style="height: 18px; width: 40px; margin: auto;"></div></td>
                <td style="text-align: center;"><div class="skeleton" style="height: 18px; width: 40px; margin: auto;"></div></td>
                <td><div class="skeleton" style="height: 22px; width: 90px; border-radius: 20px;"></div></td>
                <td><div class="skeleton" style="height: 18px; width: 110px;"></div></td>
                <td style="text-align: right;"><div class="skeleton" style="height: 28px; width: 70px; border-radius: 8px; margin-left: auto;"></div></td>
            </tr>
        `
            )
            .join('');
        dom.corpoTabela.innerHTML = rows;
    }

    /**
     * Busca os dados em tempo real da API
     */
    async function carregarDados(silencioso = false) {
        if (state.carregando) return;
        state.carregando = true;

        if (!silencioso) {
            if (dom.iconeRecarregar) dom.iconeRecarregar.classList.add('bi-spin');
            renderSkeletons();
        }

        try {
            const apiBase = window.API_BASE_URL || '/api';
            const res = await fetch(`${apiBase}/secretaria/autorizacoes`, {
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
            });

            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    window.location.href = '/html/entrar.html';
                    return;
                }
                throw new Error(`Erro ao consultar autorizações: status ${res.status}`);
            }

            const data = await res.json();
            if (data.success) {
                state.alunos = data.alunos || [];
                state.turmas = data.turmas || [];
                state.kpis = data.kpis || {};

                atualizarKpis();
                popularSelectTurmas();
                aplicarFiltrosEOrdenar();

                const agora = new Date().toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                });
                if (dom.tagUltimaSincronizacao) {
                    dom.tagUltimaSincronizacao.innerHTML = `<i class="bi bi-check-circle text-emerald-400"></i> Atualizado às ${agora}`;
                }
            }
        } catch (err) {
            console.error('Falha ao carregar autorizações:', err);
            if (dom.tagUltimaSincronizacao) {
                dom.tagUltimaSincronizacao.innerHTML = `<i class="bi bi-exclamation-triangle text-rose-400"></i> Falha na sincronização`;
            }
        } finally {
            state.carregando = false;
            if (dom.iconeRecarregar) dom.iconeRecarregar.classList.remove('bi-spin');
        }
    }

    /**
     * Atualiza os KPIs no topo da tela
     */
    function atualizarKpis() {
        const k = state.kpis;
        if (dom.kpiTotalAlunos)
            dom.kpiTotalAlunos.textContent = k.totalAlunos ?? state.alunos.length;
        if (dom.kpiTotalAceitas) dom.kpiTotalAceitas.textContent = k.totalAceitas ?? 0;
        if (dom.kpiTotalNaoAceitas) dom.kpiTotalNaoAceitas.textContent = k.totalNaoAceitas ?? 0;
        if (dom.kpiTaxaAceitacao)
            dom.kpiTaxaAceitacao.textContent = `${k.percentualAceitacao ?? 0}%`;
        if (dom.kpiTotalPendentes) dom.kpiTotalPendentes.textContent = k.totalPendentes ?? 0;
    }

    /**
     * Popula opções do select de turma
     */
    function popularSelectTurmas() {
        if (!dom.selectTurma) return;
        const valorAtual = dom.selectTurma.value;
        const opts = ['<option value="">Todas as Turmas</option>'];
        state.turmas.forEach((t) => {
            opts.push(`<option value="${t}">${t}</option>`);
        });
        dom.selectTurma.innerHTML = opts.join('');
        dom.selectTurma.value = valorAtual;
    }

    /**
     * Aplica filtros, ordenação e renderiza a tabela
     */
    function aplicarFiltrosEOrdenar() {
        let filtrados = state.alunos.slice();

        // Filtro por texto (aluno ou responsável)
        const busca = state.filtroTexto.trim().toLowerCase();
        if (busca) {
            filtrados = filtrados.filter((a) => {
                const nomeAluno = (a.nome || '').toLowerCase();
                const nomeResp = (a.responsavel || '').toLowerCase();
                const matricula = (a.matricula || '').toLowerCase();
                return (
                    nomeAluno.includes(busca) ||
                    nomeResp.includes(busca) ||
                    matricula.includes(busca)
                );
            });
        }

        // Filtro por turma
        if (state.filtroTurma) {
            filtrados = filtrados.filter((a) => a.turma === state.filtroTurma);
        }

        // Filtro por status
        if (state.filtroStatus) {
            filtrados = filtrados.filter((a) => a.statusGeral === state.filtroStatus);
        }

        // Ordenação
        const { coluna, ascendente } = state.ordenacao;
        filtrados.sort((a, b) => {
            let vA = a[coluna];
            let vB = b[coluna];

            if (coluna === 'ultimaAtualizacao') {
                vA = vA ? new Date(vA).getTime() : 0;
                vB = vB ? new Date(vB).getTime() : 0;
            } else if (typeof vA === 'string') {
                vA = vA.toLowerCase();
                vB = (vB || '').toLowerCase();
            }

            if (vA < vB) return ascendente ? -1 : 1;
            if (vA > vB) return ascendente ? 1 : -1;
            return 0;
        });

        state.alunosFiltrados = filtrados;
        if (dom.contadorAlunos) dom.contadorAlunos.textContent = filtrados.length;

        // Ajusta página atual se ultrapassar o limite
        const totalPaginas = Math.ceil(filtrados.length / state.paginacao.itensPorPagina) || 1;
        if (state.paginacao.paginaAtual > totalPaginas) {
            state.paginacao.paginaAtual = 1;
        }

        renderTabela();
        renderPaginacao(filtrados.length, totalPaginas);
    }

    /**
     * Renderiza o corpo da tabela
     */
    function renderTabela() {
        if (!dom.corpoTabela) return;

        const filtrados = state.alunosFiltrados || [];
        if (filtrados.length === 0) {
            dom.corpoTabela.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 3rem 1rem; color: #94a3b8;">
                        <i class="bi bi-inbox" style="font-size: 2.2rem; display: block; margin-bottom: 0.5rem; opacity: 0.4;"></i>
                        Nenhum aluno encontrado para os filtros selecionados.
                    </td>
                </tr>
            `;
            return;
        }

        const inicio = (state.paginacao.paginaAtual - 1) * state.paginacao.itensPorPagina;
        const paginaItens = filtrados.slice(inicio, inicio + state.paginacao.itensPorPagina);

        const linhas = paginaItens
            .map(
                (aluno) => `
            <tr data-aluno-id="${aluno.id}">
                <td>
                    <div style="font-weight: 600; color: #fff;">${aluno.nome}</div>
                    ${aluno.matricula ? `<div style="font-size: 0.72rem; color: #64748b;">RA: ${aluno.matricula}</div>` : ''}
                </td>
                <td><span class="chip chip-cinza">${aluno.turma}</span></td>
                <td>
                    <div style="font-size: 0.84rem; color: #cbd5e1;">${aluno.responsavel}</div>
                    ${aluno.responsavelEmail ? `<div style="font-size: 0.72rem; color: #64748b;">${aluno.responsavelEmail}</div>` : ''}
                </td>
                <td style="text-align: center;">
                    <span class="chip chip-verde" style="font-weight: 700;">${aluno.aceitas}</span>
                </td>
                <td style="text-align: center;">
                    <span class="chip chip-vermelho" style="font-weight: 700;">${aluno.naoAceitas}</span>
                </td>
                <td>${renderBadgeStatus(aluno.statusGeral)}</td>
                <td style="font-size: 0.78rem; color: #94a3b8;">${formatarData(aluno.ultimaAtualizacao)}</td>
                <td style="text-align: right;">
                    <button type="button" class="sec-btn sec-btn-outline sec-btn-sm btn-ver-detalhes" data-aluno-id="${aluno.id}">
                        <i class="bi bi-eye"></i> Detalhes
                    </button>
                </td>
            </tr>
        `
            )
            .join('');

        dom.corpoTabela.innerHTML = linhas;
    }

    /**
     * Renderiza os controles de paginação
     */
    function renderPaginacao(totalItens, totalPaginas) {
        if (!dom.infoPaginacao || !dom.paginacaoBotoes) return;

        const inicio =
            totalItens === 0
                ? 0
                : (state.paginacao.paginaAtual - 1) * state.paginacao.itensPorPagina + 1;
        const fim = Math.min(
            state.paginacao.paginaAtual * state.paginacao.itensPorPagina,
            totalItens
        );
        dom.infoPaginacao.textContent = `${inicio}-${fim} de ${totalItens}`;

        const botoes = [];
        botoes.push(`
            <button type="button" class="sec-page-btn" data-page="${state.paginacao.paginaAtual - 1}" ${state.paginacao.paginaAtual <= 1 ? 'disabled' : ''} aria-label="Página anterior">
                <i class="bi bi-chevron-left"></i>
            </button>
        `);

        for (let p = 1; p <= totalPaginas; p++) {
            if (
                p === 1 ||
                p === totalPaginas ||
                (p >= state.paginacao.paginaAtual - 2 && p <= state.paginacao.paginaAtual + 2)
            ) {
                botoes.push(`
                    <button type="button" class="sec-page-btn ${p === state.paginacao.paginaAtual ? 'active' : ''}" data-page="${p}">${p}</button>
                `);
            } else if (
                p === state.paginacao.paginaAtual - 3 ||
                p === state.paginacao.paginaAtual + 3
            ) {
                botoes.push('<span style="color: #64748b; padding: 0 4px;">...</span>');
            }
        }

        botoes.push(`
            <button type="button" class="sec-page-btn" data-page="${state.paginacao.paginaAtual + 1}" ${state.paginacao.paginaAtual >= totalPaginas ? 'disabled' : ''} aria-label="Próxima página">
                <i class="bi bi-chevron-right"></i>
            </button>
        `);

        dom.paginacaoBotoes.innerHTML = botoes.join('');
    }

    /**
     * Abre o Drawer com o detalhamento das autorizações do aluno
     */
    async function abrirDetalhesAluno(alunoId) {
        if (!alunoId) return;

        // Abre drawer com estado de carregamento
        if (dom.drawerTituloAluno) dom.drawerTituloAluno.textContent = 'Carregando detalhes...';
        if (dom.drawerSubAluno) dom.drawerSubAluno.textContent = 'Buscando dados no servidor...';
        if (dom.drawerNomeResp) dom.drawerNomeResp.textContent = 'Carregando...';
        if (dom.drawerContatoResp) dom.drawerContatoResp.textContent = '';
        if (dom.drawerBadgesResumo) dom.drawerBadgesResumo.innerHTML = '';
        if (dom.drawerListaItens) {
            dom.drawerListaItens.innerHTML =
                '<div class="skeleton" style="height: 80px; margin-bottom: 0.5rem;"></div>'.repeat(
                    4
                );
        }

        dom.drawerBackdrop.classList.add('active');
        dom.drawerDetalhes.classList.add('active');
        dom.drawerBackdrop.setAttribute('aria-hidden', 'false');
        dom.drawerDetalhes.setAttribute('aria-hidden', 'false');

        try {
            const apiBase = window.API_BASE_URL || '/api';
            const res = await fetch(`${apiBase}/secretaria/autorizacoes/aluno/${alunoId}`, {
                credentials: 'include',
            });

            if (!res.ok) throw new Error('Não foi possível carregar os detalhes.');

            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Erro ao consultar');

            const { aluno, responsavel, autorizacoes, resumo } = data;

            dom.drawerTituloAluno.textContent = aluno.nome;
            dom.drawerSubAluno.textContent = `Turma: ${aluno.turma}${aluno.matricula ? ` • RA: ${aluno.matricula}` : ''}`;

            dom.drawerNomeResp.textContent = `${responsavel.nome} (${responsavel.parentesco || 'Responsável'})`;
            const contatos = [responsavel.email, responsavel.telefone].filter(Boolean).join(' • ');
            dom.drawerContatoResp.textContent = contatos || 'Sem contato adicional informado';

            dom.drawerBadgesResumo.innerHTML = `
                <span class="chip chip-verde"><strong>${resumo.aceitas}</strong> Aceitas</span>
                <span class="chip chip-vermelho"><strong>${resumo.naoAceitas}</strong> Não Aceitas</span>
                <span class="chip chip-amarelo"><strong>${resumo.pendentes}</strong> Pendentes</span>
                ${renderBadgeStatus(resumo.statusGeral)}
            `;

            // Lista das 7 autorizações
            const itensHtml = autorizacoes
                .map((auth) => {
                    let statusBadge = '';
                    if (auth.aceita === true) {
                        statusBadge =
                            '<span class="chip chip-verde"><i class="bi bi-check-circle-fill"></i> Aceita</span>';
                    } else if (auth.aceita === false) {
                        statusBadge =
                            '<span class="chip chip-vermelho"><i class="bi bi-x-circle-fill"></i> Não Aceita</span>';
                    } else {
                        statusBadge =
                            '<span class="chip chip-amarelo"><i class="bi bi-hourglass"></i> Não Respondida</span>';
                    }

                    let detalhesHtml = '';
                    if (auth.detalhes) {
                        if (
                            auth.tipo === 'conducaoEscolar' &&
                            (auth.detalhes.motoristaNome || auth.detalhes.motoristaTelefone)
                        ) {
                            detalhesHtml = `
                            <div style="background: rgba(16,185,129,0.06); border: 1px solid rgba(16,185,129,0.2); border-radius: 8px; padding: 0.5rem 0.75rem; font-size: 0.76rem; color: #cbd5e1; margin-top: 0.3rem;">
                                <strong>Condutor:</strong> ${auth.detalhes.motoristaNome || 'Não informado'}
                                ${auth.detalhes.motoristaTelefone ? ` • 📞 ${auth.detalhes.motoristaTelefone}` : ''}
                            </div>
                        `;
                        } else if (
                            auth.tipo === 'antitermico' &&
                            (auth.detalhes.medicamentoNome || auth.detalhes.medicamentoDose)
                        ) {
                            detalhesHtml = `
                            <div style="background: rgba(16,185,129,0.06); border: 1px solid rgba(16,185,129,0.2); border-radius: 8px; padding: 0.5rem 0.75rem; font-size: 0.76rem; color: #cbd5e1; margin-top: 0.3rem;">
                                <strong>Medicamento:</strong> ${auth.detalhes.medicamentoNome || 'Não informado'}
                                ${auth.detalhes.medicamentoDose ? ` • Dose: ${auth.detalhes.medicamentoDose}` : ''}
                            </div>
                        `;
                        }
                    }

                    return `
                    <div class="auth-item-card">
                        <div class="auth-item-header">
                            <span class="auth-item-title">${auth.titulo}</span>
                            ${statusBadge}
                        </div>
                        <p class="auth-item-desc">${auth.descricao}</p>
                        ${detalhesHtml}
                        <div class="auth-item-meta">
                            <span>Respondido em: <strong>${formatarData(auth.dataResposta)}</strong></span>
                            <span>Atualizado: <strong>${formatarData(auth.atualizadoEm)}</strong></span>
                        </div>
                    </div>
                `;
                })
                .join('');

            dom.drawerListaItens.innerHTML = itensHtml;
        } catch (err) {
            if (dom.drawerListaItens) {
                dom.drawerListaItens.innerHTML = `
                    <div class="alerta alerta-erro" style="margin: 1rem 0;">
                        <i class="bi bi-exclamation-triangle"></i>
                        Erro ao obter detalhes das autorizações: ${err.message}
                    </div>
                `;
            }
        }
    }

    /**
     * Fecha o Drawer
     */
    function fecharDrawer() {
        dom.drawerBackdrop.classList.remove('active');
        dom.drawerDetalhes.classList.remove('active');
        dom.drawerBackdrop.setAttribute('aria-hidden', 'true');
        dom.drawerDetalhes.setAttribute('aria-hidden', 'true');
    }

    /**
     * Configuração dos Event Listeners
     */
    function initListeners() {
        // Busca com debounce
        let timerBusca = null;
        dom.inputBusca.addEventListener('input', (e) => {
            clearTimeout(timerBusca);
            timerBusca = setTimeout(() => {
                state.filtroTexto = e.target.value;
                state.paginacao.paginaAtual = 1;
                aplicarFiltrosEOrdenar();
            }, 250);
        });

        // Filtro por turma
        dom.selectTurma.addEventListener('change', (e) => {
            state.filtroTurma = e.target.value;
            state.paginacao.paginaAtual = 1;
            aplicarFiltrosEOrdenar();
        });

        // Filtro por status (pills)
        dom.pillsStatus.addEventListener('click', (e) => {
            const btn = e.target.closest('.sec-pill');
            if (!btn) return;
            dom.pillsStatus.querySelectorAll('.sec-pill').forEach((p) => {
                p.classList.remove('active');
            });
            btn.classList.add('active');
            state.filtroStatus = btn.dataset.status || '';
            state.paginacao.paginaAtual = 1;
            aplicarFiltrosEOrdenar();
        });

        // Ordenação por colunas da tabela
        dom.tabela.querySelector('thead').addEventListener('click', (e) => {
            const th = e.target.closest('th.sortable');
            if (!th) return;
            const coluna = th.dataset.sort;
            if (state.ordenacao.coluna === coluna) {
                state.ordenacao.ascendente = !state.ordenacao.ascendente;
            } else {
                state.ordenacao.coluna = coluna;
                state.ordenacao.ascendente = true;
            }

            // Atualiza icones
            dom.tabela.querySelectorAll('th.sortable i').forEach((icon) => {
                icon.className = 'bi bi-arrow-down-up';
                icon.style.opacity = '0.4';
            });
            const activeIcon = th.querySelector('i');
            if (activeIcon) {
                activeIcon.className = state.ordenacao.ascendente
                    ? 'bi bi-arrow-up'
                    : 'bi bi-arrow-down';
                activeIcon.style.opacity = '1';
                activeIcon.style.color = '#10b981';
            }

            aplicarFiltrosEOrdenar();
        });

        // Itens por página
        dom.selectPorPagina.addEventListener('change', (e) => {
            state.paginacao.itensPorPagina = parseInt(e.target.value, 10) || 25;
            state.paginacao.paginaAtual = 1;
            aplicarFiltrosEOrdenar();
        });

        // Cliques na paginação
        dom.paginacaoBotoes.addEventListener('click', (e) => {
            const btn = e.target.closest('.sec-page-btn');
            if (!btn || btn.disabled) return;
            const pagina = parseInt(btn.dataset.page, 10);
            if (!Number.isNaN(pagina) && pagina > 0) {
                state.paginacao.paginaAtual = pagina;
                renderTabela();
                renderPaginacao(
                    state.alunosFiltrados.length,
                    Math.ceil(state.alunosFiltrados.length / state.paginacao.itensPorPagina) || 1
                );
            }
        });

        // Clique na tabela para ver detalhes
        dom.corpoTabela.addEventListener('click', (e) => {
            const tr = e.target.closest('tr[data-aluno-id]');
            if (!tr) return;
            const alunoId = tr.dataset.alunoId;
            abrirDetalhesAluno(alunoId);
        });

        // Botão manual de recarregar
        dom.btnRecarregar.addEventListener('click', () => carregarDados(false));

        // Fechar drawer
        dom.btnFecharDrawer.addEventListener('click', fecharDrawer);
        dom.btnFecharDrawerRodape.addEventListener('click', fecharDrawer);
        dom.drawerBackdrop.addEventListener('click', fecharDrawer);

        // Teclado (ESC fecha drawer)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && dom.drawerDetalhes.classList.contains('active')) {
                fecharDrawer();
            }
        });
    }

    // Inicialização
    document.addEventListener('DOMContentLoaded', () => {
        initElements();
        initListeners();
        carregarDados(false);

        // Polling de atualização automática a cada 60 segundos
        state.timerAutoRefresh = setInterval(() => carregarDados(true), 60000);
    });
})();
