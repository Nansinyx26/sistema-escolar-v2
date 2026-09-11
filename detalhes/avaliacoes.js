/**
 * detalhes/avaliacoes.js
 * Módulo de Gestão de Avaliações Escolares
 *
 * Conecta ao backend /api/avaliacoes-escolares.
 * Funcionalidades:
 *  - CRUD de avaliações (Prova, Trabalho, Seminário etc.)
 *  - Lançamento de notas por aluno com live-metrics (média, maior, menor, taxa)
 *  - Status pedagógico automático: Aprovado / Recuperação / Reprovado / Pendente
 *  - Trilha de auditoria completa por avaliação
 *  - Controle de acesso (RBAC): diretor e secretaria podem criar/excluir;
 *    professor vê apenas as turmas dele; pais/alunos bloqueados por guarda-acesso.js
 *
 * Refs #261
 */

/* ── Estado Global ─────────────────────────────────────────────────────── */
const state = {
    user: null,
    perfil: '',
    avaliacoes: [],
    avaliacaoAtual: null,   // Dados completos da avaliação no modal de notas
    filtros: {
        turma: '',
        materia: '',
        bimestre: '',
        texto: ''
    },
    podeEditar: false       // true para diretor, admin e secretaria
};

/* ── Base da API ────────────────────────────────────────────────────────── */
const API_BASE = window.API_BASE_URL || '/api';

async function apiFetch(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    });
    const json = await res.json();
    if (!res.ok) {
        throw new Error(json.error || json.message || `Erro HTTP ${res.status}`);
    }
    return json;
}

/* ── Helpers Visuais ────────────────────────────────────────────────────── */
function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function fmtDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('pt-BR');
}

function fmtDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return '—';
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function statusBadgeHTML(status) {
    const map = {
        Aprovado:     `<span class="badge-status-aprovado"><i class="bi bi-check-circle-fill"></i> Aprovado</span>`,
        Recuperação:  `<span class="badge-status-recuperacao"><i class="bi bi-exclamation-circle-fill"></i> Recuperação</span>`,
        Reprovado:    `<span class="badge-status-reprovado"><i class="bi bi-x-circle-fill"></i> Reprovado</span>`,
        Pendente:     `<span class="badge-status-pendente"><i class="bi bi-clock-fill"></i> Pendente</span>`
    };
    return map[status] || map['Pendente'];
}

function calcularStatusLocal(nota, presente) {
    if (presente === false) return 'Reprovado';
    if (nota === null || nota === undefined || nota === '') return 'Pendente';
    const n = parseFloat(nota);
    if (isNaN(n)) return 'Pendente';
    if (n >= 6.0) return 'Aprovado';
    if (n >= 4.0) return 'Recuperação';
    return 'Reprovado';
}

function notaInputClass(nota) {
    const n = parseFloat(nota);
    if (isNaN(n)) return '';
    if (n >= 6) return 'is-aprovado';
    if (n >= 4) return 'is-recuperacao';
    return 'is-reprovado';
}

function showFeedback(elId, msg, tipo = 'success') {
    const el = document.getElementById(elId);
    if (!el) return;
    const cor = tipo === 'success' ? '#00dc82' : tipo === 'error' ? '#ef4444' : '#f59e0b';
    el.innerHTML = `<span style="color: ${cor}"><i class="bi bi-${tipo === 'success' ? 'check-circle' : 'exclamation-triangle'}"></i> ${msg}</span>`;
    setTimeout(() => { el.innerHTML = ''; }, 4500);
}

