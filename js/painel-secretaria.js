/**
 * painel-secretaria.js — Dados do painel da secretaria (Issue #369)
 *
 * Preenche html/secretaria/painel.html com dado real:
 *
 *   Alunos, matrículas, solicitações      GET /secretaria/dashboard/resumo
 *   Documentos pendentes                  GET /secretaria/autorizacoes (kpis)
 *   Frequência geral e por turma          GET /secretaria/frequencia/consolidada
 *   Comunicados                           GET /comunicados
 *   Alunos por turma                      GET /secretaria/turmas
 *   Justificativas para analisar          GET /secretaria/justificativas?status=pendente
 *   Agenda da escola                      GET /secretaria/calendario
 *
 * Tudo que vem da API entra escapado — nome do aluno e motivo da
 * justificativa inclusive, que são escritos pelo responsável.
 * As peças comuns com o painel da direção vivem em js/painel-dados.js.
 */
(function () {
    'use strict';

    var D = window.PainelDados;

    function numero(v) {
        var n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }

    function carregarResumo() {
        return D.buscar('/secretaria/dashboard/resumo')
            .then(function (json) {
                var d = json.data || {};
                D.kpi(
                    'sec-alunos',
                    String(numero(d.totalAlunos)),
                    'Em ' +
                        numero(d.totalTurmas) +
                        ' turma' +
                        (numero(d.totalTurmas) === 1 ? '' : 's')
                );
                D.kpi('sec-matriculas', String(numero(d.totalMatriculas)), 'Cursando');
                var pend = numero(d.justificativasPendentes);
                D.kpi(
                    'sec-solicitacoes',
                    String(pend),
                    pend ? 'Justificativas a analisar' : 'Nenhuma justificativa pendente'
                );
                return d;
            })
            .catch(function () {
                ['sec-alunos', 'sec-matriculas', 'sec-solicitacoes'].forEach(function (k) {
                    D.kpi(k, '—', 'Não foi possível carregar');
                });
                return null;
            });
    }

    function carregarAutorizacoes() {
        return D.buscar('/secretaria/autorizacoes')
            .then(function (json) {
                var pend = numero(json.kpis && json.kpis.totalPendentes);
                D.kpi(
                    'sec-documentos',
                    String(pend),
                    pend ? 'Alunos com autorização em aberto' : 'Autorizações em dia'
                );
                return pend;
            })
            .catch(function () {
                D.kpi('sec-documentos', '—', 'Não foi possível carregar');
                return null;
            });
    }

    function carregarTurmas() {
        return D.buscar('/secretaria/turmas')
            .then(function (json) {
                var turmas = Array.isArray(json.data) ? json.data : [];
                if (!turmas.length) {
                    D.lista(
                        'pnAtLista',
                        D.vazio(
                            'Nenhuma turma cadastrada.',
                            'Cadastre as turmas para matricular e distribuir os alunos.'
                        )
                    );
                    return;
                }
                var maior = turmas.reduce(function (m, t) {
                    return Math.max(m, numero(t.totalAlunos));
                }, 0);
                var itens = turmas
                    .map(function (t) {
                        var n = numero(t.totalAlunos);
                        return {
                            rotulo: t.nome || t.id || 'Turma',
                            pct: maior ? (n / maior) * 100 : 0,
                            texto: String(n),
                            alerta: false,
                        };
                    })
                    .sort(D.porNome);
                D.lista('pnAtLista', itens.map(D.barra).join(''));
            })
            .catch(function () {
                D.lista('pnAtLista', D.erro('as turmas'));
            });
    }

    function carregarJustificativas() {
        return D.buscar('/secretaria/justificativas?status=pendente')
            .then(function (json) {
                var itens = Array.isArray(json.data) ? json.data : [];
                if (!itens.length) {
                    D.lista(
                        'secPendingList',
                        D.vazio(
                            'Nenhuma justificativa pendente.',
                            'Quando um responsável justificar uma falta, ela aparece aqui para análise.'
                        )
                    );
                    return;
                }
                D.lista(
                    'secPendingList',
                    itens
                        .slice(0, 5)
                        .map(function (j) {
                            return (
                                '<li><a class="pn-pend" href="justificativas.html">' +
                                '<span class="pn-ev-txt"><strong>' +
                                D.esc(j.alunoNome) +
                                '</strong><span>' +
                                D.esc(j.motivo) +
                                '</span></span>' +
                                '<span class="ui-pill pn-pill-alerta">Analisar</span>' +
                                '</a></li>'
                            );
                        })
                        .join('')
                );
            })
            .catch(function () {
                D.lista('secPendingList', D.erro('as justificativas'));
            });
    }

    function renderizarDocumentos(resumo, autorizacoesPendentes) {
        var emitidos = resumo ? numero(resumo.docsEmitidos) : null;
        var linhas = [
            {
                rotulo: 'Autorizações dos pais em aberto',
                href: '/detalhes/autorizacoes-pais.html',
                pill:
                    autorizacoesPendentes === null
                        ? '<span class="ui-pill ui-pill--muted">—</span>'
                        : autorizacoesPendentes
                          ? '<span class="ui-pill pn-pill-alerta">' +
                            autorizacoesPendentes +
                            '</span>'
                          : '<span class="ui-pill ui-pill--muted">em dia</span>',
            },
            {
                rotulo: 'Documentos emitidos no ano',
                href: 'documentos.html',
                pill:
                    '<span class="ui-pill ui-pill--muted">' +
                    (emitidos === null ? '—' : emitidos) +
                    '</span>',
            },
            {
                rotulo: 'Importar lista de alunos',
                href: 'importar-alunos.html',
                pill: '<span class="ui-pill ui-pill--muted">CSV, PDF, XLSX</span>',
            },
            {
                rotulo: 'Relatórios e exportação',
                href: 'relatorios.html',
                pill: '<span class="ui-pill ui-pill--muted">CSV</span>',
            },
        ];
        D.lista(
            'pnDocLista',
            linhas
                .map(function (l) {
                    return (
                        '<li><a class="pn-pend" href="' +
                        D.esc(l.href) +
                        '"><span class="pn-pend-txt">' +
                        D.esc(l.rotulo) +
                        '</span>' +
                        l.pill +
                        '</a></li>'
                    );
                })
                .join('')
        );
    }

    function saudar() {
        var user = window.auth && window.auth.getCurrentUser ? window.auth.getCurrentUser() : null;
        var nome = user && user.nome ? user.nome : '';
        var titulo = document.getElementById('secWelcome');
        if (titulo) titulo.textContent = 'Olá, ' + (nome.split(' ')[0] || 'Secretaria') + '! 👋';
        var cargo = window.rotuloPerfilAtivo
            ? window.rotuloPerfilAtivo(user, window.escolaAtivaId && window.escolaAtivaId())
            : 'Secretaria';
        if (window.PainelUI) window.PainelUI.preencherConta(nome, cargo);
        var hoje = document.getElementById('pnHoje');
        if (hoje) hoje.textContent = D.hojePorExtenso();
    }

    // O "Sair" do painel antigo chamava window.sair, que só existe no
    // js/dashboard.js — nesta tela o botão não fazia nada.
    function sair() {
        if (!window.confirm('Deseja realmente sair do sistema?')) return;
        if (window.auth && window.auth.logout) {
            window.auth.logout().catch(function () {
                sessionStorage.clear();
                window.location.href = '../login.html';
            });
        } else {
            sessionStorage.clear();
            window.location.href = '../login.html';
        }
    }

    function iniciar() {
        if (typeof window.sair !== 'function') window.sair = sair;
        document.querySelectorAll('[data-pn-sair]').forEach(function (b) {
            b.addEventListener('click', function () {
                window.sair();
            });
        });

        saudar();
        D.frequencia('sec-frequencia', 'pnFreqLista');
        D.comunicados('sec-comunicados', 'pnComLista');
        D.agenda('pnEvLista');
        carregarTurmas();
        carregarJustificativas();
        return Promise.all([carregarResumo(), carregarAutorizacoes()]).then(function (r) {
            renderizarDocumentos(r[0], r[1]);
        });
    }

    window.PainelSecretaria = { iniciar: iniciar };

    document.addEventListener('DOMContentLoaded', function () {
        var pronto = Promise.resolve();
        if (window.db && window.db.init) pronto = pronto.then(window.db.init.bind(window.db));
        if (window.auth && window.auth.init)
            pronto = pronto.then(window.auth.init.bind(window.auth));
        pronto
            .catch(function () {
                /* segue: a checagem abaixo decide */
            })
            .then(function () {
                if (window.auth && window.auth.isAuthenticated && !window.auth.isAuthenticated()) {
                    window.location.href = '../login.html';
                    return;
                }
                iniciar();
            });
    });
})();
