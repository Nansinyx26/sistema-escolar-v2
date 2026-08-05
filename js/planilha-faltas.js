/**
 * planilha-faltas.js — Planilha de Faltas FUNCIONÁRIOS.
 *
 * Uma "página" por mês: ano + mês vivem na query string (?ano=2026&mes=7), de
 * modo que cada competência tem URL própria, dá para favoritar e o botão voltar
 * do navegador anda entre os meses. Os meses anteriores à vigência (julho da
 * implantação) aparecem com cadeado — o backend também recusa, esta trava é só
 * para a tela não prometer o que a API nega.
 *
 * Escopo: professor abre a própria planilha; direção/secretaria escolhem o
 * funcionário no seletor. Quem decide é o backend — aqui a UI apenas reflete
 * `podeEditar` e `ehGestao`.
 */
(function () {
    'use strict';

    var esc = window.escapeHtml || function (v) { return String(v == null ? '' : v); };

    var CAMPOS_MARCA = ['abonadas', 'atestado', 'tre', 'injustificadas'];

    var state = {
        contexto: null,
        ano: null,
        mes: null,
        funcionarioId: '',
        funcionarioNome: '',
        dias: [],
        podeEditar: false,
        dirty: false,
        carregando: false
    };

    // ─────────────────────────────────────────────────────
    // Infra
    // ─────────────────────────────────────────────────────

    function el(id) { return document.getElementById(id); }

    function toast(mensagem, tipo) {
        if (window.utils && window.utils.showToast) window.utils.showToast(mensagem, tipo || 'info');
        else if (window.showToast) window.showToast(mensagem, tipo || 'info');
        else console.log('[planilha-faltas]', tipo || 'info', mensagem);
    }

    function api(path, opts) {
        return window.apiFetch(path, opts);
    }

    function lerQuery() {
        var params = new URLSearchParams(window.location.search);
        var ano = parseInt(params.get('ano'), 10);
        var mes = parseInt(params.get('mes'), 10);
        return {
            ano: Number.isInteger(ano) ? ano : null,
            mes: Number.isInteger(mes) && mes >= 1 && mes <= 12 ? mes : null,
            funcionarioId: params.get('funcionarioId') || ''
        };
    }

    /** Reflete a competência atual na URL — é o que torna cada mês uma "página". */
    function sincronizarUrl() {
        var params = new URLSearchParams();
        params.set('ano', String(state.ano));
        params.set('mes', String(state.mes));
        if (state.funcionarioId && state.contexto && state.funcionarioId !== state.contexto.usuario.id) {
            params.set('funcionarioId', state.funcionarioId);
        }
        var url = window.location.pathname + '?' + params.toString();
        window.history.replaceState({ ano: state.ano, mes: state.mes }, '', url);
    }

    function mesDisponivel(ano, mes) {
        var v = state.contexto && state.contexto.vigencia;
        if (!v) return true;
        if (ano > v.ano) return true;
        if (ano < v.ano) return false;
        return mes >= v.mes;
    }

    function marcarSujo(sujo) {
        state.dirty = sujo;
        var btn = el('btnSalvarPlanilha');
        var status = el('pfStatus');
        if (btn) btn.disabled = !sujo || !state.podeEditar;
        if (!status) return;
        status.className = 'pf-status' + (sujo ? ' is-dirty' : '');
        status.textContent = sujo ? 'Alterações não salvas.' : '';
    }

    function confirmarDescarte() {
        if (!state.dirty) return true;
        return window.confirm('Há alterações não salvas nesta planilha. Deseja descartá-las?');
    }

    // ─────────────────────────────────────────────────────
    // Cabeçalho e navegação
    // ─────────────────────────────────────────────────────

    function renderCabecalho() {
        var ctx = state.contexto;
        if (!ctx) return;

        el('pfEscolaNome').textContent = ctx.escola.nome || 'Escola';

        var meta = [ctx.escola.tipo, ctx.escola.bairro, ctx.escola.municipio]
            .filter(function (p) { return !!p; })
            .join(' • ');
        el('pfEscolaMeta').textContent = meta;

        var nomeMes = (ctx.meses[state.mes - 1] || {}).nome || '';
        el('pfCompetencia').textContent = nomeMes + ' / ' + state.ano;

        var tag = el('pfFuncionarioTag');
        if (state.funcionarioNome) {
            tag.textContent = 'Funcionário(a): ' + state.funcionarioNome;
        } else {
            tag.textContent = '';
        }

        el('pfAvisoTexto').textContent =
            'A partir de ' + ctx.vigencia.rotulo + ', todos os funcionários podem programar e '
            + 'acompanhar suas faltas através dessa planilha. Meses anteriores permanecem bloqueados.';
    }

    function renderAnoNav() {
        var anos = state.contexto.anos;
        el('pfAnoValor').textContent = String(state.ano);
        el('pfAnoAnterior').disabled = state.ano <= anos[0];
        el('pfAnoProximo').disabled = state.ano >= anos[anos.length - 1];
    }

    function renderMeses() {
        var wrap = el('pfMeses');
        wrap.innerHTML = '';

        state.contexto.meses.forEach(function (m) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pf-mes-btn' + (m.mes === state.mes ? ' is-active' : '');
            btn.textContent = m.nome;
            btn.dataset.mes = String(m.mes);

            var liberado = mesDisponivel(state.ano, m.mes);
            btn.disabled = !liberado;
            btn.title = liberado
                ? m.nome + ' / ' + state.ano
                : 'Disponível a partir de ' + state.contexto.vigencia.rotulo;
            if (m.mes === state.mes) btn.setAttribute('aria-current', 'page');

            btn.addEventListener('click', function () {
                if (m.mes === state.mes) return;
                if (!confirmarDescarte()) return;
                state.mes = m.mes;
                sincronizarUrl();
                renderMeses();
                carregarPlanilha();
            });

            wrap.appendChild(btn);
        });
    }

    async function renderSeletorFuncionarios() {
        var ctx = state.contexto;
        if (!ctx.usuario.ehGestao) return;

        var wrap = el('pfFuncionarioWrap');
        var select = el('pfFuncionarioSelect');
        wrap.style.display = 'flex';

        var resp = await api('/faltas-funcionarios/funcionarios');
        if (!resp || !resp.success) {
            toast((resp && resp.error) || 'Não foi possível carregar o quadro de funcionários.', 'error');
            return;
        }

        var lista = resp.data || [];
        // Garante que o próprio gestor apareça mesmo se o vínculo estiver
        // incompleto — ele também lança as próprias faltas por aqui.
        if (!lista.some(function (f) { return f.id === ctx.usuario.id; })) {
            lista.unshift({ id: ctx.usuario.id, nome: ctx.usuario.nome, cargo: ctx.usuario.cargo });
        }

        var CARGO_LABEL = { professor: 'Professor(a)', diretor: 'Direção', secretaria: 'Secretaria', admin: 'Admin' };

        select.innerHTML = '';
        lista.forEach(function (f) {
            var opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = f.nome + ' — ' + (CARGO_LABEL[f.cargo] || f.cargo || '');
            select.appendChild(opt);
        });

        if (!state.funcionarioId || !lista.some(function (f) { return f.id === state.funcionarioId; })) {
            state.funcionarioId = ctx.usuario.id;
        }
        select.value = state.funcionarioId;

        select.addEventListener('change', function () {
            if (!confirmarDescarte()) {
                select.value = state.funcionarioId;
                return;
            }
            state.funcionarioId = select.value;
            sincronizarUrl();
            carregarPlanilha();
        });
    }

    // ─────────────────────────────────────────────────────
    // Tabela
    // ─────────────────────────────────────────────────────

    function estadoTabela(icone, titulo, descricao) {
        var body = el('pfTabelaBody');
        body.innerHTML = '<tr><td colspan="8"><div class="pf-estado">'
            + '<i class="bi ' + esc(icone) + '"></i>'
            + '<h3>' + esc(titulo) + '</h3>'
            + '<p>' + esc(descricao || '') + '</p>'
            + '</div></td></tr>';
        el('pfTabelaFoot').style.display = 'none';
        el('pfTotais').style.display = 'none';
    }

    function criarBotaoMarca(linha, campo, rotulo) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pf-marca';
        btn.dataset.campo = campo;
        btn.textContent = '✕';
        btn.setAttribute('aria-pressed', linha[campo] ? 'true' : 'false');
        btn.setAttribute('aria-label', rotulo + ' — dia ' + linha.dia);
        btn.title = rotulo;
        btn.disabled = !state.podeEditar;

        btn.addEventListener('click', function () {
            linha[campo] = !linha[campo];
            btn.setAttribute('aria-pressed', linha[campo] ? 'true' : 'false');
            atualizarTotais();
            marcarSujo(true);
        });

        return btn;
    }

    function criarLinha(linha, hoje) {
        var tr = document.createElement('tr');
        tr.dataset.dia = String(linha.dia);
        if (!linha.calendario.letivo) tr.classList.add('is-nao-letivo');
        if (hoje && hoje.dia === linha.dia) tr.classList.add('is-hoje');

        // DIA
        var tdDia = document.createElement('td');
        tdDia.className = 'pf-col-dia';
        var num = document.createElement('span');
        num.className = 'pf-dia-num';
        num.textContent = String(linha.dia).padStart(2, '0');
        var semana = document.createElement('span');
        semana.className = 'pf-dia-semana';
        semana.textContent = linha.diaSemana;
        tdDia.appendChild(num);
        tdDia.appendChild(semana);
        tr.appendChild(tdDia);

        // CALENDÁRIO
        var tdCal = document.createElement('td');
        tdCal.className = 'pf-col-calendario';
        var tag = document.createElement('span');
        tag.className = 'pf-cal-tag';
        tag.dataset.tipo = linha.calendario.tipo;
        tag.textContent = linha.calendario.rotulo;
        tag.title = linha.diaSemanaLongo + ' — ' + linha.calendario.rotulo;
        tdCal.appendChild(tag);
        tr.appendChild(tdCal);

        // ABONADAS / ATESTADO
        ['abonadas', 'atestado'].forEach(function (campo) {
            var td = document.createElement('td');
            td.appendChild(criarBotaoMarca(linha, campo, campo === 'abonadas' ? 'Abonada' : 'Atestado'));
            tr.appendChild(td);
        });

        // DESCONTO HORAS
        var tdHoras = document.createElement('td');
        var inputHoras = document.createElement('input');
        inputHoras.type = 'number';
        inputHoras.className = 'pf-horas';
        inputHoras.min = '0';
        inputHoras.max = '24';
        inputHoras.step = '0.5';
        inputHoras.value = linha.descontoHoras ? String(linha.descontoHoras) : '';
        inputHoras.placeholder = '0';
        inputHoras.disabled = !state.podeEditar;
        inputHoras.setAttribute('aria-label', 'Desconto de horas — dia ' + linha.dia);
        inputHoras.addEventListener('input', function () {
            var valor = parseFloat(inputHoras.value);
            if (!isFinite(valor) || valor < 0) valor = 0;
            if (valor > 24) { valor = 24; inputHoras.value = '24'; }
            linha.descontoHoras = valor;
            atualizarTotais();
            marcarSujo(true);
        });
        tdHoras.appendChild(inputHoras);
        tr.appendChild(tdHoras);

        // T.R.E. / (IN) JUSTIFICADAS
        var td = document.createElement('td');
        td.appendChild(criarBotaoMarca(linha, 'tre', 'T.R.E.'));
        tr.appendChild(td);

        var tdInj = document.createElement('td');
        tdInj.appendChild(criarBotaoMarca(linha, 'injustificadas', '(In) Justificada'));
        tr.appendChild(tdInj);

        // OBSERVAÇÕES
        var tdObs = document.createElement('td');
        var inputObs = document.createElement('input');
        inputObs.type = 'text';
        inputObs.className = 'pf-obs';
        inputObs.maxLength = 300;
        inputObs.value = linha.observacoes || '';
        inputObs.placeholder = 'Observações...';
        inputObs.disabled = !state.podeEditar;
        inputObs.setAttribute('aria-label', 'Observações — dia ' + linha.dia);
        inputObs.addEventListener('input', function () {
            linha.observacoes = inputObs.value;
            marcarSujo(true);
        });
        tdObs.appendChild(inputObs);
        tr.appendChild(tdObs);

        return tr;
    }

    function renderTabela() {
        var body = el('pfTabelaBody');
        body.innerHTML = '';

        var agora = new Date();
        var hoje = (agora.getFullYear() === state.ano && agora.getMonth() + 1 === state.mes)
            ? { dia: agora.getDate() }
            : null;

        var frag = document.createDocumentFragment();
        state.dias.forEach(function (linha) { frag.appendChild(criarLinha(linha, hoje)); });
        body.appendChild(frag);

        el('pfTabelaFoot').style.display = '';
        atualizarTotais();
    }

    function calcularTotais() {
        return state.dias.reduce(function (acc, d) {
            acc.abonadas += d.abonadas ? 1 : 0;
            acc.atestado += d.atestado ? 1 : 0;
            acc.descontoHoras += Number(d.descontoHoras) || 0;
            acc.tre += d.tre ? 1 : 0;
            acc.injustificadas += d.injustificadas ? 1 : 0;
            return acc;
        }, { abonadas: 0, atestado: 0, descontoHoras: 0, tre: 0, injustificadas: 0 });
    }

    function atualizarTotais() {
        var t = calcularTotais();
        var horas = Math.round(t.descontoHoras * 100) / 100;

        el('pfTotalAbonadas').textContent = t.abonadas;
        el('pfTotalAtestado').textContent = t.atestado;
        el('pfTotalHoras').textContent = horas + 'h';
        el('pfTotalTre').textContent = t.tre;
        el('pfTotalInjustificadas').textContent = t.injustificadas;

        var cards = [
            { label: 'Abonadas', valor: t.abonadas, alerta: false },
            { label: 'Atestado', valor: t.atestado, alerta: false },
            { label: 'Desconto de Horas', valor: horas + 'h', alerta: horas > 0 },
            { label: 'T.R.E.', valor: t.tre, alerta: false },
            { label: '(In) Justificadas', valor: t.injustificadas, alerta: t.injustificadas > 0 }
        ];

        var wrap = el('pfTotais');
        wrap.innerHTML = '';
        cards.forEach(function (c) {
            var div = document.createElement('div');
            div.className = 'pf-total-card' + (c.alerta ? ' is-alerta' : '');
            var label = document.createElement('div');
            label.className = 'pf-total-label';
            label.textContent = c.label;
            var valor = document.createElement('div');
            valor.className = 'pf-total-valor';
            valor.textContent = String(c.valor);
            div.appendChild(label);
            div.appendChild(valor);
            wrap.appendChild(div);
        });
        wrap.style.display = 'grid';
    }

    // ─────────────────────────────────────────────────────
    // Carga e gravação
    // ─────────────────────────────────────────────────────

    async function carregarPlanilha() {
        if (state.carregando) return;
        state.carregando = true;
        marcarSujo(false);
        renderCabecalho();
        renderMeses();
        renderAnoNav();

        if (!mesDisponivel(state.ano, state.mes)) {
            state.dias = [];
            estadoTabela('bi-lock-fill', 'Mês ainda não disponível',
                'A planilha de faltas começa em ' + state.contexto.vigencia.rotulo + '.');
            state.carregando = false;
            return;
        }

        estadoTabela('bi-hourglass-split', 'Carregando planilha...', '');

        var query = '?ano=' + state.ano + '&mes=' + state.mes;
        if (state.funcionarioId) query += '&funcionarioId=' + encodeURIComponent(state.funcionarioId);

        var resp = await api('/faltas-funcionarios/planilha' + query);
        state.carregando = false;

        if (!resp || !resp.success) {
            var msg = (resp && resp.error) || 'Não foi possível carregar a planilha.';
            estadoTabela('bi-exclamation-triangle', 'Planilha indisponível', msg);
            toast(msg, 'error');
            return;
        }

        var dados = resp.data;
        state.dias = dados.dias || [];
        state.podeEditar = !!dados.podeEditar;
        state.funcionarioNome = dados.funcionario ? dados.funcionario.nome : '';
        if (dados.funcionario && dados.funcionario.id) state.funcionarioId = dados.funcionario.id;
        if (dados.escola) state.contexto.escola = dados.escola;

        renderCabecalho();
        renderTabela();

        var status = el('pfStatus');
        if (!state.podeEditar) {
            status.className = 'pf-status';
            status.textContent = 'Somente leitura.';
        } else if (dados.atualizadoEm) {
            var quando = new Date(dados.atualizadoEm).toLocaleString('pt-BR');
            status.className = 'pf-status';
            status.textContent = 'Último lançamento em ' + quando
                + (dados.atualizadoPorNome ? ' por ' + dados.atualizadoPorNome : '') + '.';
        } else {
            status.className = 'pf-status';
            status.textContent = 'Nenhum lançamento neste mês.';
        }

        el('btnSalvarPlanilha').disabled = true;
    }

    async function salvarPlanilha() {
        if (!state.podeEditar || !state.dirty) return;

        var btn = el('btnSalvarPlanilha');
        btn.disabled = true;
        var textoOriginal = btn.innerHTML;
        btn.innerHTML = '<i class="bi bi-arrow-repeat"></i> Salvando...';

        var payload = {
            ano: state.ano,
            mes: state.mes,
            funcionarioId: state.funcionarioId,
            dias: state.dias.map(function (d) {
                return {
                    dia: d.dia,
                    abonadas: !!d.abonadas,
                    atestado: !!d.atestado,
                    descontoHoras: Number(d.descontoHoras) || 0,
                    tre: !!d.tre,
                    injustificadas: !!d.injustificadas,
                    observacoes: d.observacoes || ''
                };
            })
        };

        var resp = await api('/faltas-funcionarios/planilha', {
            method: 'PUT',
            body: JSON.stringify(payload)
        });

        btn.innerHTML = textoOriginal;

        if (!resp || !resp.success) {
            toast((resp && resp.error) || 'Não foi possível salvar a planilha.', 'error');
            btn.disabled = false;
            return;
        }

        // O backend devolve o mês recalculado (inclusive o CALENDÁRIO), então a
        // tela passa a refletir exatamente o que ficou gravado.
        if (resp.data && resp.data.dias) {
            state.dias = resp.data.dias;
            renderTabela();
        }
        marcarSujo(false);

        var status = el('pfStatus');
        status.className = 'pf-status is-salvo';
        status.textContent = resp.message || 'Planilha salva.';
        toast(resp.message || 'Planilha salva com sucesso!', 'success');
    }

    // ─────────────────────────────────────────────────────
    // Bootstrap
    // ─────────────────────────────────────────────────────

    function ligarEventos() {
        el('pfAnoAnterior').addEventListener('click', function () {
            if (!confirmarDescarte()) return;
            var anos = state.contexto.anos;
            if (state.ano <= anos[0]) return;
            state.ano -= 1;
            if (!mesDisponivel(state.ano, state.mes)) state.mes = state.contexto.vigencia.mes;
            sincronizarUrl();
            carregarPlanilha();
        });

        el('pfAnoProximo').addEventListener('click', function () {
            if (!confirmarDescarte()) return;
            var anos = state.contexto.anos;
            if (state.ano >= anos[anos.length - 1]) return;
            state.ano += 1;
            sincronizarUrl();
            carregarPlanilha();
        });

        el('btnSalvarPlanilha').addEventListener('click', salvarPlanilha);
        el('btnImprimir').addEventListener('click', function () { window.print(); });

        el('btnVoltar').addEventListener('click', function () {
            if (!confirmarDescarte()) return;
            if (window.history.length > 1) window.history.back();
            else window.location.href = 'dashboard.html';
        });

        // Fechar a aba com lançamento pendente é o jeito mais fácil de perder
        // um mês inteiro de digitação.
        window.addEventListener('beforeunload', function (e) {
            if (!state.dirty) return;
            e.preventDefault();
            e.returnValue = '';
        });
    }

    async function iniciar() {
        if (window.db && typeof db.init === 'function') await db.init();
        if (window.auth && typeof auth.init === 'function') await auth.init();

        if (window.auth && typeof auth.isAuthenticated === 'function' && !auth.isAuthenticated()) {
            window.location.href = 'login.html';
            return;
        }

        var resp = await api('/faltas-funcionarios/contexto');
        if (!resp || !resp.success) {
            var msg = (resp && resp.error) || 'Não foi possível abrir a planilha de faltas.';
            estadoTabela('bi-exclamation-triangle', 'Planilha indisponível', msg);
            toast(msg, 'error');
            return;
        }

        state.contexto = resp.data;

        var query = lerQuery();
        var anos = state.contexto.anos;
        state.ano = query.ano && anos.indexOf(query.ano) !== -1 ? query.ano : state.contexto.atual.ano;
        state.mes = query.mes || state.contexto.atual.mes;
        if (!mesDisponivel(state.ano, state.mes)) {
            state.ano = state.contexto.vigencia.ano;
            state.mes = state.contexto.vigencia.mes;
        }
        state.funcionarioId = query.funcionarioId || state.contexto.usuario.id;

        ligarEventos();
        if (state.contexto.usuario.ehGestao) await renderSeletorFuncionarios();

        sincronizarUrl();
        await carregarPlanilha();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', iniciar);
    } else {
        iniciar();
    }
})();