/* ── Inicialização ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof db === 'undefined' || typeof auth === 'undefined') {
        console.error('❌ db ou auth não disponíveis');
        return;
    }

    await db.init();
    const user = auth.getCurrentUser() || await auth.checkSession();
    if (!user) {
        window.location.href = '/html/login.html';
        return;
    }

    state.user = user;
    state.perfil = (user.perfil || user.role || '').toLowerCase();
    state.podeEditar = ['admin', 'diretor', 'secretaria'].includes(state.perfil);

    // Ocultar botão "Nova Avaliação" para professor (só lança notas, não cria avaliação)
    if (state.perfil === 'professor') {
        const btn = document.getElementById('btnNovaAvaliacao');
        if (btn) btn.style.display = 'none';
    }

    await carregarFiltros();
    await carregarAvaliacoes();
    configurarEventos();
});

/* ── Filtros / Selects ──────────────────────────────────────────────────── */
async function carregarFiltros() {
    // Turmas
    const turmas = db.getTurmas().length > 0
        ? db.getTurmas()
        : await db.getAll('turmas');

    const selTurma      = document.getElementById('filtroTurma');
    const selFormTurma  = document.getElementById('formTurma');
    turmas.sort((a, b) => String(a.id).localeCompare(String(b.id))).forEach(t => {
        const nome = t.nome || t.id;
        const optFiltro = new Option(nome, t.id || t._id);
        const optForm   = new Option(nome, t.id || t._id);
        selTurma.appendChild(optFiltro);
        selFormTurma.appendChild(optForm);
    });

    // Disciplinas / Matérias
    const materias = db.getMaterias();
    const selMateria     = document.getElementById('filtroMateria');
    const selFormMateria = document.getElementById('formMateria');
    materias.forEach(m => {
        const optFiltro = new Option(m.nome, m.id);
        const optForm   = new Option(m.nome, m.id);
        selMateria.appendChild(optFiltro);
        selFormMateria.appendChild(optForm);
    });
}

