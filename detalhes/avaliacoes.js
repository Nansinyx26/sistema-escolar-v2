/**
 * detalhes/avaliacoes.js
 * Módulo de Gestão de Avaliações Escolares
 *
 * Conecta ao backend /api/avaliacoes-escolares.
 * Funcionalidades:
 *  - Turmas e disciplinas vindas do banco (GET /opcoes), turmas agrupadas por
 *    série ("1º Ano" → 1ºA, 1ºB…) e disciplinas por grupo curricular
 *  - Criar, editar e excluir avaliações, com validação antes de salvar
 *  - Lançamento de notas por aluno com live-metrics (média, maior, menor, taxa)
 *  - Status pedagógico automático: Aprovado / Recuperação / Reprovado / Pendente
 *  - Trilha de auditoria completa por avaliação
 *  - Perfis: diretor/admin e secretaria gerenciam todas as turmas; professor
 *    cria e gerencia as das turmas e disciplinas dele. Quem pode o quê é
 *    decidido pelo servidor — aqui só se esconde o que ele vai recusar.
 */

/* ── Estado Global ─────────────────────────────────────────────────────── */
const state = {
    user: null,
    perfil: '',
    opcoes: null, // { turmas, series, disciplinas, todasDisciplinas, professores, valorMaximo }
    avaliacoes: [],
    avaliacaoAtual: null, // Dados completos da avaliação no modal de notas
    filtros: {
        turma: '',
        materia: '',
        bimestre: '',
        texto: '',
    },
};

const PERFIS_GESTAO = ['admin', 'diretor', 'secretaria'];

/* ── Base da API ────────────────────────────────────────────────────────── */
const API_BASE = window.API_BASE_URL || '/api';

async function apiFetch(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    let json = {};
    try {
        json = await res.json();
    } catch (_) {
        // Resposta sem corpo JSON (ex.: 502 do proxy): cai no erro HTTP abaixo.
    }
    if (!res.ok) {
        throw new Error(json.error || json.message || `Erro HTTP ${res.status}`);
    }
    return json;
}

/* ── Helpers ────────────────────────────────────────────────────────────── */
function debounce(fn, ms) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

