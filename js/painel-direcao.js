/**
 * painel-direcao.js — Dados do painel da direção (Issue #368)
 *
 * Chamado por js/dashboard.js quando o perfil é `diretor`. Liga os blocos
 * [data-perfil-bloco="direcao"] e preenche cada um com dado real:
 *
 *   Alunos, professores, turmas          GET /dashboard/summary (js/dashboard.js
 *                                        busca e repassa em receberResumo)
 *   Frequência geral e por turma         GET /secretaria/frequencia/consolidada
 *   Avaliações sem nota                  GET /avaliacoes-escolares
 *   Comunicados dos últimos 30 dias      GET /comunicados
 *   Desempenho por turma                 GET /dashboard/chart-data
 *   Agenda da direção                    GET /secretaria/calendario
 *   Pendências                           GET /secretaria/dashboard/resumo e
 *                                        GET /conformidade/frequencia/alertas
 *
 * As peças comuns com o painel da secretaria vivem em js/painel-dados.js.
 */
(function () {
    'use strict';

    var D = window.PainelDados;

    function carregarDesempenho() {
        return D.buscar('/dashboard/chart-data')
            .then(function (json) {
                var turmas = (
                    json.data && Array.isArray(json.data.turmas) ? json.data.turmas : []
                ).filter(function (t) {
                    return (
                        t &&
                        t.value !== null &&
                        t.value !== undefined &&
                        !Number.isNaN(Number(t.value))
                    );
                });
                if (!turmas.length) {
                    D.lista(
                        'pnDesLista',
                        D.vazio(
                            'Nenhuma nota lançada ainda.',
                            'As médias por turma aparecem depois do lançamento das notas.'
                        )
                    );
                    return;
                }
                var itens = turmas
                    .map(function (t) {
                        var media = Number(t.value);
                        return {
                            rotulo: t.label,
                            pct: media * 10,
                            texto: media.toFixed(1).replace('.', ','),
                            alerta: media < 5,
                        };
                    })
                    .sort(D.porNome);
                D.lista('pnDesLista', itens.map(D.barra).join(''));
            })
            .catch(function () {
                D.lista('pnDesLista', D.erro('o desempenho'));
            });
    }

    function carregarAvaliacoes() {
        return D.buscar('/avaliacoes-escolares')
            .then(function (json) {
                var avs = Array.isArray(json.data) ? json.data : [];
                var semNota = avs.filter(function (a) {
                    return !a.totalNotas;
                }).length;
                D.kpi(
                    'dir-avaliacoes',
                    String(semNota),
                    !avs.length
                        ? 'Nenhuma avaliação criada'
                        : semNota
                          ? 'Aguardando notas'
                          : 'Todas com notas'
                );
                return semNota;
            })
            .catch(function () {
                D.kpi('dir-avaliacoes', '—', 'Não foi possível carregar');
                return null;
            });
    }

    function contar(caminho, ler) {
        return D.buscar(caminho)
            .then(ler)
            .catch(function () {
                return null;
            });
    }

    function iniciar() {
        document.querySelectorAll('[data-perfil-bloco="direcao"]').forEach(function (el) {
            el.hidden = false;
        });

        var hoje = document.getElementById('pnHoje');
        if (hoje) hoje.textContent = D.hojePorExtenso();

        D.comunicados('dir-comunicados');
        D.agenda('pnEvLista');
        carregarDesempenho();

        return Promise.all([
            D.frequencia('dir-frequencia', 'pnFreqLista'),
            carregarAvaliacoes(),
            contar('/secretaria/dashboard/resumo', function (json) {
                return json.data ? Number(json.data.justificativasPendentes) || 0 : null;
            }),
            contar('/conformidade/frequencia/alertas', function (json) {
                return typeof json.total === 'number' ? json.total : (json.data || []).length;
            }),
        ]).then(function (r) {
            var freq = r[0];
            D.pendencias('pnPendLista', [
                {
                    rotulo: 'Justificativas de falta aguardando análise',
                    valor: r[2],
                    href: 'secretaria/justificativas.html',
                },
                {
                    rotulo: 'Avaliações sem nota lançada',
                    valor: r[1],
                    href: '../detalhes/avaliacoes.html',
                },
                {
                    rotulo: 'Turmas com presença abaixo de 75%',
                    valor: freq.ok ? freq.abaixo : null,
                    href: '#pnFrequenciaTurmas',
                },
                {
                    rotulo: 'Alunos em alerta de frequência',
                    valor: r[3],
                    href: '../detalhes/alunos.html',
                },
            ]);
        });
    }

    /** Resumo de /dashboard/summary, que js/dashboard.js já buscou. */
    function receberResumo(dados) {
        if (!dados) return;
        var risco = Number(dados.alunosRisco) || 0;
        var legenda = document.querySelector('[data-kpi-sub="dir-alunos"]');
        if (legenda) {
            legenda.textContent = risco
                ? risco + ' com média abaixo de 5'
                : 'Nenhum com média abaixo de 5';
        }
        var resumo = document.getElementById('pnDesResumo');
        if (resumo && Number(dados.mediaGeral) > 0) {
            resumo.textContent =
                'Média geral da escola: ' +
                Number(dados.mediaGeral).toFixed(1).replace('.', ',') +
                '. Por turma, de 0 a 10.';
        }
    }

    window.PainelDirecao = { iniciar: iniciar, receberResumo: receberResumo };
})();