/* ── Carregar Avaliações ────────────────────────────────────────────────── */
async function carregarAvaliacoes() {
    const tbody      = document.getElementById('avaliacoesTableBody');
    const emptyState = document.getElementById('emptyState');

    // Skeleton enquanto carrega
    tbody.innerHTML = `
        <tr class="loading-row">
            <td colspan="7">
                <div class="spinner spinner-sm" style="margin: 0 auto 10px auto;"></div>
                Carregando avaliações...
            </td>
        </tr>`;
    emptyState.classList.add('hidden');

    try {
        const params = new URLSearchParams();
        if (state.filtros.turma)   params.set('turmaId',   state.filtros.turma);
        if (state.filtros.materia) params.set('materiaId', state.filtros.materia);
        if (state.filtros.bimestre) params.set('bimestre', state.filtros.bimestre);

        const json = await apiFetch(`/avaliacoes-escolares?${params.toString()}`);
        let lista = json.data || [];

        // Filtro textual local (título)
        if (state.filtros.texto) {
            const termo = state.filtros.texto.toLowerCase();
            lista = lista.filter(a =>
                (a.titulo || '').toLowerCase().includes(termo) ||
                (a.turmaId || '').toLowerCase().includes(termo) ||
                (a.materiaId || '').toLowerCase().includes(termo)
            );
        }

        state.avaliacoes = lista;
        atualizarMetricasGerais(lista);
        renderizarTabela(lista);

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--danger);padding:2rem">
            <i class="bi bi-exclamation-triangle"></i> ${err.message}
        </td></tr>`;
        console.error('Erro ao carregar avaliações:', err);
    }
}

/* ── Métricas Gerais (topo) ─────────────────────────────────────────────── */
function atualizarMetricasGerais(lista) {
    const total = lista.length;
    const todasMedias = lista.filter(a => a.mediaTurma !== null && a.mediaTurma !== undefined);
    const mediaGeral = todasMedias.length > 0
        ? (todasMedias.reduce((s, a) => s + a.mediaTurma, 0) / todasMedias.length).toFixed(1)
        : '—';
    const notasLancadas = lista.reduce((s, a) => s + (a.totalNotas || 0), 0);

    document.getElementById('statTotalAvaliacoes').textContent = total;
    document.getElementById('statMediaGeral').textContent      = mediaGeral;
    document.getElementById('statNotasLancadas').textContent   = notasLancadas;
    document.getElementById('statTaxaAprovacao').textContent   = '—'; // preenchido ao abrir avaliação
}

/* ── Renderizar Tabela ──────────────────────────────────────────────────── */
function renderizarTabela(lista) {
    const tbody      = document.getElementById('avaliacoesTableBody');
    const emptyState = document.getElementById('emptyState');

    if (lista.length === 0) {
        tbody.innerHTML = '';
        emptyState.classList.remove('hidden');
        document.getElementById('emptyStateTitle').textContent =
            state.filtros.texto || state.filtros.turma || state.filtros.materia || state.filtros.bimestre
                ? 'Nenhuma avaliação encontrada para os filtros selecionados'
                : 'Nenhuma avaliação cadastrada';
        return;
    }

    emptyState.classList.add('hidden');

    const materias    = db.getMaterias();
    const materiasMap = Object.fromEntries(materias.map(m => [m.id, m]));
    const turmas      = db.getTurmas();
    const turmasMap   = Object.fromEntries(turmas.map(t => [t.id || t._id, t]));

    tbody.innerHTML = lista.map(a => {
        const turma   = turmasMap[a.turmaId];
        const materia = materiasMap[a.materiaId];
        const media   = a.mediaTurma !== null && a.mediaTurma !== undefined
            ? `<span class="media-valor ${a.mediaTurma >= 6 ? 'nota-alta' : a.mediaTurma >= 4 ? 'nota-media' : 'nota-baixa'}">${Number(a.mediaTurma).toFixed(1)}</span>`
            : `<span style="color: var(--text-muted)">—</span>`;

        const btnExcluir = state.podeEditar
            ? `<button class="btn-action-table btn-action-delete" data-action="excluir" data-id="${a.id || a._id}" title="Excluir avaliação">
                <i class="bi bi-trash"></i>
               </button>`
            : '';

        return `<tr data-id="${a.id || a._id}">
            <td>
                <div style="font-weight:600;color:var(--text-primary)">${a.titulo || '—'}</div>
                ${a.descricao ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">${a.descricao.slice(0, 60)}${a.descricao.length > 60 ? '…' : ''}</div>` : ''}
            </td>
            <td><span class="badge badge-turma">${turma ? (turma.nome || turma.id) : (a.turmaId || '—')}</span></td>
            <td>${materia ? `<span style="display:flex;align-items:center;gap:5px">${materia.icone || '📝'} ${materia.nome}</span>` : (a.materiaId || '—')}</td>
            <td>
                <div style="font-weight:500">${a.bimestre}º Bimestre</div>
                <div style="font-size:0.78rem;color:var(--text-muted)">${a.tipo || 'Prova'} · Peso ${a.peso || 1}</div>
            </td>
            <td>
                <div>${fmtDate(a.data)}</div>
                <div style="font-size:0.78rem;color:var(--text-muted)">${a.totalNotas || 0} notas lançadas</div>
            </td>
            <td>${media}</td>
            <td style="text-align:right">
                <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">
                    <button class="btn-action-table btn-action-lancar" data-action="lancar" data-id="${a.id || a._id}" title="Lançar / ver notas">
                        <i class="bi bi-pencil-square"></i> Notas
                    </button>
                    <button class="btn-action-table btn-action-history" data-action="historico" data-id="${a.id || a._id}" title="Ver histórico de auditoria">
                        <i class="bi bi-clock-history"></i>
                    </button>
                    ${btnExcluir}
                </div>
            </td>
        </tr>`;
    }).join('');
}

/* ── Configurar Eventos ─────────────────────────────────────────────────── */
function configurarEventos() {
    // Filtros
    document.getElementById('filtroTurma').addEventListener('change', e => {
        state.filtros.turma = e.target.value;
        carregarAvaliacoes();
    });
    document.getElementById('filtroMateria').addEventListener('change', e => {
        state.filtros.materia = e.target.value;
        carregarAvaliacoes();
    });
    document.getElementById('filtroBimestre').addEventListener('change', e => {
        state.filtros.bimestre = e.target.value;
        carregarAvaliacoes();
    });
    document.getElementById('searchAvaliacao').addEventListener('input', debounce(e => {
        state.filtros.texto = e.target.value.trim();
        carregarAvaliacoes();
    }, 300));

    // Delegação de eventos na tabela
    document.getElementById('avaliacoesTableBody').addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id     = btn.dataset.id;
        if (action === 'lancar')    abrirModalNotas(id);
        if (action === 'historico') abrirModalHistorico(id);
        if (action === 'excluir')   confirmarExcluir(id);
    });

    // Modal Nova Avaliação
    document.getElementById('btnNovaAvaliacao').addEventListener('click', () => abrirModalNova());
    document.getElementById('btnFecharModalNova').addEventListener('click', () => fecharModal('modalNovaAvaliacao'));
    document.getElementById('btnCancelarNova').addEventListener('click', () => fecharModal('modalNovaAvaliacao'));
    document.getElementById('formNovaAvaliacao').addEventListener('submit', salvarAvaliacao);

    // Modal Notas
    document.getElementById('btnFecharModalNotas').addEventListener('click', () => fecharModal('modalLancarNotas'));
    document.getElementById('btnCancelarNotas').addEventListener('click',   () => fecharModal('modalLancarNotas'));
    document.getElementById('btnSalvarNotas').addEventListener('click', salvarNotas);

    // Modal Histórico
    document.getElementById('btnFecharModalHistorico').addEventListener('click', () => fecharModal('modalHistorico'));
    document.getElementById('btnFecharHistoricoRodape').addEventListener('click', () => fecharModal('modalHistorico'));

    // Fecha modais clicando no overlay
    ['modalNovaAvaliacao', 'modalLancarNotas', 'modalHistorico'].forEach(id => {
        document.getElementById(id).addEventListener('click', e => {
            if (e.target === document.getElementById(id)) fecharModal(id);
        });
    });
}

/* ── Helpers de Modal ───────────────────────────────────────────────────── */
function abrirModal(id) { document.getElementById(id).classList.add('active'); }
function fecharModal(id) { document.getElementById(id).classList.remove('active'); }

/* ── Modal Nova / Editar Avaliação ──────────────────────────────────────── */
function abrirModalNova(avaliacao = null) {
    const form  = document.getElementById('formNovaAvaliacao');
    const titulo = document.getElementById('modalAvaliacaoTitulo');

    form.reset();
    document.getElementById('formAvaliacaoId').value = '';

    // Preencher data de hoje como padrão
    document.getElementById('formData').value = new Date().toISOString().split('T')[0];

    if (avaliacao) {
        titulo.textContent = 'Editar Avaliação';
        document.getElementById('formAvaliacaoId').value = avaliacao.id || avaliacao._id;
        document.getElementById('formTitulo').value    = avaliacao.titulo    || '';
        document.getElementById('formTurma').value     = avaliacao.turmaId   || '';
        document.getElementById('formMateria').value   = avaliacao.materiaId || '';
        document.getElementById('formBimestre').value  = avaliacao.bimestre  || '1';
        document.getElementById('formTipo').value      = avaliacao.tipo      || 'Prova';
        document.getElementById('formPeso').value      = avaliacao.peso      || 1;
        document.getElementById('formData').value      = avaliacao.data
            ? new Date(avaliacao.data).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];
        document.getElementById('formDescricao').value = avaliacao.descricao || '';
    } else {
        titulo.textContent = 'Nova Avaliação';
    }

    abrirModal('modalNovaAvaliacao');
}

async function salvarAvaliacao(e) {
    e.preventDefault();

    const id       = document.getElementById('formAvaliacaoId').value.trim();
    const payload  = {
        titulo:    document.getElementById('formTitulo').value.trim(),
        turmaId:   document.getElementById('formTurma').value,
        materiaId: document.getElementById('formMateria').value,
        bimestre:  Number(document.getElementById('formBimestre').value),
        tipo:      document.getElementById('formTipo').value,
        peso:      Number(document.getElementById('formPeso').value) || 1,
        data:      document.getElementById('formData').value,
        descricao: document.getElementById('formDescricao').value.trim()
    };

    const btnSalvar = document.getElementById('btnSalvarNovaAvaliacao');
    btnSalvar.disabled = true;
    btnSalvar.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...';

    try {
        if (id) {
            await apiFetch(`/avaliacoes-escolares/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
        } else {
            await apiFetch('/avaliacoes-escolares', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
        }

        fecharModal('modalNovaAvaliacao');
        await carregarAvaliacoes();
    } catch (err) {
        alert(`Erro ao salvar: ${err.message}`);
    } finally {
        btnSalvar.disabled = false;
        btnSalvar.innerHTML = '<i class="bi bi-check-circle"></i> Salvar Avaliação';
    }
}

