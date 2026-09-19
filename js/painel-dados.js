/**
 * painel-dados.js — Peças de dados comuns aos painéis (épico #370)
 *
 * Usado por js/painel-direcao.js (#368) e js/painel-secretaria.js (#369):
 * busca na API, escrita nos cartões e listas, barras por turma e os três
 * blocos que os dois painéis mostram igual — frequência por turma,
 * comunicados recentes e agenda do calendário escolar.
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

    function hojePorExtenso() {
        var txt = new Intl.DateTimeFormat('pt-BR', {
            timeZone: FUSO,
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        }).format(new Date());
        return txt.charAt(0).toUpperCase() + txt.slice(1);
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

    function erro(oQue) {
        return vazio(
            'Não foi possível carregar ' + oQue + '.',
            'Recarregue a página para tentar de novo.'
        );
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

    /**
     * Frequência no ano letivo, geral (no cartão `kpiNome`) e por turma (na
     * lista `listaId`). Resolve { abaixo, ok }: quantas turmas estão abaixo de
     * 75% e se a fonte respondeu.
     */
    function frequencia(kpiNome, listaId) {
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
                    kpi(kpiNome, '—', 'Nenhuma chamada registrada');
                    lista(
                        listaId,
                        vazio(
                            'Nenhuma chamada registrada neste ano.',
                            'A frequência aparece aqui assim que os professores fizerem a chamada.'
                        )
                    );
                    return { abaixo: 0, ok: true };
                }

                var geral = Math.round((presencas / registros) * 100);
                kpi(kpiNome, geral + '<small>%</small>', 'Presença no ano letivo');

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

                lista(listaId, itens.map(barra).join(''));
                return {
                    abaixo: itens.filter(function (i) {
                        return i.alerta;
                    }).length,
                    ok: true,
                };
            })
            .catch(function () {
                kpi(kpiNome, '—', 'Não foi possível carregar');
                lista(listaId, erro('a frequência'));
                return { abaixo: null, ok: false };
            });
    }

    /**
     * Comunicados dos últimos 30 dias no cartão `kpiNome`; se `listaId` vier,
     * os quatro mais recentes viram lista. Resolve a lista inteira (ou null).
     */
    function comunicados(kpiNome, listaId) {
        return buscar('/comunicados')
            .then(function (json) {
                var todos = Array.isArray(json.data) ? json.data : [];
                var limite = Date.now() - DIAS_COMUNICADOS * 24 * 60 * 60 * 1000;
                var recentes = todos.filter(function (c) {
                    var t = new Date(c.dataCriacao || c.createdAt).getTime();
                    return !Number.isNaN(t) && t >= limite;
                });
                kpi(kpiNome, String(recentes.length), 'Nos últimos ' + DIAS_COMUNICADOS + ' dias');

                if (listaId) {
                    lista(
                        listaId,
                        !todos.length
                            ? vazio(
                                  'Nenhum comunicado enviado.',
                                  'Os avisos para pais e professores aparecem aqui.'
                              )
                            : todos
                                  .slice(0, 4)
                                  .map(function (c) {
                                      var quando = new Date(c.dataCriacao || c.createdAt);
                                      return (
                                          '<li class="pn-ev">' +
                                          '<span class="pn-ev-data ui-num">' +
                                          esc(
                                              Number.isNaN(quando.getTime())
                                                  ? '—'
                                                  : dataCurta(quando)
                                          ) +
                                          '</span>' +
                                          '<span class="pn-ev-txt"><strong>' +
                                          esc(c.titulo) +
                                          '</strong><span>' +
                                          esc(c.categoria || 'Comunicado') +
                                          '</span></span></li>'
                                      );
                                  })
                                  .join('')
                    );
                }
                return todos;
            })
            .catch(function () {
                kpi(kpiNome, '—', 'Não foi possível carregar');
                if (listaId) lista(listaId, erro('os comunicados'));
                return null;
            });
    }

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

    /** Próximos cinco eventos do calendário escolar na lista `listaId`. */
    function agenda(listaId) {
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
                        listaId,
                        vazio(
                            'Nenhum evento marcado daqui para a frente.',
                            'Reuniões, conselhos e feriados do calendário escolar aparecem aqui.'
                        )
                    );
                    return;
                }

                lista(
                    listaId,
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
                lista(listaId, erro('a agenda'));
            });
    }

    /** Lista de pendências: rótulo, contagem e o link de onde se resolve. */
    function pendencias(listaId, itens) {
        lista(
            listaId,
            itens
                .map(function (p) {
                    var valor =
                        p.valor === null || p.valor === undefined
                            ? '<span class="ui-pill ui-pill--muted">—</span>'
                            : p.valor === 0
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

    window.PainelDados = {
        esc: esc,
        buscar: buscar,
        hojeISO: hojeISO,
        hojePorExtenso: hojePorExtenso,
        kpi: kpi,
        lista: lista,
        vazio: vazio,
        erro: erro,
        barra: barra,
        porNome: porNome,
        frequencia: frequencia,
        comunicados: comunicados,
        agenda: agenda,
        pendencias: pendencias,
    };
})();