/** Todo texto vindo do banco passa por aqui antes de virar HTML. */
function esc(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function numeroBR(n, casas = 1) {
    return Number(n).toLocaleString('pt-BR', {
        minimumFractionDigits: casas,
        maximumFractionDigits: casas,
    });
}

/**
 * Datas de avaliação são datas civis gravadas ao meio-dia UTC (as antigas, à
 * meia-noite UTC). Formatar em UTC mostra o dia certo para as duas.
 */
function fmtDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function fmtDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** "AAAA-MM-DD" para o <input type="date">, a partir de uma data gravada. */
function paraInputDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** Hoje no fuso de quem usa — `toISOString` daria amanhã depois das 21h. */
function hojeLocal() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function valorDa(avaliacao) {
    const v = Number(avaliacao?.valor);
    return Number.isFinite(v) && v > 0 ? v : 10;
}

function statusBadgeHTML(status) {
    const map = {
        Aprovado: `<span class="badge-status-aprovado"><i class="bi bi-check-circle-fill"></i> Aprovado</span>`,
        Recuperação: `<span class="badge-status-recuperacao"><i class="bi bi-exclamation-circle-fill"></i> Recuperação</span>`,
        Reprovado: `<span class="badge-status-reprovado"><i class="bi bi-x-circle-fill"></i> Reprovado</span>`,
        Pendente: `<span class="badge-status-pendente"><i class="bi bi-clock-fill"></i> Pendente</span>`,
    };
    return map[status] || map.Pendente;
}

/** Mesma regra do servidor: cortes 6,0 e 4,0 na escala 0–10, proporcionais ao valor. */
function calcularStatusLocal(nota, presente, maximo = 10) {
    if (presente === false) return 'Reprovado';
    if (nota === null || nota === undefined || nota === '') return 'Pendente';
    const n = parseFloat(nota);
    if (Number.isNaN(n)) return 'Pendente';
    const naEscala = (n / maximo) * 10;
    if (naEscala >= 6.0) return 'Aprovado';
    if (naEscala >= 4.0) return 'Recuperação';
    return 'Reprovado';
}

function notaInputClass(nota, maximo = 10) {
    const status = calcularStatusLocal(nota, true, maximo);
    return (
        {
            Aprovado: 'is-aprovado',
            Recuperação: 'is-recuperacao',
            Reprovado: 'is-reprovado',
        }[status] || ''
    );
}

function showFeedback(elId, msg, tipo = 'success') {
    const el = document.getElementById(elId);
    if (!el) return;
    const cor = tipo === 'success' ? '#00dc82' : tipo === 'error' ? '#ef4444' : '#f59e0b';
    el.innerHTML = `<span style="color: ${cor}"><i class="bi bi-${tipo === 'success' ? 'check-circle' : 'exclamation-triangle'}"></i> ${esc(msg)}</span>`;
    setTimeout(() => {
        el.innerHTML = '';
    }, 4500);
}

function avisar(msg, tipo = 'success') {
    if (typeof window.showToast === 'function') window.showToast(msg, tipo);
}

function ehGestao() {
    return PERFIS_GESTAO.includes(state.perfil);
}

/* ── Nomes de exibição ──────────────────────────────────────────────────── */
function nomeDaTurma(avaliacao) {
    if (avaliacao.turmaNome) return avaliacao.turmaNome;
    const turma = (state.opcoes?.turmas || []).find((t) => t.id === avaliacao.turmaId);
    return turma ? turma.nome : avaliacao.turmaId || '—';
}

function disciplinaDe(avaliacao) {
    const lista = state.opcoes?.todasDisciplinas || [];
    return (
        lista.find((d) => d.id === avaliacao.materiaId) || {
            nome: avaliacao.materiaNome || avaliacao.materiaId || '—',
            icone: '',
        }
    );
}

/* ── Inicialização ──────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
    if (typeof auth === 'undefined') {
        console.error('❌ auth não disponível');
        return;
    }

    const user = auth.getCurrentUser() || (await auth.checkSession());
    if (!user) {
        window.location.href = '/html/login.html';
        return;
    }

    state.user = user;
    state.perfil = String(user.perfil || user.role || '').toLowerCase();

    configurarEventos();
    await carregarOpcoes();
    await carregarAvaliacoes();
});

/* ── Opções: turmas, disciplinas e professores ─────────────────────────── */
async function carregarOpcoes() {
    const btnNova = document.getElementById('btnNovaAvaliacao');
    btnNova.disabled = true;

    try {
        const json = await apiFetch('/avaliacoes-escolares/opcoes');
        state.opcoes = json.data;
    } catch (err) {
        mostrarAviso(
            `Não foi possível carregar turmas e disciplinas: ${err.message}. Recarregue a página para tentar de novo.`,
            'erro'
        );
        return;
    }

    const { turmas, series, disciplinas, todasDisciplinas } = state.opcoes;

    preencherTurmas(document.getElementById('filtroTurma'), series, 'Todas as turmas');
    preencherTurmas(document.getElementById('formTurma'), series, 'Selecione a turma...');
    preencherDisciplinas(document.getElementById('filtroMateria'), todasDisciplinas, 'Todas as disciplinas');
    preencherDisciplinas(document.getElementById('formMateria'), disciplinas, 'Selecione a disciplina...');

    document.getElementById('grupoProfessor').hidden = !ehGestao();

    if (turmas.length === 0) {
        mostrarAviso(
            state.perfil === 'professor'
                ? 'Seu cadastro ainda não tem turma vinculada. Peça à direção para vincular suas salas — enquanto isso, não é possível criar avaliações.'
                : 'Nenhuma turma cadastrada nesta escola. Cadastre as turmas antes de criar avaliações.',
            'alerta'
        );
        return;
    }
    if (disciplinas.length === 0) {
        mostrarAviso('Nenhuma disciplina disponível para o seu cadastro.', 'alerta');
        return;
    }
    btnNova.disabled = false;
}

function mostrarAviso(texto, tipo) {
    const el = document.getElementById('avisoPerfil');
    el.className = `avaliacoes-aviso avaliacoes-aviso-${tipo}`;
    el.innerHTML = `<i class="bi bi-${tipo === 'erro' ? 'exclamation-octagon' : 'info-circle'}" aria-hidden="true"></i><span>${esc(texto)}</span>`;
    el.hidden = false;
}

/** Turmas em <optgroup> por série: "1º Ano" → 1ºA, 1ºB, 1ºC, 1ºD. */
function preencherTurmas(select, series, rotuloVazio) {
    select.innerHTML = '';
    select.appendChild(new Option(rotuloVazio, ''));
    for (const serie of series) {
        const grupo = document.createElement('optgroup');
        grupo.label = serie.nome;
        for (const turma of serie.turmas) grupo.appendChild(new Option(turma.nome, turma.id));
        select.appendChild(grupo);
    }
}

/** Disciplinas separadas em componentes obrigatórios e parte diversificada. */
function preencherDisciplinas(select, disciplinas, rotuloVazio) {
    select.innerHTML = '';
    select.appendChild(new Option(rotuloVazio, ''));
    const grupos = [
        ['base', 'Componentes obrigatórios'],
        ['diversificada', 'Parte diversificada'],
    ];
    for (const [chave, rotulo] of grupos) {
        const itens = disciplinas.filter((d) => d.grupo === chave);
        if (itens.length === 0) continue;
        const grupo = document.createElement('optgroup');
        grupo.label = rotulo;
        for (const d of itens) grupo.appendChild(new Option(d.nome, d.id));
        select.appendChild(grupo);
    }
}

/**
 * Professores oferecidos para a turma escolhida: primeiro os que dão aula
 * nela, depois o resto da escola. "Definir automaticamente" deixa o servidor
 * escolher o especialista da disciplina ou o regente da sala.
 */
function atualizarProfessores(professorAtual = null) {
    if (!ehGestao()) return;
    const select = document.getElementById('formProfessor');
    const dica = document.getElementById('dicaProfessor');
    const turmaId = document.getElementById('formTurma').value;
    const disciplinaId = document.getElementById('formMateria').value;
    const disciplina = (state.opcoes?.disciplinas || []).find((d) => d.id === disciplinaId);
    const professores = state.opcoes?.professores || [];
    const escolhido = professorAtual ?? select.value;

    const daTurma = professores.filter((p) => turmaId && p.turmas.includes(turmaId));
    const outros = professores.filter((p) => !daTurma.includes(p));

    select.innerHTML = '';
    select.appendChild(new Option('Definir automaticamente', ''));
    const rotulo = (p) =>
        p.especialista && p.disciplinas.length ? `${p.nome} — ${p.disciplinas.join(', ')}` : p.nome;
    const adicionarGrupo = (label, lista) => {
        if (lista.length === 0) return;
        const grupo = document.createElement('optgroup');
        grupo.label = label;
        for (const p of lista) grupo.appendChild(new Option(rotulo(p), p.id));
        select.appendChild(grupo);
    };
    adicionarGrupo('Professores da turma', daTurma);
    adicionarGrupo('Outros professores da escola', outros);
    if ([...select.options].some((o) => o.value === String(escolhido))) {
        select.value = String(escolhido);
    }

    // Mesma sugestão que o servidor faz quando o campo fica em "automaticamente".
    const sugerido =
        daTurma.find((p) => p.especialista && disciplina && p.disciplinas.includes(disciplina.nome)) ||
        daTurma.find((p) => !p.especialista && p.salaPrincipal === turmaId);
    dica.textContent = !turmaId
        ? 'Selecione a turma para ver os professores dela.'
        : sugerido
          ? `Automático: ${sugerido.nome}.`
          : 'Nenhum professor vinculado a esta turma: a avaliação fica sem responsável até você escolher um.';
}

/* ── Carregar Avaliações ────────────────────────────────────────────────── */
function skeletonTabela() {
    const linha =
        '<tr class="linha-skeleton" aria-hidden="true"><td colspan="7"><span class="skeleton skeleton-line"></span></td></tr>';
    return linha.repeat(4);
}

async function carregarAvaliacoes() {
    const tbody = document.getElementById('avaliacoesTableBody');
    const emptyState = document.getElementById('emptyState');

    tbody.innerHTML = skeletonTabela();
    tbody.setAttribute('aria-busy', 'true');
    emptyState.classList.add('hidden');

    try {
        const params = new URLSearchParams();
        if (state.filtros.turma) params.set('turmaId', state.filtros.turma);
        if (state.filtros.materia) params.set('materiaId', state.filtros.materia);
        if (state.filtros.bimestre) params.set('bimestre', state.filtros.bimestre);

        const json = await apiFetch(`/avaliacoes-escolares?${params.toString()}`);
        let lista = json.data || [];

        // Filtro textual local (título, turma, disciplina, professor)
        if (state.filtros.texto) {
            const termo = state.filtros.texto.toLowerCase();
            lista = lista.filter((a) =>
                [a.titulo, nomeDaTurma(a), disciplinaDe(a).nome, a.professorNome]
                    .join(' ')
                    .toLowerCase()
                    .includes(termo)
            );
        }

        state.avaliacoes = lista;
        atualizarMetricasGerais(lista);
        renderizarTabela(lista);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="celula-erro">
            <i class="bi bi-exclamation-triangle"></i> ${esc(err.message)}
        </td></tr>`;
        console.error('Erro ao carregar avaliações:', err);
    } finally {
        tbody.setAttribute('aria-busy', 'false');
    }
}

/* ── Métricas Gerais (topo) ─────────────────────────────────────────────── */
function atualizarMetricasGerais(lista) {
    const comMedia = lista.filter((a) => typeof a.mediaTurma === 'number');
    // Média na escala 0–10: cada média é convertida pelo valor da própria avaliação.
    const mediaGeral =
        comMedia.length > 0
            ? numeroBR(
                  comMedia.reduce((s, a) => s + (a.mediaTurma / valorDa(a)) * 10, 0) /
                      comMedia.length
              )
            : '—';
    const notasLancadas = lista.reduce((s, a) => s + (a.totalNotas || 0), 0);
    const aprovados = lista.reduce((s, a) => s + (a.totalAprovados || 0), 0);

    document.getElementById('statTotalAvaliacoes').textContent = lista.length;
    document.getElementById('statMediaGeral').textContent = mediaGeral;
    document.getElementById('statNotasLancadas').textContent = notasLancadas;
    document.getElementById('statTaxaAprovacao').textContent =
        notasLancadas > 0 ? `${Math.round((aprovados / notasLancadas) * 100)}%` : '—';
}

/* ── Renderizar Tabela ──────────────────────────────────────────────────── */
function renderizarTabela(lista) {
    const tbody = document.getElementById('avaliacoesTableBody');
    const emptyState = document.getElementById('emptyState');

    if (lista.length === 0) {
        tbody.innerHTML = '';
        emptyState.classList.remove('hidden');
        const filtrando =
            state.filtros.texto ||
            state.filtros.turma ||
            state.filtros.materia ||
            state.filtros.bimestre;
        document.getElementById('emptyStateTitle').textContent = filtrando
            ? 'Nenhuma avaliação encontrada para os filtros selecionados'
            : 'Nenhuma avaliação cadastrada';
        return;
    }

    emptyState.classList.add('hidden');

    tbody.innerHTML = lista
        .map((a) => {
            const id = esc(a.id || a._id);
            const disciplina = disciplinaDe(a);
            const valor = valorDa(a);
            const media =
                typeof a.mediaTurma === 'number'
                    ? `<span class="media-valor ${notaInputClass(a.mediaTurma, valor).replace('is-', 'nota-')}">${numeroBR(a.mediaTurma)}</span>`
                    : `<span class="texto-suave">—</span>`;

            const acoesGestao = a.podeGerenciar
                ? `<button type="button" class="btn-action-table btn-action-history" data-action="editar" data-id="${id}" title="Editar avaliação" aria-label="Editar ${esc(a.titulo)}">
                    <i class="bi bi-pencil"></i>
                   </button>
                   <button type="button" class="btn-action-table btn-action-delete" data-action="excluir" data-id="${id}" title="Excluir avaliação" aria-label="Excluir ${esc(a.titulo)}">
                    <i class="bi bi-trash"></i>
                   </button>`
                : '';

            const entrega = a.dataEntrega
                ? `<div class="texto-suave">Entrega: ${fmtDate(a.dataEntrega)}</div>`
                : '';

            return `<tr data-id="${id}">
            <td data-label="Avaliação">
                <div class="avaliacao-titulo">${esc(a.titulo || '—')}</div>
                ${a.descricao ? `<div class="texto-suave">${esc(a.descricao.slice(0, 60))}${a.descricao.length > 60 ? '…' : ''}</div>` : ''}
                ${a.professorNome ? `<div class="texto-suave"><i class="bi bi-person"></i> ${esc(a.professorNome)}</div>` : ''}
            </td>
            <td data-label="Turma"><span class="badge badge-turma">${esc(nomeDaTurma(a))}</span></td>
            <td data-label="Disciplina">${disciplina.icone ? `${esc(disciplina.icone)} ` : ''}${esc(disciplina.nome)}</td>
            <td data-label="Bimestre / Tipo">
                <div class="texto-forte">${esc(a.bimestre)}º Bimestre</div>
                <div class="texto-suave">${esc(a.tipo || 'Prova')}</div>
            </td>
            <td data-label="Data / Valor">
                <div>${fmtDate(a.data)}</div>
                <div class="texto-suave">Vale ${numeroBR(valor)} · ${a.totalNotas || 0} notas</div>
                ${entrega}
            </td>
            <td data-label="Média turma">${media}</td>
            <td data-label="Ações" class="celula-acoes">
                <div class="acoes-linha">
                    <button type="button" class="btn-action-table btn-action-lancar" data-action="lancar" data-id="${id}" title="Lançar / ver notas">
                        <i class="bi bi-pencil-square"></i> Notas
                    </button>
                    <button type="button" class="btn-action-table btn-action-history" data-action="historico" data-id="${id}" title="Ver histórico de auditoria" aria-label="Histórico de ${esc(a.titulo)}">
                        <i class="bi bi-clock-history"></i>
                    </button>
                    ${acoesGestao}
                </div>
            </td>
        </tr>`;
        })
        .join('');
}

/* ── Configurar Eventos ─────────────────────────────────────────────────── */
function configurarEventos() {
    // Filtros
    document.getElementById('filtroTurma').addEventListener('change', (e) => {
        state.filtros.turma = e.target.value;
        carregarAvaliacoes();
    });
    document.getElementById('filtroMateria').addEventListener('change', (e) => {
        state.filtros.materia = e.target.value;
        carregarAvaliacoes();
    });
    document.getElementById('filtroBimestre').addEventListener('change', (e) => {
        state.filtros.bimestre = e.target.value;
        carregarAvaliacoes();
    });
    document.getElementById('searchAvaliacao').addEventListener(
        'input',
        debounce((e) => {
            state.filtros.texto = e.target.value.trim();
            carregarAvaliacoes();
        }, 300)
    );

    // Delegação de eventos na tabela
    document.getElementById('avaliacoesTableBody').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === 'lancar') abrirModalNotas(id);
        if (action === 'historico') abrirModalHistorico(id);
        if (action === 'editar') {
            const avaliacao = state.avaliacoes.find((a) => String(a.id || a._id) === id);
            if (avaliacao) abrirModalNova(avaliacao);
        }
        if (action === 'excluir') confirmarExcluir(id);
    });

    // Modal Nova Avaliação
    document.getElementById('btnNovaAvaliacao').addEventListener('click', () => abrirModalNova());
    document
        .getElementById('btnFecharModalNova')
        .addEventListener('click', () => fecharModal('modalNovaAvaliacao'));
    document
        .getElementById('btnCancelarNova')
        .addEventListener('click', () => fecharModal('modalNovaAvaliacao'));
    document.getElementById('formNovaAvaliacao').addEventListener('submit', salvarAvaliacao);
    document.getElementById('formTurma').addEventListener('change', () => atualizarProfessores());
    document.getElementById('formMateria').addEventListener('change', () => atualizarProfessores());
    // O erro some assim que o campo é corrigido, sem esperar outro "Salvar".
    document.getElementById('formNovaAvaliacao').addEventListener('input', (e) => {
        if (e.target.getAttribute('aria-invalid') === 'true') limparErroCampo(e.target);
    });
    document.getElementById('formNovaAvaliacao').addEventListener('change', (e) => {
        if (e.target.getAttribute('aria-invalid') === 'true') limparErroCampo(e.target);
    });

    // Modal Notas
    document
        .getElementById('btnFecharModalNotas')
        .addEventListener('click', () => fecharModal('modalLancarNotas'));
    document
        .getElementById('btnCancelarNotas')
        .addEventListener('click', () => fecharModal('modalLancarNotas'));
    document.getElementById('btnSalvarNotas').addEventListener('click', salvarNotas);

    // Modal Histórico
    document
        .getElementById('btnFecharModalHistorico')
        .addEventListener('click', () => fecharModal('modalHistorico'));
    document
        .getElementById('btnFecharHistoricoRodape')
        .addEventListener('click', () => fecharModal('modalHistorico'));

    // Fecha modais clicando no overlay ou com Esc
    const modais = ['modalNovaAvaliacao', 'modalLancarNotas', 'modalHistorico'];
    modais.forEach((id) => {
        document.getElementById(id).addEventListener('click', (e) => {
            if (e.target === document.getElementById(id)) fecharModal(id);
        });
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        const aberto = modais.find((id) =>
            document.getElementById(id).classList.contains('active')
        );
        if (aberto) fecharModal(aberto);
    });
}

/* ── Helpers de Modal ───────────────────────────────────────────────────── */
let focoAntesDoModal = null;

function abrirModal(id) {
    focoAntesDoModal = document.activeElement;
    const modal = document.getElementById(id);
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
}

function fecharModal(id) {
    const modal = document.getElementById(id);
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    if (focoAntesDoModal && typeof focoAntesDoModal.focus === 'function') {
        focoAntesDoModal.focus();
    }
}

/* ── Modal Nova / Editar Avaliação ──────────────────────────────────────── */
const CAMPOS_VALIDADOS = {
    formTurma: 'erroTurma',
    formMateria: 'erroMateria',
    formTitulo: 'erroTitulo',
    formData: 'erroData',
    formDataEntrega: 'erroDataEntrega',
    formValor: 'erroValor',
};

function limparErroCampo(campo) {
    campo.removeAttribute('aria-invalid');
    const erro = document.getElementById(CAMPOS_VALIDADOS[campo.id]);
    if (erro) erro.textContent = '';
    // Último campo corrigido: o resumo "Corrija os N campos" deixa de ser verdade.
    const form = document.getElementById('formNovaAvaliacao');
    if (!form.querySelector('[aria-invalid="true"]')) {
        document.getElementById('formResumoErros').hidden = true;
    }
}

function limparErros() {
    for (const id of Object.keys(CAMPOS_VALIDADOS)) limparErroCampo(document.getElementById(id));
    const resumo = document.getElementById('formResumoErros');
    resumo.hidden = true;
    resumo.textContent = '';
}

function marcarErro(campoId, mensagem) {
    const campo = document.getElementById(campoId);
    campo.setAttribute('aria-invalid', 'true');
    document.getElementById(CAMPOS_VALIDADOS[campoId]).textContent = mensagem;
}

function abrirModalNova(avaliacao = null) {
    if (!state.opcoes) return;
    const form = document.getElementById('formNovaAvaliacao');
    const titulo = document.getElementById('modalAvaliacaoTitulo');
    const selTurma = document.getElementById('formTurma');
    const selMateria = document.getElementById('formMateria');
    const dicaTurma = document.getElementById('dicaTurma');

    form.reset();
    limparErros();
    document.getElementById('formAvaliacaoId').value = '';
    document.getElementById('formData').value = hojeLocal();
    document.getElementById('formValor').value = '10';
    selTurma.disabled = false;
    selMateria.disabled = false;
    dicaTurma.hidden = true;

    if (avaliacao) {
        titulo.textContent = 'Editar Avaliação';
        document.getElementById('formAvaliacaoId').value = avaliacao.id || avaliacao._id;
        document.getElementById('formTitulo').value = avaliacao.titulo || '';
        garantirOpcao(selTurma, avaliacao.turmaId, nomeDaTurma(avaliacao));
        selTurma.value = avaliacao.turmaId || '';
        garantirOpcao(selMateria, avaliacao.materiaId, disciplinaDe(avaliacao).nome);
        selMateria.value = avaliacao.materiaId || '';
        document.getElementById('formBimestre').value = String(avaliacao.bimestre || 1);
        document.getElementById('formTipo').value = avaliacao.tipo || 'Prova';
        document.getElementById('formValor').value = String(valorDa(avaliacao));
        document.getElementById('formData').value = paraInputDate(avaliacao.data) || hojeLocal();
        document.getElementById('formDataEntrega').value = paraInputDate(avaliacao.dataEntrega);
        document.getElementById('formDescricao').value = avaliacao.descricao || '';

        // Com nota lançada, turma e disciplina ficam presas (o servidor recusa a troca).
        if ((avaliacao.totalNotas || 0) > 0) {
            selTurma.disabled = true;
            selMateria.disabled = true;
            dicaTurma.textContent =
                'Já há notas lançadas: turma e disciplina não podem mais ser alteradas.';
            dicaTurma.hidden = false;
        }
        atualizarProfessores(avaliacao.professorId || '');
    } else {
        titulo.textContent = 'Nova Avaliação';
        atualizarProfessores('');
    }

    abrirModal('modalNovaAvaliacao');
    setTimeout(() => (selTurma.disabled ? document.getElementById('formTitulo') : selTurma).focus(), 50);
}

/** Avaliação antiga pode apontar para turma/disciplina fora da lista atual. */
function garantirOpcao(select, valor, rotulo) {
    if (!valor || [...select.options].some((o) => o.value === String(valor))) return;
    select.appendChild(new Option(rotulo || valor, valor));
}

/** Valida no navegador o mesmo que o servidor valida. Devolve o payload ou null. */
function lerFormulario() {
    limparErros();
    const turmaId = document.getElementById('formTurma').value;
    const materiaId = document.getElementById('formMateria').value;
    const titulo = document.getElementById('formTitulo').value.trim();
    const data = document.getElementById('formData').value;
    const dataEntrega = document.getElementById('formDataEntrega').value;
    const valorTexto = document.getElementById('formValor').value.trim().replace(',', '.');
    const valor = Number(valorTexto);

    const erros = [];
    const falhar = (campo, mensagem) => {
        marcarErro(campo, mensagem);
        erros.push(campo);
    };

    if (!turmaId) falhar('formTurma', 'Selecione a turma.');
    if (!materiaId) falhar('formMateria', 'Selecione a disciplina.');
    if (!titulo) falhar('formTitulo', 'Informe o título da avaliação.');
    if (!data) falhar('formData', 'Informe a data da avaliação.');
    if (!valorTexto || !Number.isFinite(valor) || valor <= 0 || valor > 10) {
        falhar('formValor', 'Informe um valor maior que 0 e no máximo 10.');
    }
    if (dataEntrega && data && dataEntrega < data) {
        falhar('formDataEntrega', 'A entrega não pode ser antes da data da avaliação.');
    }

    if (erros.length > 0) {
        const resumo = document.getElementById('formResumoErros');
        resumo.textContent =
            erros.length === 1
                ? 'Corrija o campo destacado para salvar.'
                : `Corrija os ${erros.length} campos destacados para salvar.`;
        resumo.hidden = false;
        document.getElementById(erros[0]).focus();
        return null;
    }

    const payload = {
        titulo,
        turmaId,
        materiaId,
        bimestre: Number(document.getElementById('formBimestre').value),
        tipo: document.getElementById('formTipo').value,
        valor,
        data,
        dataEntrega: dataEntrega || null,
        descricao: document.getElementById('formDescricao').value.trim(),
    };
    if (ehGestao()) payload.professorId = document.getElementById('formProfessor').value;
    return payload;
}

async function salvarAvaliacao(e) {
    e.preventDefault();

    const payload = lerFormulario();
    if (!payload) return;

    const id = document.getElementById('formAvaliacaoId').value.trim();
    const btnSalvar = document.getElementById('btnSalvarNovaAvaliacao');
    btnSalvar.disabled = true;
    btnSalvar.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...';

    try {
        if (id) {
            // Campo desabilitado não muda: não mandar evita o 409 de "já tem notas".
            if (document.getElementById('formTurma').disabled) delete payload.turmaId;
            if (document.getElementById('formMateria').disabled) delete payload.materiaId;
            await apiFetch(`/avaliacoes-escolares/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
        } else {
            await apiFetch('/avaliacoes-escolares', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
        }

        fecharModal('modalNovaAvaliacao');
        avisar(id ? 'Avaliação atualizada.' : 'Avaliação criada.', 'success');
        await carregarAvaliacoes();
    } catch (err) {
        const resumo = document.getElementById('formResumoErros');
        resumo.textContent = `Não foi possível salvar: ${err.message}`;
        resumo.hidden = false;
    } finally {
        btnSalvar.disabled = false;
        btnSalvar.innerHTML = '<i class="bi bi-check-circle"></i> Salvar avaliação';
    }
}

async function confirmarExcluir(id) {
    const avaliacao = state.avaliacoes.find((a) => String(a.id || a._id) === id);
    const nome = avaliacao ? `"${avaliacao.titulo}"` : 'esta avaliação';
    if (
        !confirm(
            `Excluir ${nome} e todas as notas lançadas nela? Esta ação não pode ser desfeita.`
        )
    ) {
        return;
    }
    try {
        await apiFetch(`/avaliacoes-escolares/${encodeURIComponent(id)}`, { method: 'DELETE' });
        avisar('Avaliação excluída.', 'success');
        await carregarAvaliacoes();
    } catch (err) {
        avisar(`Erro ao excluir: ${err.message}`, 'error');
    }
}

/* ── Modal Lançamento de Notas ──────────────────────────────────────────── */
async function abrirModalNotas(avaliacaoId) {
    const tbody = document.getElementById('alunosNotasTableBody');
    tbody.innerHTML =
        '<tr class="linha-skeleton" aria-hidden="true"><td colspan="5"><span class="skeleton skeleton-line"></span></td></tr>'.repeat(
            4
        );
    document.getElementById('inputMotivoAlteracao').value = '';
    document.getElementById('msgFeedbackNotas').innerHTML = '';
    abrirModal('modalLancarNotas');

    try {
        const json = await apiFetch(`/avaliacoes-escolares/${encodeURIComponent(avaliacaoId)}`);
        const data = json.data;
        state.avaliacaoAtual = data;
        const valor = valorDa(data);

        document.getElementById('lancarNotasHeaderTitulo').textContent =
            data.titulo || 'Lançamento de Notas';
        document.getElementById('infoBannerTurma').textContent = nomeDaTurma(data);
        document.getElementById('infoBannerDisciplina').textContent = disciplinaDe(data).nome;
        document.getElementById('infoBannerBimestreTipo').textContent =
            `${data.bimestre}º Bimestre · ${data.tipo || 'Prova'}`;
        document.getElementById('infoBannerData').textContent = fmtDate(data.data);
        document.getElementById('infoBannerValor').textContent = numeroBR(valor);
        document.getElementById('thNotaTeto').textContent = `Nota (0 a ${numeroBR(valor)})`;

        renderizarTabelaAlunos(data.alunos || []);
        atualizarLiveMetrics(data.alunos || []);
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="celula-erro">
            <i class="bi bi-exclamation-triangle"></i> ${esc(err.message)}
        </td></tr>`;
    }
}

function renderizarTabelaAlunos(alunos) {
    const tbody = document.getElementById('alunosNotasTableBody');
    const valor = valorDa(state.avaliacaoAtual);

    if (alunos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="celula-vazia">
            Nenhum aluno encontrado nesta turma.
        </td></tr>`;
        return;
    }

    tbody.innerHTML = alunos
        .map((a, idx) => {
            const notaVal = a.nota !== null && a.nota !== undefined ? a.nota : '';
            const presente = a.presente !== false;
            const status = a.status || calcularStatusLocal(a.nota, a.presente, valor);
            const nome = esc(a.alunoNome || '—');
            const avatar = a.alunoNome
                ? a.alunoNome
                      .split(' ')
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join('')
                      .toUpperCase()
                : '?';

            return `<tr id="linha-aluno-${idx}">
            <td>
                <div class="aluno-celula">
                    <div class="aluno-avatar" aria-hidden="true">${esc(avatar)}</div>
                    <div>
                        <div class="texto-forte">${nome}</div>
                        ${a.alunoMatricula ? `<div class="texto-suave">${esc(a.alunoMatricula)}</div>` : ''}
                    </div>
                </div>
            </td>
            <td style="text-align:center">
                <label class="switch-presenca" title="Marcar presença/falta">
                    <input type="checkbox"
                           class="chk-presenca"
                           data-idx="${idx}"
                           ${presente ? 'checked' : ''}
                           aria-label="Presença de ${nome}">
                    <span id="label-presenca-${idx}" style="color:${presente ? '#00dc82' : '#ef4444'}">
                        ${presente ? 'Presente' : 'Ausente'}
                    </span>
                </label>
            </td>
            <td style="text-align:center">
                <input type="number"
                       class="input-nota-aluno ${notaInputClass(notaVal, valor)}"
                       id="nota-${idx}"
                       data-idx="${idx}"
                       min="0" max="${valor}" step="0.1"
                       inputmode="decimal"
                       value="${esc(notaVal)}"
                       placeholder="0,0"
                       aria-label="Nota de ${nome}">
            </td>
            <td style="text-align:center" id="status-cell-${idx}">
                ${statusBadgeHTML(status)}
            </td>
            <td>
                <input type="text"
                       class="form-control-custom input-obs-aluno"
                       id="obs-${idx}"
                       placeholder="Obs. opcional"
                       value="${esc(a.observacoes || '')}"
                       aria-label="Observações para ${nome}">
            </td>
        </tr>`;
        })
        .join('');

    // Eventos de atualização de status ao vivo
    tbody.querySelectorAll('.input-nota-aluno').forEach((input) => {
        input.addEventListener('input', onNotaInput);
    });
    tbody.querySelectorAll('.chk-presenca').forEach((chk) => {
        chk.addEventListener('change', onPresencaChange);
    });
}

function onNotaInput(e) {
    const idx = e.target.dataset.idx;
    const nota = e.target.value;
    const valor = valorDa(state.avaliacaoAtual);

    e.target.className = `input-nota-aluno ${notaInputClass(nota, valor)}`;

    const chk = document.querySelector(`.chk-presenca[data-idx="${idx}"]`);
    const presente = chk ? chk.checked : true;

    const status = calcularStatusLocal(nota, presente, valor);
    const statusCell = document.getElementById(`status-cell-${idx}`);
    if (statusCell) statusCell.innerHTML = statusBadgeHTML(status);

    recalcularLiveMetrics();
}

function onPresencaChange(e) {
    const idx = e.target.dataset.idx;
    const presente = e.target.checked;
    const valor = valorDa(state.avaliacaoAtual);
    const labelEl = document.getElementById(`label-presenca-${idx}`);
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

    const status = calcularStatusLocal(
        document.getElementById(`nota-${idx}`)?.value || '',
        presente,
        valor
    );
    const statusCell = document.getElementById(`status-cell-${idx}`);
    if (statusCell) statusCell.innerHTML = statusBadgeHTML(status);

    recalcularLiveMetrics();
}

function recalcularLiveMetrics() {
    const inputs = document.querySelectorAll('.input-nota-aluno');
    const chks = document.querySelectorAll('.chk-presenca');

    const dadosLive = Array.from(inputs).map((inp, i) => ({
        nota: inp.value !== '' ? parseFloat(inp.value) : null,
        presente: chks[i] ? chks[i].checked : true,
    }));

    atualizarLiveMetrics(dadosLive);
}

function atualizarLiveMetrics(alunosDados) {
    const valor = valorDa(state.avaliacaoAtual);
    let soma = 0;
    let count = 0;
    let aprovados = 0;
    let maiorNota = null;
    let menorNota = null;
    const total = alunosDados.length;

    alunosDados.forEach((a) => {
        const nota =
            a.nota !== null && a.nota !== undefined && a.nota !== '' ? parseFloat(a.nota) : null;
        const presente = a.presente !== false;
        if (presente && nota !== null && !Number.isNaN(nota)) {
            soma += nota;
            count++;
            if (calcularStatusLocal(nota, true, valor) === 'Aprovado') aprovados++;
            if (maiorNota === null || nota > maiorNota) maiorNota = nota;
            if (menorNota === null || nota < menorNota) menorNota = nota;
        }
    });

    document.getElementById('liveMediaTurma').textContent =
        count > 0 ? numeroBR(soma / count) : '—';
    document.getElementById('liveMaiorNota').textContent =
        maiorNota !== null ? numeroBR(maiorNota) : '—';
    document.getElementById('liveMenorNota').textContent =
        menorNota !== null ? numeroBR(menorNota) : '—';
    document.getElementById('liveTaxaAprovacao').textContent =
        count > 0 ? `${Math.round((aprovados / count) * 100)}%` : '—';
    document.getElementById('liveAlunosAvaliados').textContent = `${count}/${total}`;
}

/* ── Salvar Notas ────────────────────────────────────────────────────────── */
async function salvarNotas() {
    if (!state.avaliacaoAtual) return;

    const avaliacaoId = state.avaliacaoAtual.id || state.avaliacaoAtual._id;
    const valor = valorDa(state.avaliacaoAtual);
    const motivo =
        document.getElementById('inputMotivoAlteracao').value.trim() || 'Lançamento de notas';

    const alunos = state.avaliacaoAtual.alunos || [];
    const notas = [];
    let foraDaEscala = null;

    alunos.forEach((a, idx) => {
        const notaInput = document.getElementById(`nota-${idx}`);
        const chk = document.querySelector(`.chk-presenca[data-idx="${idx}"]`);
        const obsInput = document.getElementById(`obs-${idx}`);

        const notaVal =
            notaInput && notaInput.value !== '' ? parseFloat(notaInput.value) : null;
        const presente = chk ? chk.checked : true;
        if (notaVal !== null && (notaVal < 0 || notaVal > valor) && !foraDaEscala) {
            foraDaEscala = a.alunoNome;
        }

        notas.push({
            alunoId: a.alunoId,
            notaId: a.notaId || null,
            nota: notaVal,
            presente,
            observacoes: obsInput ? obsInput.value.trim() : '',
            status: calcularStatusLocal(notaVal, presente, valor),
            motivo,
        });
    });

    if (foraDaEscala) {
        showFeedback(
            'msgFeedbackNotas',
            `Nota de ${foraDaEscala} fora da escala: use de 0 a ${numeroBR(valor)}.`,
            'error'
        );
        return;
    }

    const btnSalvar = document.getElementById('btnSalvarNotas');
    btnSalvar.disabled = true;
    btnSalvar.innerHTML = '<i class="bi bi-hourglass-split"></i> Salvando...';

    try {
        await apiFetch(`/avaliacoes-escolares/${encodeURIComponent(avaliacaoId)}/notas`, {
            method: 'POST',
            body: JSON.stringify({ notas, motivo }),
        });

        // Recarrega antes de avisar: `abrirModalNotas` limpa a área de mensagem,
        // e o aviso dado antes sumia sem ninguém ver.
        await abrirModalNotas(avaliacaoId);
        await carregarAvaliacoes();
        showFeedback('msgFeedbackNotas', 'Notas salvas com sucesso!', 'success');
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
    content.innerHTML =
        '<div aria-hidden="true"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line"></span></div>';
    abrirModal('modalHistorico');

    const avaliacao = state.avaliacoes.find((a) => String(a.id || a._id) === avaliacaoId);
    document.getElementById('historicoSubtitulo').textContent = avaliacao
        ? `Auditoria para: "${avaliacao.titulo}"`
        : 'Registro de todas as inserções e alterações de notas para esta avaliação.';

    try {
        const json = await apiFetch(
            `/avaliacoes-escolares/${encodeURIComponent(avaliacaoId)}/historico`
        );
        const registros = json.data || [];

        if (registros.length === 0) {
            content.innerHTML = `<div class="celula-vazia">
                <i class="bi bi-clock-history historico-vazio-icone" aria-hidden="true"></i>
                Nenhuma alteração registrada para esta avaliação ainda.
            </div>`;
            return;
        }

        content.innerHTML = `<div class="audit-timeline">
            ${registros
                .map((r) => {
                    const notaAnterior =
                        r.notaAnterior !== null && r.notaAnterior !== undefined
                            ? numeroBR(r.notaAnterior)
                            : '—';
                    const notaNova =
                        r.notaNova !== null && r.notaNova !== undefined ? numeroBR(r.notaNova) : '—';

                    let descricao = `Nota lançada: <strong>${notaNova}</strong>`;
                    if (r.notaAnterior !== null && r.notaAnterior !== undefined) {
                        descricao = `Nota alterada de <strong>${notaAnterior}</strong> → <strong>${notaNova}</strong>`;
                    }
                    if (
                        r.presenteAnterior !== undefined &&
                        r.presenteNovo !== undefined &&
                        r.presenteAnterior !== r.presenteNovo
                    ) {
                        descricao += ` · Presença: <strong>${r.presenteNovo ? 'Presente' : 'Ausente'}</strong>`;
                    }

                    const perfil = r.alteradoPorPerfil ? `(${esc(r.alteradoPorPerfil)})` : '';

                    return `<div class="audit-item">
                    <div class="audit-dot"></div>
                    <div class="audit-card">
                        <div class="audit-meta-header">
                            <span class="audit-author">
                                <i class="bi bi-person-badge"></i>
                                ${esc(r.alteradoPorNome || 'Usuário')} ${perfil}
                            </span>
                            <span class="audit-time">${fmtDateTime(r.dataAlteracao)}</span>
                        </div>
                        <div class="texto-suave">
                            Aluno: <strong class="texto-forte">${esc(r.alunoNome || r.alunoId)}</strong>
                        </div>
                        <div class="audit-change-desc">${descricao}</div>
                        ${r.motivo ? `<div class="audit-reason"><i class="bi bi-quote"></i> ${esc(r.motivo)}</div>` : ''}
                    </div>
                </div>`;
                })
                .join('')}
        </div>`;
    } catch (err) {
        content.innerHTML = `<div class="celula-erro">
            <i class="bi bi-exclamation-triangle"></i> ${esc(err.message)}
        </div>`;
    }
}
