/**
 * HorarioSync — Serviço de Sincronização da Tabela de Horários
 * ═══════════════════════════════════════════════════════════════
 *
 * Responsabilidades:
 *  1. Carregar dados do MongoDB e sobrescrever window.turmasData (com fallback offline)
 *  2. Persistir alterações de células via PUT /api/tabela-geral/celula
 *  3. Validar conflitos antes de salvar (resposta 409 do backend)
 *  4. Exibir modal de conflito visual
 *  5. Re-renderizar tabelas (geral, sala, professor) após alterações
 *
 * Uso pelo editor (horario-editor.js):
 *   const result = await HorarioSync.updateCell({ turmaId, dia, aulaIdx, abrev });
 *   if (!result.ok) { ... } // conflito ou erro já exibido pelo sync
 */

const HorarioSync = (() => {
    // ── Config ────────────────────────────────────────────────────────────────
    const BASE_URL = (() => {
        const h = window.location.hostname;
        if (h === 'localhost' || h === '127.0.0.1') return 'http://localhost:3001/api';
        return 'https://sistema-escolar-bfty.onrender.com/api';
    })();

    // Mapeamento aulaIdx (0-6) → label de horário
    const HORARIO_LABELS = [
        '7h30–8h20',
        '8h20–9h10',
        '9h30–10h20',
        '10h20–11h10',
        '11h10–12h',
        '13h–13h50',
        '13h50–14h40'
    ];

    // Mapeamento aulaIdx → índice dentro de turmasData[id].horarios[]
    // (os índices 2=INTERVALO e 6=ALMOÇO são pulados)
    const AULA_IDX_TO_HORARIO_IDX = [0, 1, 3, 4, 5, 7, 8];

    const TURMAS_IDS  = ['1A','1B','1C','2A','2B','2C','3A','3B','3C','4A','4B','4C','5A','5B','5C','5D'];
    const TURMAS_NOME = ['1ºA','1ºB','1ºC','2ºA','2ºB','2ºC','3ºA','3ºB','3ºC','4ºA','4ºB','4ºC','5ºA','5ºB','5ºC','5ºD'];
    const DIAS = ['SEGUNDA','TERÇA','QUARTA','QUINTA','SEXTA'];

    /** Calcula professorKey a partir de abrev + turmaId (igual à lógica do backend) */
    function getProfessorKey(abrev, turmaId) {
        if (!abrev) return '';
        const u = abrev.toUpperCase();
        if (u === 'EF') return /^[123]/.test(turmaId) ? 'MARJORIE' : 'MARCOS';
        if (u === 'I')   return 'INGLS';
        if (u === 'A')   return /^1/.test(turmaId) ? 'ARTES1ANO' : 'MIRIAN';
        if (u === 'MK')  return 'OFMAKER';
        if (u === 'OL')  return 'OFLEITURA';
        if (u === 'DSE') return 'OFSEBRAE';
        if (u === 'Lima' || u === 'LIMA') return 'LIMA';
        if (u === 'PEF') return 'EF_PARES';
        if (u === 'PAR') return 'ARTES_PARES';
        return '';
    }

    const PROFESSOR_NOME = {
        MARJORIE:    'Marjorie (Ed. Física)',
        MARCOS:      'Marcos (Ed. Física)',
        INGLS:       'Marcelo (Inglês)',
        ARTES1ANO:   'Bianca (Artes 1º Ano)',
        MIRIAN:      'Mirian (Artes)',
        OFMAKER:     'Sirlene (Of. Maker)',
        OFLEITURA:   'Raquel Castelaneli (Of. Leitura)',
        OFSEBRAE:    'Cherlane (Of. Sebrae/DSE)',
        LIMA:        'Lima (PROERD)',
        EF_PARES:    'Reunião de Pares – Ed. Física',
        ARTES_PARES: 'Reunião de Pares – Artes'
    };

    let _loaded = false;

    // ── Modal de Conflito ─────────────────────────────────────────────────────
    function _ensureModal() {
        if (document.getElementById('sync-conflict-modal')) return;
        const overlay = document.createElement('div');
        overlay.id = 'sync-conflict-modal';
        overlay.style.cssText = `
            display:none; position:fixed; inset:0; z-index:10000;
            background:rgba(0,0,0,.75); align-items:center; justify-content:center;
        `;
        overlay.innerHTML = `
        <div style="
            background:#1e293b; border:2px solid #ef4444; border-radius:16px;
            padding:32px; min-width:340px; max-width:480px;
            box-shadow:0 20px 60px rgba(0,0,0,.6); animation:conflictIn .2s ease;
        ">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
                <span style="font-size:28px;">⚠️</span>
                <h3 style="color:#ef4444;margin:0;font-size:18px;font-weight:700;">
                    Conflito de Horário Detectado
                </h3>
            </div>
            <p style="color:#94a3b8;font-size:13px;margin:0 0 20px;">
                Não é possível realizar essa alteração pois o professor já está
                alocado em outra sala no mesmo horário.
            </p>
            <div id="conflict-details" style="
                background:#0f172a; border:1px solid #334155; border-radius:10px;
                padding:16px; margin-bottom:22px;
            ">
                <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 14px;align-items:center;">
                    <span style="color:#64748b;font-size:12px;font-weight:600;">SALA</span>
                    <span id="cd-sala" style="color:#f1f5f9;font-weight:700;"></span>
                    <span style="color:#64748b;font-size:12px;font-weight:600;">DIA</span>
                    <span id="cd-dia" style="color:#f1f5f9;font-weight:700;"></span>
                    <span style="color:#64748b;font-size:12px;font-weight:600;">HORÁRIO</span>
                    <span id="cd-horario" style="color:#f1f5f9;font-weight:700;"></span>
                    <span style="color:#64748b;font-size:12px;font-weight:600;">PROFESSOR</span>
                    <span id="cd-professor" style="color:#f59e0b;font-weight:700;"></span>
                    <span style="color:#64748b;font-size:12px;font-weight:600;">DISCIPLINA</span>
                    <span id="cd-disciplina" style="color:#60a5fa;font-weight:700;"></span>
                </div>
            </div>
            <div style="display:flex;justify-content:flex-end;">
                <button id="conflict-close-btn" style="
                    padding:10px 24px; background:#3b82f6; color:#fff;
                    border:none; border-radius:8px; cursor:pointer;
                    font-weight:700; font-size:14px;
                ">OK, Entendi</button>
            </div>
        </div>
        <style>
            @keyframes conflictIn {
                from { opacity:0; transform:scale(.92); }
                to   { opacity:1; transform:scale(1); }
            }
        </style>`;
        document.body.appendChild(overlay);
        document.getElementById('conflict-close-btn').addEventListener('click', _hideConflictModal);
        overlay.addEventListener('click', e => { if (e.target === overlay) _hideConflictModal(); });
    }

    function _showConflictModal(d) {
        _ensureModal();
        document.getElementById('cd-sala').textContent      = d.sala || '—';
        document.getElementById('cd-dia').textContent       = d.dia  || '—';
        document.getElementById('cd-horario').textContent   = d.horario || '—';
        document.getElementById('cd-professor').textContent = d.professor || '—';
        document.getElementById('cd-disciplina').textContent = d.disciplina || '—';
        const m = document.getElementById('sync-conflict-modal');
        m.style.display = 'flex';
    }

    function _hideConflictModal() {
        const m = document.getElementById('sync-conflict-modal');
        if (m) m.style.display = 'none';
    }

    // ── Carregar dados do MongoDB → window.turmasData ─────────────────────────
    async function load() {
        try {
            const res = await fetch(`${BASE_URL}/tabela-geral`, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            if (!json.success) throw new Error('Resposta inválida');

            const { grouped } = json.data;

            // Atualizar window.turmasData em memória com os dados do banco
            TURMAS_IDS.forEach((turmaId, turmaIdx) => {
                const td = window.turmasData[turmaId];
                if (!td) return;

                DIAS.forEach((dia, diaIdx) => {
                    const rowData = (grouped[turmaId] && grouped[turmaId][dia]);
                    if (!rowData) return;

                    AULA_IDX_TO_HORARIO_IDX.forEach((horarioIdx, aulaIdx) => {
                        const linha = td.horarios[horarioIdx];
                        if (linha && linha.aulas) {
                            linha.aulas[diaIdx] = rowData[aulaIdx] !== undefined
                                ? rowData[aulaIdx]
                                : (linha.aulas[diaIdx] || '');
                        }
                    });
                });
            });

            _loaded = true;
            console.log('✅ HorarioSync: dados carregados do MongoDB');
            return true;
        } catch (err) {
            console.warn('⚠️ HorarioSync: usando dados offline (hardcoded):', err.message);
            return false;
        }
    }

    // ── Seed do banco de dados ────────────────────────────────────────────────
    async function seed() {
        try {
            if (window.showToast) showToast('Iniciando sincronização...', 'success');
            const res = await fetch(`${BASE_URL}/tabela-geral/seed`, { method: 'POST' });
            const json = await res.json();
            console.log('🌱 HorarioSync seed:', json);
            if (json.success) {
                if (window.showToast) showToast('Banco de Dados sincronizado com sucesso!');
            } else {
                if (window.showToast) showToast('Erro ao sincronizar banco', 'error');
            }
            return json;
        } catch (err) {
            console.error('❌ HorarioSync seed erro:', err);
            if (window.showToast) showToast('Erro de rede ao sincronizar', 'error');
            return { success: false, error: err.message };
        }
    }

    // ── Atualizar célula com validação de conflito ────────────────────────────
    /**
     * @param {object} params
     * @param {string} params.turmaId    ex: '2A'
     * @param {string} params.dia        ex: 'SEGUNDA'
     * @param {number} params.aulaIdx    0-6
     * @param {string} params.abrev      ex: 'EF', 'I', ''
     * @returns {{ ok: boolean, conflict?: object, error?: string }}
     */
    async function updateCell({ turmaId, dia, aulaIdx, abrev }) {
        const professorKey = getProfessorKey(abrev, turmaId);

        try {
            const res = await fetch(`${BASE_URL}/tabela-geral/celula`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ turmaId, dia, aulaIdx, abrev, professorKey })
            });

            const json = await res.json();

            if (res.status === 409 && json.conflict) {
                // Exibe modal de conflito
                const d = json.detalhe || {};
                _showConflictModal({
                    sala:       d.sala || '—',
                    dia:        d.dia || dia,
                    horario:    d.horario || HORARIO_LABELS[aulaIdx] || '—',
                    professor:  d.professor || PROFESSOR_NOME[professorKey] || professorKey,
                    disciplina: d.disciplina || abrev || '—'
                });
                return { ok: false, conflict: json.detalhe };
            }

            if (!json.success) {
                console.error('❌ HorarioSync updateCell:', json.error);
                return { ok: false, error: json.error };
            }

            // Atualiza window.turmasData em memória
            _applyLocalUpdate(turmaId, dia, aulaIdx, abrev);

            return { ok: true, data: json.data };
        } catch (err) {
            console.error('❌ HorarioSync updateCell (rede):', err.message);
            // Em modo offline, aplica localmente sem conflito
            _applyLocalUpdate(turmaId, dia, aulaIdx, abrev);
            return { ok: true, offline: true };
        }
    }

    /** Aplica a alteração em window.turmasData sem chamar a API */
    function _applyLocalUpdate(turmaId, dia, aulaIdx, abrev) {
        const td = window.turmasData[turmaId];
        if (!td) return;
        const diaIdx    = DIAS.indexOf(dia);
        const horarioIdx = AULA_IDX_TO_HORARIO_IDX[aulaIdx];
        if (diaIdx < 0 || horarioIdx === undefined) return;
        const linha = td.horarios[horarioIdx];
        if (linha && linha.aulas) {
            linha.aulas[diaIdx] = abrev || '';
        }
    }

    // ── Buscar horário de professor do banco ──────────────────────────────────
    async function getProfessorHorario(professorKey) {
        try {
            const res = await fetch(`${BASE_URL}/tabela-geral/prof/${encodeURIComponent(professorKey)}`);
            const json = await res.json();
            return json.success ? json.data : null;
        } catch (err) {
            return null;
        }
    }

    // ── API Pública ───────────────────────────────────────────────────────────
    return {
        load,
        seed,
        updateCell,
        getProfessorHorario,
        showConflictModal: _showConflictModal,
        hideConflictModal: _hideConflictModal,
        HORARIO_LABELS,
        AULA_IDX_TO_HORARIO_IDX,
        getProfessorKey,
        PROFESSOR_NOME,
        get isLoaded() { return _loaded; }
    };
})();

window.HorarioSync = HorarioSync;