async function confirmarExcluir(id) {
    if (!confirm('Excluir esta avaliação e todos as notas lançadas? Esta ação não pode ser desfeita.')) return;
    try {
        await apiFetch(`/avaliacoes-escolares/${id}`, { method: 'DELETE' });
        await carregarAvaliacoes();
    } catch (err) {
        alert(`Erro ao excluir: ${err.message}`);
    }
}

/* ── Modal Lançamento de Notas ──────────────────────────────────────────── */
async function abrirModalNotas(avaliacaoId) {
    const tbody = document.getElementById('alunosNotasTableBody');
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem">
        <div class="spinner spinner-sm" style="margin: 0 auto 10px;"></div>Carregando turma...
    </td></tr>`;
    document.getElementById('inputMotivoAlteracao').value = '';
    document.getElementById('msgFeedbackNotas').innerHTML = '';
    abrirModal('modalLancarNotas');

    try {
        const json = await apiFetch(`/avaliacoes-escolares/${avaliacaoId}`);
        const data = json.data;
        state.avaliacaoAtual = data;

        // Preencher banner de informações
        const materias   = db.getMaterias();
        const materiasMap = Object.fromEntries(materias.map(m => [m.id, m]));
        const turmas      = db.getTurmas();
        const turmasMap   = Object.fromEntries(turmas.map(t => [t.id || t._id, t]));

        const turmaObj   = turmasMap[data.turmaId];
        const materiaObj = materiasMap[data.materiaId];

        document.getElementById('lancarNotasHeaderTitulo').textContent = data.titulo || 'Lançamento de Notas';
        document.getElementById('infoBannerTurma').textContent       = turmaObj   ? (turmaObj.nome || turmaObj.id) : (data.turmaId || '—');
        document.getElementById('infoBannerDisciplina').textContent  = materiaObj ? materiaObj.nome : (data.materiaId || '—');
        document.getElementById('infoBannerBimestreTipo').textContent = `${data.bimestre}º Bimestre · ${data.tipo || 'Prova'}`;
        document.getElementById('infoBannerData').textContent        = fmtDate(data.data);
        document.getElementById('infoBannerPeso').textContent        = data.peso || 1;

        // Renderizar alunos e notas
        renderizarTabelaAlunos(data.alunos || []);
        atualizarLiveMetrics(data.alunos || []);

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--danger)">
            <i class="bi bi-exclamation-triangle"></i> ${err.message}
        </td></tr>`;
    }
}

