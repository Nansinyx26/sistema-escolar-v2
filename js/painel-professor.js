/**
 * painel-professor.js — Dados do painel do professor (Issue #367)
 *
 * Chamado por js/dashboard.js quando o perfil ativo é `professor`. Liga os
 * blocos [data-perfil-bloco="professor"] e preenche cada um com dado real:
 *
 *   Turmas ativas, próxima aula e agenda  GET /dashboard/teacher-panel
 *   Avaliações sem nota                   GET /avaliacoes-escolares
 *   Frequência hoje                       GET /faltas?data=<hoje>
 *
 * Cada bloco tem três estados além do preenchido: carregando (skeleton, já no
 * HTML), vazio (diz o que fazer) e erro (diz o que falhou e oferece tentar de
 * novo). Nenhum número é inventado: sem fonte, o cartão mostra "—".
 */
(function () {
    'use strict';

    var FUSO = 'America/Sao_Paulo';

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

    /** GET na API; resolve `json.data` ou rejeita com uma mensagem legível. */
    function buscar(caminho) {
        return fetch(base() + caminho, { credentials: 'include' }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json().then(function (json) {
                if (!json || json.success === false)
                    throw new Error((json && json.error) || 'Resposta inválida');
                return json.data;
            });
        });
    }

    /** Data de hoje no fuso da escola, no formato gravado pela chamada (AAAA-MM-DD). */
    function hojeISO() {
        var partes = new Intl.DateTimeFormat('en-CA', {
            timeZone: FUSO,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());
        return partes;
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

    function kpiErro(nome, sub) {
        kpi(nome, '—', sub || 'Não foi possível carregar');
    }

    // ───────────────────────────── Agenda do dia ─────────────────────────────

    function estadoDaAula(aula, ehProxima) {
        if (aula.livre) return { chave: 'livre', rotulo: 'Livre' };
        if (aula.status === 'Concluída') return { chave: 'concluida', rotulo: 'Concluída' };
        if (aula.status === 'Agora') return { chave: 'agora', rotulo: 'Agora' };
        return { chave: ehProxima ? 'proxima' : 'depois', rotulo: ehProxima ? 'Próxima' : 'Aula' };
    }

    function linkDoHorario() {
        var item = document.getElementById('sidebar-horario');
        return (item && item.getAttribute('href')) || 'meu-horario.html';
    }

    function renderizarAgenda(aulas) {
        var lista = document.getElementById('pnAgendaLista');
        if (!lista) return;
        lista.setAttribute('aria-busy', 'false');

        if (!aulas.length) {
            lista.innerHTML =
                '<li class="pn-vazio"><strong>Nenhuma aula na grade para hoje.</strong>' +
                'A agenda sai da grade horária da escola. Se hoje você tem aula, peça à direção ' +
                'para conferir a sua grade.</li>';
            lista.style.removeProperty('--pn-progresso');
            return;
        }

        var href = linkDoHorario();
        var indiceProxima = -1;
        for (var i = 0; i < aulas.length; i++) {
            var a = aulas[i];
            if (!a.livre && a.status !== 'Concluída' && a.status !== 'Agora') {
                indiceProxima = i;
                break;
            }
        }

        var concluidas = 0;
        lista.innerHTML = aulas
            .map(function (aula, idx) {
                var estado = estadoDaAula(aula, idx === indiceProxima);
                if (estado.chave === 'concluida') concluidas += 1;
                var faixa = String(aula.horarioRange || aula.hora || '').replace(' - ', ' – ');
                var detalhe = aula.livre
                    ? 'Sem turma neste horário'
                    : [aula.turma, aula.sala].filter(Boolean).join(' · ');
                var pill =
                    estado.chave === 'concluida' || estado.chave === 'livre'
                        ? 'ui-pill ui-pill--muted'
                        : 'ui-pill';
                return (
                    '<li class="pn-aula" data-estado="' +
                    estado.chave +
                    '">' +
                    '<a class="pn-aula-link" href="' +
                    esc(href) +
                    '">' +
                    '<span class="pn-aula-no" aria-hidden="true"></span>' +
                    '<span class="pn-aula-hora">' +
                    esc(faixa) +
                    '</span>' +
                    '<span class="pn-aula-materia"><strong>' +
                    esc(aula.materia) +
                    '</strong>' +
                    (detalhe ? '<span>' + esc(detalhe) + '</span>' : '') +
                    '</span>' +
                    '<span class="' +
                    pill +
                    '">' +
                    estado.rotulo +
                    '</span>' +
                    '</a></li>'
                );
            })
            .join('');

        // A linha de giz acende até a última aula concluída.
        var progresso = aulas.length > 1 ? Math.round((concluidas / (aulas.length - 1)) * 100) : 0;
        lista.style.setProperty('--pn-progresso', Math.min(progresso, 100) + '%');
    }

    function agendaErro(recarregar) {
        var lista = document.getElementById('pnAgendaLista');
        if (!lista) return;
        lista.setAttribute('aria-busy', 'false');
        lista.innerHTML =
            '<li class="pn-vazio"><strong>Não foi possível carregar a agenda.</strong>' +
            'Confira a conexão e tente de novo.' +
            '<button type="button" class="ui-btn" data-pn-recarregar>Tentar de novo</button></li>';
        var botao = lista.querySelector('[data-pn-recarregar]');
        if (botao) botao.addEventListener('click', recarregar);
    }

    function carregarPainel() {
        return buscar('/dashboard/teacher-panel')
            .then(function (dados) {
                var turmas = Array.isArray(dados.turmas) ? dados.turmas : [];
                kpi(
                    'turmas',
                    String(turmas.length),
                    turmas.length ? turmas.join(', ') : 'Nenhuma turma vinculada'
                );

                var aulas = (Array.isArray(dados.proximasAulas) ? dados.proximasAulas : []).filter(
                    function (a) {
                        return a && a.materia;
                    }
                );
                var proxima = aulas.filter(function (a) {
                    return !a.livre && a.status !== 'Concluída';
                })[0];
                if (proxima) {
                    kpi(
                        'proxima',
                        esc(proxima.status === 'Agora' ? 'Agora' : proxima.hora),
                        [proxima.turma, proxima.materia].filter(Boolean).join(' • ')
                    );
                } else {
                    kpi(
                        'proxima',
                        '—',
                        aulas.length ? 'Aulas de hoje concluídas' : 'Sem aulas na grade hoje'
                    );
                }

                renderizarAgenda(aulas);
                return turmas.length;
            })
            .catch(function () {
                kpiErro('turmas');
                kpiErro('proxima');
                agendaErro(function () {
                    var lista = document.getElementById('pnAgendaLista');
                    if (lista) lista.setAttribute('aria-busy', 'true');
                    carregarPainel();
                });
                return null;
            });
    }

    // ───────────────────────────── Avaliações ────────────────────────────────

    function carregarAvaliacoes() {
        return buscar('/avaliacoes-escolares')
            .then(function (lista) {
                lista = Array.isArray(lista) ? lista : [];
                var semNota = lista.filter(function (a) {
                    return !a.totalNotas;
                }).length;
                var sub = !lista.length
                    ? 'Nenhuma avaliação criada'
                    : semNota
                      ? 'Lançar notas'
                      : 'Todas com notas lançadas';
                kpi('avaliacoes', String(semNota), sub);
            })
            .catch(function () {
                kpiErro('avaliacoes');
            });
    }

    // ───────────────────────────── Frequência ────────────────────────────────

    function carregarFrequencia(totalTurmas) {
        return buscar('/faltas?data=' + encodeURIComponent(hojeISO()))
            .then(function (registros) {
                registros = Array.isArray(registros) ? registros : [];
                var comChamada = {};
                registros.forEach(function (r) {
                    if (r && r.turma) comChamada[r.turma] = true;
                });
                var feitas = Object.keys(comChamada).length;

                if (!totalTurmas) {
                    kpi(
                        'frequencia',
                        String(feitas),
                        feitas ? 'turmas com chamada hoje' : 'Nenhuma turma vinculada'
                    );
                    return;
                }
                var total = Math.max(totalTurmas, feitas);
                kpi(
                    'frequencia',
                    feitas + '<small>/' + total + '</small>',
                    feitas >= total ? 'Chamada em dia' : 'turmas com chamada hoje'
                );
            })
            .catch(function () {
                kpiErro('frequencia');
            });
    }

    // ───────────────────────────── Início ────────────────────────────────────

    function iniciar() {
        document.querySelectorAll('[data-perfil-bloco="professor"]').forEach(function (el) {
            el.hidden = false;
        });

        var hoje = document.getElementById('pnHoje');
        var dataAgenda = document.getElementById('pnAgendaData');
        var extenso = hojePorExtenso();
        if (hoje) hoje.textContent = extenso;
        if (dataAgenda) dataAgenda.textContent = extenso;

        var href = linkDoHorario();
        document.querySelectorAll('[data-kpi-link="horario"]').forEach(function (a) {
            a.setAttribute('href', href);
        });

        carregarAvaliacoes();
        return carregarPainel().then(function (totalTurmas) {
            return carregarFrequencia(totalTurmas);
        });
    }

    window.PainelProfessor = { iniciar: iniciar };
})();
