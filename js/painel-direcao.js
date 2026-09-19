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
 * O limite de 75% de presença é regra da LDB (docs/CONFORMIDADE-LEGAL.md),
 * não escolha de tela. Sem fonte, o bloco diz o que falta; nada é inventado.
 */
(function () {
    'use strict';

    var FUSO = 'America/Sao_Paulo';
    var PRESENCA_MINIMA = 75;
    var DIAS_COMUNICADOS = 30;

    var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
    function esc(v) {
        if (v === null || v === undefined) return '';
        return String(v).replace(/[&<>"'`]/g, function (c) {
            return ESC[c];
        });
    }

    function base() {
        return window.API_BASE_URL || '/api';
    }

    /** GET na API; resolve o JSON inteiro ou rejeita. */
    function buscar(caminho) {
        return fetch(base() + caminho, { credentials: 'include' }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json().then(function (json) {
                if (!json || json.success === false)
                    throw new Error((json && json.error) || 'Resposta inválida');
                return json;
            });
        });
    }

    function hojeISO() {
        return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
    }

    function kpi(nome, valorHtml, sub) {
        var valor = document.querySelector('[data-kpi="' + nome + '"]');
        var legenda = document.querySelector('[data-kpi-sub="' + nome + '"]');
        if (valor) valor.innerHTML = valorHtml;
        if (legenda) legenda.textContent = sub || '';
    }

    function lista(id, html) {
        var el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('aria-busy', 'false');
        el.innerHTML = html;
    }

    function vazio(titulo, texto) {
        return '<li class="pn-vazio"><strong>' + esc(titulo) + '</strong>' + esc(texto) + '</li>';
    }

    function porNome(a, b) {
        return String(a.rotulo).localeCompare(String(b.rotulo), 'pt-BR', { numeric: true });
    }

    /** Linha de barra: rótulo, trilho com a barra e o valor. */
    function barra(item) {
        return (
            '<li class="pn-barra' +
            (item.alerta ? ' pn-barra--alerta' : '') +
            '">' +
            '<span class="pn-barra-rot">' +
            esc(item.rotulo) +
            '</span>' +
            '<span class="pn-barra-trilho" aria-hidden="true"><span class="pn-barra-valor" style="width:' +
            Math.max(0, Math.min(100, item.pct)) +
            '%"></span></span>' +
            '<span class="pn-barra-num ui-num">' +
            esc(item.texto) +
            '</span>' +
            '</li>'
        );
    }

    // ───────────────────────────── Frequência ────────────────────────────────

    function carregarFrequencia() {
        var inicioAno = hojeISO().slice(0, 4) + '-01-01';
        return buscar('/secretaria/frequencia/consolidada?dataInicio=' + inicioAno)
            .then(function (json) {
                var linhas = Array.isArray(json.data) ? json.data : [];
                var turmas = {};
                var presencas = 0;
                var registros = 0;
                linhas.forEach(function (l) {
                    var chave = l.turma && l.turma !== 'N/A' ? String(l.turma) : 'Sem turma';
                    if (!turmas[chave]) turmas[chave] = { presencas: 0, registros: 0 };
                    turmas[chave].presencas += Number(l.presencas) || 0;
                    turmas[chave].registros += Number(l.totalRegistros) || 0;
                    presencas += Number(l.presencas) || 0;
                    registros += Number(l.totalRegistros) || 0;
                });

                if (!registros) {
                    kpi('dir-frequencia', '—', 'Nenhuma chamada registrada');
                    lista(
                        'pnFreqLista',
                        vazio(
                            'Nenhuma chamada registrada neste ano.',
                            'A frequência aparece aqui assim que os professores fizerem a chamada.'
                        )
                    );
                    return { abaixo: 0, ok: true };
                }

                var geral = Math.round((presencas / registros) * 100);
                kpi('dir-frequencia', geral + '<small>%</small>', 'Presença no ano letivo');

                var itens = Object.keys(turmas)
                    .filter(function (t) {
                        return turmas[t].registros > 0;
                    })
                    .map(function (t) {
                        var pct = Math.round((turmas[t].presencas / turmas[t].registros) * 100);
                        return {
                            rotulo: t,
                            pct: pct,
                            texto: pct + '%',
                            alerta: pct < PRESENCA_MINIMA,
                        };
                    })
                    .sort(porNome);

                lista('pnFreqLista', itens.map(barra).join(''));
                return {
                    abaixo: itens.filter(function (i) {
                        return i.alerta;
                    }).length,
                    ok: true,
                };
            })
            .catch(function () {
                kpi('dir-frequencia', '—', 'Não foi possível carregar');
                lista(
                    'pnFreqLista',
                    vazio(
                        'Não foi possível carregar a frequência.',
                        'Recarregue a página para tentar de novo.'
                    )
                );
                return { abaixo: null, ok: false };
            });
    }

    // ───────────────────────────── Desempenho ────────────────────────────────

    function carregarDesempenho() {
        return buscar('/dashboard/chart-data')
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
                    lista(
                        'pnDesLista',
                        vazio(
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
                    .sort(porNome);
                lista('pnDesLista', itens.map(barra).join(''));
            })
            .catch(function () {
                lista(
                    'pnDesLista',
                    vazio(
                        'Não foi possível carregar o desempenho.',
                        'Recarregue a página para tentar de novo.'
                    )
                );
            });
    }

    // ───────────────────────────── Avaliações e comunicados ──────────────────

    function carregarAvaliacoes() {
        return buscar('/avaliacoes-escolares')
            .then(function (json) {
                var avs = Array.isArray(json.data) ? json.data : [];
                var semNota = avs.filter(function (a) {
                    return !a.totalNotas;
                }).length;
                kpi(
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
                kpi('dir-avaliacoes', '—', 'Não foi possível carregar');
                return null;
            });
    }

    function carregarComunicados() {
        return buscar('/comunicados')
            .then(function (json) {
                var todos = Array.isArray(json.data) ? json.data : [];
                var limite = Date.now() - DIAS_COMUNICADOS * 24 * 60 * 60 * 1000;
                var recentes = todos.filter(function (c) {
                    var t = new Date(c.dataCriacao || c.createdAt).getTime();
                    return !Number.isNaN(t) && t >= limite;
                }).length;
                kpi(
                    'dir-comunicados',
                    String(recentes),
                    'Nos últimos ' + DIAS_COMUNICADOS + ' dias'
                );
            })
            .catch(function () {
                kpi('dir-comunicados', '—', 'Não foi possível carregar');
            });
    }

    // ───────────────────────────── Agenda da direção ─────────────────────────

    var TIPOS = {
        aula: 'Dia letivo',
        feriado: 'Feriado',
        recesso: 'Recesso',
        reuniao_pais: 'Reunião de pais',
        conselho_classe: 'Conselho de classe',
        prova: 'Avaliações',
    };

    function dataCurta(d) {
        return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: '2-digit', month: 'short' })
            .format(d)
            .replace('.', '');
    }

    function carregarAgenda() {
        var hoje = hojeISO();
        return buscar('/secretaria/calendario?anoLetivo=' + hoje.slice(0, 4))
            .then(function (json) {
                var eventos = (Array.isArray(json.data) ? json.data : [])
                    .filter(function (ev) {
                        var fim = new Date(ev.dataFim || ev.dataInicio);
                        return (
                            !Number.isNaN(fim.getTime()) && fim.toISOString().slice(0, 10) >= hoje
                        );
                    })
                    .slice(0, 5);

                if (!eventos.length) {
                    lista(
                        'pnEvLista',
                        vazio(
                            'Nenhum evento marcado daqui para a frente.',
                            'Reuniões, conselhos e feriados do calendário escolar aparecem aqui.'
                        )
                    );
                    return;
                }

                lista(
                    'pnEvLista',
                    eventos
                        .map(function (ev) {
                            var ini = new Date(ev.dataInicio);
                            var fim = new Date(ev.dataFim || ev.dataInicio);
                            var mesmoDia =
                                ini.toISOString().slice(0, 10) === fim.toISOString().slice(0, 10);
                            var quando = mesmoDia
                                ? dataCurta(ini)
                                : dataCurta(ini) + ' – ' + dataCurta(fim);
                            return (
                                '<li class="pn-ev">' +
                                '<span class="pn-ev-data ui-num">' +
                                esc(quando) +
                                '</span>' +
                                '<span class="pn-ev-txt"><strong>' +
                                esc(ev.titulo) +
                                '</strong><span>' +
                                esc(TIPOS[ev.tipo] || 'Evento') +
                                '</span></span>' +
                                '</li>'
                            );
                        })
                        .join('')
                );
            })
            .catch(function () {
                lista(
                    'pnEvLista',
                    vazio(
                        'Não foi possível carregar a agenda.',
                        'Recarregue a página para tentar de novo.'
                    )
                );
            });
    }

    // ───────────────────────────── Pendências ────────────────────────────────

    function renderizarPendencias(itens) {
        lista(
            'pnPendLista',
            itens
                .map(function (p) {
                    var em_dia = p.valor === 0;
                    var valor =
                        p.valor === null
                            ? '<span class="ui-pill ui-pill--muted">—</span>'
                            : em_dia
                              ? '<span class="ui-pill ui-pill--muted">em dia</span>'
                              : '<span class="ui-pill pn-pill-alerta">' + p.valor + '</span>';
                    return (
                        '<li><a class="pn-pend" href="' +
                        esc(p.href) +
                        '">' +
                        '<span class="pn-pend-txt">' +
                        esc(p.rotulo) +
                        '</span>' +
                        valor +
                        '</a></li>'
                    );
                })
                .join('')
        );
    }

    function contarAlertas() {
        return buscar('/conformidade/frequencia/alertas')
            .then(function (json) {
                return typeof json.total === 'number' ? json.total : (json.data || []).length;
            })
            .catch(function () {
                return null;
            });
    }

    function contarJustificativas() {
        return buscar('/secretaria/dashboard/resumo')
            .then(function (json) {
                return json.data ? Number(json.data.justificativasPendentes) || 0 : null;
            })
            .catch(function () {
                return null;
            });
    }

    // ───────────────────────────── Início ────────────────────────────────────

    function iniciar() {
        document.querySelectorAll('[data-perfil-bloco="direcao"]').forEach(function (el) {
            el.hidden = false;
        });

        var hoje = document.getElementById('pnHoje');
        if (hoje) {
            var txt = new Intl.DateTimeFormat('pt-BR', {
                timeZone: FUSO,
                weekday: 'long',
                day: 'numeric',
                month: 'long',
            }).format(new Date());
            hoje.textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
        }

        carregarComunicados();
        carregarDesempenho();
        carregarAgenda();

        return Promise.all([
            carregarFrequencia(),
            carregarAvaliacoes(),
            contarJustificativas(),
            contarAlertas(),
        ]).then(function (r) {
            var freq = r[0];
            renderizarPendencias([
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
        if (legenda)
            legenda.textContent = risco
                ? risco + ' com média abaixo de 5'
                : 'Nenhum com média abaixo de 5';
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