function renderizarTabelaAlunos(alunos) {
    const tbody = document.getElementById('alunosNotasTableBody');

    if (alunos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:1.5rem;color:var(--text-muted)">
            Nenhum aluno encontrado nesta turma.
        </td></tr>`;
        return;
    }

    tbody.innerHTML = alunos.map((a, idx) => {
        const notaVal  = a.nota !== null && a.nota !== undefined ? a.nota : '';
        const presente = a.presente !== false;
        const status   = a.status || calcularStatusLocal(a.nota, a.presente);
        const avatar   = a.alunoNome
            ? a.alunoNome.split(' ').slice(0, 2).map(p => p[0]).join('').toUpperCase()
            : '?';

        return `<tr id="linha-aluno-${idx}">
            <td>
                <div style="display:flex;align-items:center;gap:10px">
                    <div style="width:34px;height:34px;border-radius:50%;background:rgba(0,220,130,0.15);
                                color:#00dc82;font-size:0.78rem;font-weight:700;display:flex;
                                align-items:center;justify-content:center;flex-shrink:0">${avatar}</div>
                    <div>
                        <div style="font-weight:600;font-size:0.9rem">${a.alunoNome || '—'}</div>
                        ${a.alunoMatricula ? `<div style="font-size:0.75rem;color:var(--text-muted)">${a.alunoMatricula}</div>` : ''}
                    </div>
                </div>
            </td>
            <td style="text-align:center">
                <label class="switch-presenca" title="Marcar presença/falta">
                    <input type="checkbox"
                           class="chk-presenca"
                           data-idx="${idx}"
                           data-aluno-id="${a.alunoId}"
                           ${presente ? 'checked' : ''}
                           aria-label="Presença do aluno ${a.alunoNome}">
                    <span id="label-presenca-${idx}" style="color:${presente ? '#00dc82' : '#ef4444'}">
                        ${presente ? 'Presente' : 'Ausente'}
                    </span>
                </label>
            </td>
            <td style="text-align:center">
                <input type="number"
                       class="input-nota-aluno ${notaInputClass(notaVal)}"
                       id="nota-${idx}"
                       data-idx="${idx}"
                       data-aluno-id="${a.alunoId}"
                       data-nota-id="${a.notaId || ''}"
                       min="0" max="10" step="0.1"
                       value="${notaVal}"
                       placeholder="0.0"
                       aria-label="Nota do aluno ${a.alunoNome}">
            </td>
            <td style="text-align:center" id="status-cell-${idx}">
                ${statusBadgeHTML(status)}
            </td>
            <td>
                <input type="text"
                       class="form-control-custom"
                       id="obs-${idx}"
                       style="font-size:0.8rem;padding:0.4rem 0.6rem"
                       placeholder="Obs. opcional"
                       value="${a.observacoes || ''}"
                       aria-label="Observações para ${a.alunoNome}">
            </td>
        </tr>`;
    }).join('');

    // Eventos de atualização de status ao vivo
    tbody.querySelectorAll('.input-nota-aluno').forEach(input => {
        input.addEventListener('input', onNotaInput);
    });
    tbody.querySelectorAll('.chk-presenca').forEach(chk => {
        chk.addEventListener('change', onPresencaChange);
    });
}

function onNotaInput(e) {
    const idx  = e.target.dataset.idx;
    const nota = e.target.value;

    // Cor visual da nota
    e.target.className = `input-nota-aluno ${notaInputClass(nota)}`;

    // Checkbox de presença
    const chk     = document.querySelector(`.chk-presenca[data-idx="${idx}"]`);
    const presente = chk ? chk.checked : true;

    // Status ao vivo
    const status     = calcularStatusLocal(nota, presente);
    const statusCell = document.getElementById(`status-cell-${idx}`);
    if (statusCell) statusCell.innerHTML = statusBadgeHTML(status);

    // Live metrics
    recalcularLiveMetrics();
}

function onPresencaChange(e) {
    const idx      = e.target.dataset.idx;
    const presente = e.target.checked;
    const labelEl  = document.getElementById(`label-presenca-${idx}`);
    if (labelEl) {
        labelEl.textContent = presente ? 'Presente' : 'Ausente';
        labelEl.style.color = presente ? '#00dc82' : '#ef4444';
    }

    // Se ausente, limpa a nota e marca Reprovado
    if (!presente) {
        const notaInput = document.getElementById(`nota-${idx}`);
        if (notaInput) {
            notaInput.value = '';
            notaInput.className = 'input-nota-aluno';
        }
    }

    const status     = calcularStatusLocal(
        document.getElementById(`nota-${idx}`)?.value || '',
        presente
    );
    const statusCell = document.getElementById(`status-cell-${idx}`);
    if (statusCell) statusCell.innerHTML = statusBadgeHTML(status);

    recalcularLiveMetrics();
}

function recalcularLiveMetrics() {
    const alunos = state.avaliacaoAtual?.alunos || [];
    const inputs  = document.querySelectorAll('.input-nota-aluno');
    const chks    = document.querySelectorAll('.chk-presenca');

    const dadosLive = Array.from(inputs).map((inp, i) => ({
        nota:    inp.value !== '' ? parseFloat(inp.value) : null,
        presente: chks[i] ? chks[i].checked : true
    }));

    atualizarLiveMetrics(dadosLive);
}

function atualizarLiveMetrics(alunosDados) {
    let soma = 0, count = 0, aprovados = 0, maiorNota = null, menorNota = null;
    const total = alunosDados.length;

    alunosDados.forEach(a => {
        const nota    = a.nota !== null && a.nota !== undefined && a.nota !== '' ? parseFloat(a.nota) : null;
        const presente = a.presente !== false;
        if (presente && nota !== null && !isNaN(nota)) {
            soma += nota;
            count++;
            if (nota >= 6) aprovados++;
            if (maiorNota === null || nota > maiorNota) maiorNota = nota;
            if (menorNota === null || nota < menorNota) menorNota = nota;
        }
    });

    const media        = count > 0 ? (soma / count).toFixed(1) : '—';
    const taxaAprovacao = count > 0 ? `${Math.round((aprovados / count) * 100)}%` : '—';

    document.getElementById('liveMediaTurma').textContent   = media;
    document.getElementById('liveMaiorNota').textContent    = maiorNota !== null ? Number(maiorNota).toFixed(1) : '—';
    document.getElementById('liveMenorNota').textContent    = menorNota !== null ? Number(menorNota).toFixed(1) : '—';
    document.getElementById('liveTaxaAprovacao').textContent = taxaAprovacao;
    document.getElementById('liveAlunosAvaliados').textContent = `${count}/${total}`;
}

/* ── Salvar Notas ────────────────────────────────────────────────────────── */
async function salvarNotas() {
    if (!state.avaliacaoAtual) return;

    const avaliacaoId = state.avaliacaoAtual.id || state.avaliacaoAtual._id;
    const motivo      = document.getElementById('inputMotivoAlteracao').value.trim()
        || 'Lançamento de notas';

    const alunos  = state.avaliacaoAtual.alunos || [];
    const notas   = [];

    alunos.forEach((a, idx) => {
        const notaInput = document.getElementById(`nota-${idx}`);
        const chk       = document.querySelector(`.chk-presenca[data-idx="${idx}"]`);
        const obsInput  = document.getElementById(`obs-${idx}`);

        const notaVal  = notaInput && notaInput.value !== '' ? parseFloat(notaInput.value) : null;
        const presente = chk ? chk.checked : true;
        const obs      = obsInput ? obsInput.value.trim() : '';
        const status   = calcularStatusLocal(notaVal, presente);

        notas.push({
            alunoId:    a.alunoId,
            notaId:     a.notaId || null,
            nota:       notaVal,
            presente,
            observacoes: obs,
            status,
            motivo
        });
    });

    const btnSalvar = document.getElementById('btnSalvarNotas');
    btnSalvar.disabled = true;
    btnSalvar.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...';

    try {
        await apiFetch(`/avaliacoes-escolares/${avaliacaoId}/notas`, {
            method: 'POST',
            body: JSON.stringify({ notas, motivo })
        });

        showFeedback('msgFeedbackNotas', 'Notas salvas com sucesso!', 'success');
        // Recarregar para atualizar métricas no modal e na tabela
        await abrirModalNotas(avaliacaoId);
        await carregarAvaliacoes();

    } catch (err) {
        showFeedback('msgFeedbackNotas', `Erro: ${err.message}`, 'error');
    } finally {
        btnSalvar.disabled = false;
        btnSalvar.innerHTML = '<i class="bi bi-check-circle-fill"></i> Salvar Notas';
    }
}

/* ── Modal Histórico de Auditoria ───────────────────────────────────────── */
async function abrirModalHistorico(avaliacaoId) {
    const content = document.getElementById('historicoContent');
    content.innerHTML = `<div style="text-align:center;padding:2rem">
        <div class="spinner spinner-sm" style="margin: 0 auto 10px;"></div>Carregando histórico...
    </div>`;
    abrirModal('modalHistorico');

    // Atualizar subtítulo
    const avaliacao = state.avaliacoes.find(a => (a.id || a._id) === avaliacaoId);
    if (avaliacao) {
        document.getElementById('historicoSubtitulo').textContent =
            `Auditoria para: "${avaliacao.titulo}"`;
    }

    try {
        const json = await apiFetch(`/avaliacoes-escolares/${avaliacaoId}/historico`);
        const registros = json.data || [];

        if (registros.length === 0) {
            content.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted)">
                <i class="bi bi-clock-history" style="font-size:2rem;display:block;margin-bottom:1rem;opacity:0.4"></i>
                Nenhuma alteração registrada para esta avaliação ainda.
            </div>`;
            return;
        }

        content.innerHTML = `<div class="audit-timeline">
            ${registros.map(r => {
                const notaAnterior = r.notaAnterior !== null && r.notaAnterior !== undefined
                    ? Number(r.notaAnterior).toFixed(1) : '—';
                const notaNova    = r.notaNova !== null && r.notaNova !== undefined
                    ? Number(r.notaNova).toFixed(1) : '—';

                let descricao = `Nota lançada: <strong>${notaNova}</strong>`;
                if (r.notaAnterior !== null && r.notaAnterior !== undefined) {
                    descricao = `Nota alterada de <strong>${notaAnterior}</strong> → <strong>${notaNova}</strong>`;
                }
                if (r.presenteAnterior !== undefined && r.presenteNovo !== undefined &&
                    r.presenteAnterior !== r.presenteNovo) {
                    const presStr = r.presenteNovo ? 'Presente' : 'Ausente';
                    descricao += ` · Presença: <strong>${presStr}</strong>`;
                }

                const perfil    = r.alteradoPorPerfil ? `(${r.alteradoPorPerfil})` : '';
                const autorIcon = 'bi-person-badge';

                return `<div class="audit-item">
                    <div class="audit-dot"></div>
                    <div class="audit-card">
                        <div class="audit-meta-header">
                            <span class="audit-author">
                                <i class="bi ${autorIcon}"></i>
                                ${r.alteradoPorNome || 'Usuário'} ${perfil}
                            </span>
                            <span class="audit-time">${fmtDateTime(r.dataAlteracao)}</span>
                        </div>
                        <div style="font-size:0.83rem;color:var(--text-muted);margin-bottom:4px">
                            Aluno: <strong style="color:var(--text-primary)">${r.alunoNome || r.alunoId}</strong>
                        </div>
                        <div class="audit-change-desc">${descricao}</div>
                        ${r.motivo ? `<div class="audit-reason"><i class="bi bi-quote"></i> ${r.motivo}</div>` : ''}
                    </div>
                </div>`;
            }).join('')}
        </div>`;

    } catch (err) {
        content.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--danger)">
            <i class="bi bi-exclamation-triangle"></i> ${err.message}
        </div>`;
    }
}
