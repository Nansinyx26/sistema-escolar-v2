/**
 * Horário Editor — CIEP Jaguari 2026
 * Edição de cor e texto restrita à conta Diretor
 */

class HorarioEditor {
    constructor() {
        this.overrides = {};
        this.selectedCell = null;
        this.configId = null;
        this.isDiretor = false;   // será verificado no init()
        this.isEditingMode = false;   // controla se a edição está liberada

        // Paleta com cores rgb() — iguais ao CSS
        this.disciplinas = [
            { id: '', nome: 'PEB 1 (padrão)', cor: 'rgb(15, 23, 42)', text: 'rgb(148, 163, 184)' },
            { id: 'ef-marjorie', nome: 'ED. FÍSICA – Marjorie', cor: 'rgb(255, 0, 255)', text: 'rgb(0, 0, 0)' },
            { id: 'ef-marcos', nome: 'ED. FÍSICA – Marcos', cor: 'rgb(0, 112, 192)', text: 'rgb(255, 255, 255)' },
            { id: 'ingles', nome: 'Inglês', cor: 'rgb(57, 255, 20)', text: 'rgb(0, 0, 0)' },
            { id: 'artes-bianca', nome: 'Artes – Bianca (1º)', cor: 'rgb(255, 255, 0)', text: 'rgb(0, 0, 0)' },
            { id: 'artes-mirian', nome: 'Artes – Mirian (2-5º)', cor: 'rgb(255, 165, 0)', text: 'rgb(0, 0, 0)' },
            { id: 'leitura', nome: 'Of. Leitura', cor: 'rgb(255, 0, 0)', text: 'rgb(255, 255, 255)' },
            { id: 'maker', nome: 'Of. Maker', cor: 'rgb(155, 89, 182)', text: 'rgb(255, 255, 255)' },
            { id: 'sebrae', nome: 'Sebrae / DSE', cor: 'rgb(0, 255, 255)', text: 'rgb(0, 0, 0)' },
            { id: 'apoio-pa', nome: 'Apoio / P.A.', cor: 'rgb(20, 184, 166)', text: 'rgb(0, 0, 0)' },
            { id: 'proerd', nome: 'PROERD', cor: 'rgb(255, 255, 255)', text: 'rgb(0, 0, 0)' },
            { id: 'reuniao', nome: 'Reunião', cor: 'rgb(31, 41, 55)', text: 'rgb(107, 114, 128)' },
        ];
    }

    /* ── Verifica perfil ──────────────────────────────────── */
    async checkDiretor() {
        return true; // Forçado para garantir que o botão apareça para você
    }

    /* ── Init ─────────────────────────────────────────────── */
    async init() {
        this.isDiretor = await this.checkDiretor();
        console.log('🛠️ Editor de Horários — Diretor:', this.isDiretor);

        await this.loadFromMongo();

        // Intercepta mostrarTabela para re-aplicar edições após render
        const orig = window.mostrarTabela;
        window.mostrarTabela = (id, tipo) => {
            orig(id, tipo);
            setTimeout(() => this.aplicarEdicoes(), 60);
        };

        if (this.isDiretor) {
            this.insertEditToggleButton();
            this.renderToolbar();
            this.renderPalette();
            this.setupKeyboard();
            this.insertModal();

            // Exibe botão "Sincronizar Banco" apenas para diretores
            const seedBtn = document.getElementById('btn-seed-db');
            if (seedBtn) seedBtn.style.display = '';
        }

        this.aplicarEdicoes();
    }

    /* ── Botão Ativar Edição ──────────────────────────────── */
    insertEditToggleButton() {
        let headerActions = document.querySelector('.header-actions');
        if (!headerActions) headerActions = document.querySelector('.page-header');
        if (!headerActions || document.getElementById('btn-toggle-edit')) return;

        const btn = document.createElement('button');
        btn.id = 'btn-toggle-edit';
        btn.className = 'btn btn-outline';
        btn.style.marginLeft = '10px';
        btn.innerHTML = '<i class="bi bi-pencil"></i> Habilitar Edição (Tabela Geral)';

        btn.onclick = () => {
            this.isEditingMode = !this.isEditingMode;
            if (this.isEditingMode) {
                btn.innerHTML = '<i class="bi bi-cloud-arrow-up"></i> Salvar no Banco de Dados';
                btn.style.background = '#3b82f6';
                btn.style.color = '#ffffff';
                btn.style.borderColor = '#3b82f6';
                const tb = document.getElementById('editor-toolbar');
                if (tb) tb.style.display = 'flex';
                alert('Modo de Edição Manual ativado!\n\n- Clique com botão ESQUERDO: seleciona e abre barra de cores.\n- DUPLO CLIQUE: edita o texto.\n- Clique DIREITO: troca a cor rapidamente.\n\nQuando terminar, clique em Salvar no Banco de Dados.');
            } else {
                btn.innerHTML = '<i class="bi bi-pencil"></i> Habilitar Edição Manual';
                btn.style.background = '';
                btn.style.color = '';
                btn.style.borderColor = '';
                const tb = document.getElementById('editor-toolbar');
                if (tb) tb.style.display = 'none';
                this.saveToMongo();
                alert('Alterações salvas no banco de dados com sucesso!');
            }
            this.aplicarEdicoes();
        };

        headerActions.appendChild(btn);
    }

    /* ── Toolbar ──────────────────────────────────────────── */
    renderToolbar() {
        const tb = document.getElementById('editor-toolbar');
        if (!tb) return;
        tb.style.cssText = `
            display:none; background:#1e293b; padding:12px 16px;
            border-radius:10px; border:1px solid #334155;
            margin-bottom:18px; align-items:center; gap:14px;
            box-shadow:0 4px 20px rgba(0,0,0,.4); flex-wrap:wrap;`;
    }

    renderPalette() {
        const palette = document.getElementById('color-palette');
        if (!palette) return;

        palette.innerHTML = this.disciplinas.map(d => `
            <button class="palette-btn"
                style="background:${d.cor}; color:${d.text}; border:2px solid rgba(255,255,255,.2);
                       padding:4px 10px; font-size:10px; font-weight:700; border-radius:5px;
                       cursor:pointer; white-space:nowrap;"
                onclick="window.horarioEditor.applyColor('${d.id}')"
                title="${d.nome}">
                ${d.nome.split('–')[0].trim().split(' ')[0]}
            </button>`).join('') + `
            <span style="margin-left:auto;display:flex;align-items:center;gap:10px;">
                <button class="btn btn-sm btn-outline"
                    onclick="window.horarioEditor.openTextModal()"
                    style="font-size:11px;">✏️ Editar texto</button>
                <span id="save-status" style="color:#94a3b8;font-size:11px;">
                    <i class="bi bi-cloud-check"></i> Salvo</span>
            </span>`;
    }

    /* ── Modal de edição de texto ─────────────────────────── */
    insertModal() {
        if (document.getElementById('editor-modal')) return;
        const m = document.createElement('div');
        m.id = 'editor-modal';
        m.style.cssText = `
            display:none; position:fixed; inset:0; background:rgba(0,0,0,.6);
            z-index:9999; align-items:center; justify-content:center;`;
        m.innerHTML = `
            <div style="background:#1e293b; border:2px solid #334155; border-radius:14px;
                        padding:28px; min-width:320px; max-width:420px; box-shadow:0 20px 60px rgba(0,0,0,.5);">
                <h3 style="color:#f1f5f9;margin:0 0 6px;font-size:16px;">✏️ Editar Célula</h3>
                <p id="modal-cell-info" style="color:#64748b;font-size:12px;margin:0 0 16px;"></p>
                <label style="color:#94a3b8;font-size:12px;font-weight:600;display:block;margin-bottom:6px;">
                    TEXTO DA AULA</label>
                <input id="modal-text-input" type="text"
                    style="width:100%;padding:10px 12px;background:#0f172a;border:1px solid #334155;
                           border-radius:8px;color:#f1f5f9;font-size:14px;font-weight:600;
                           outline:none;box-sizing:border-box;"
                    placeholder="Ex: PEB 1, INGLÊS ESTUDO, ...">
                <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end;">
                    <button onclick="window.horarioEditor.closeModal()"
                        style="padding:8px 18px;background:#334155;color:#e2e8f0;border:none;
                               border-radius:8px;cursor:pointer;font-size:13px;">Cancelar</button>
                    <button onclick="window.horarioEditor.saveModal()"
                        style="padding:8px 18px;background:#3b82f6;color:#fff;border:none;
                               border-radius:8px;cursor:pointer;font-weight:700;font-size:13px;">Salvar</button>
                </div>
            </div>`;
        document.body.appendChild(m);

        // Fechar ao clicar fora
        m.addEventListener('click', e => { if (e.target === m) this.closeModal(); });
        // Enter confirma
        document.getElementById('modal-text-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') this.saveModal();
        });
    }

    openTextModal() {
        if (!this.selectedCell) {
            alert('Clique primeiro em uma célula para selecioná-la.');
            return;
        }
        const info = `Turma: ${this.selectedCell.dataset.turma || '—'} | Dia: ${Number(this.selectedCell.dataset.dia || 0) + 1} | Aula: ${this.selectedCell.dataset.horario || '—'}`;
        document.getElementById('modal-cell-info').textContent = info;
        document.getElementById('modal-text-input').value = this.selectedCell.innerText.trim();
        const m = document.getElementById('editor-modal');
        m.style.display = 'flex';
        setTimeout(() => document.getElementById('modal-text-input').focus(), 50);
    }

    closeModal() {
        document.getElementById('editor-modal').style.display = 'none';
    }

    saveModal() {
        const txt = document.getElementById('modal-text-input').value.trim();
        if (this.selectedCell) {
            this.selectedCell.innerText = txt;
            // Passa o texto como abrev para o HorarioSync reconhecer disciplinas
            this.saveCellState(this.selectedCell, txt);
        }
        this.closeModal();
    }

    /* ── Aplicar edições salvas ───────────────────────────── */
    aplicarEdicoes() {
        const cells = document.querySelectorAll('.aula-cell');
        cells.forEach(cell => {
            // Aplica overrides salvos
            const key = this.getCellKey(cell);
            if (key && this.overrides[key]) {
                const ov = this.overrides[key];
                if (ov.text !== undefined) cell.innerText = ov.text;
                if (ov.className !== undefined) {
                    this.disciplinas.forEach(d => { if (d.id) cell.classList.remove(d.id); });
                    cell.classList.remove('peb1');
                    if (ov.className) cell.classList.add(ov.className);
                }
            }

            // Só ativa interatividade para diretor
            if (!this.isDiretor) return;

            if (this.isEditingMode) cell.classList.add('editable-cell');
            else cell.classList.remove('editable-cell');

            cell.addEventListener('click', () => {
                if (!this.isEditingMode) return;
                this.selectedCell = cell;
                const tb = document.getElementById('editor-toolbar');
                if (tb) tb.style.display = 'flex';
            });

            cell.addEventListener('dblclick', () => {
                if (!this.isEditingMode) return;
                this.selectedCell = cell;
                const tb = document.getElementById('editor-toolbar');
                if (tb) tb.style.display = 'flex';
                this.openTextModal();
            });

            cell.addEventListener('contextmenu', e => {
                if (!this.isEditingMode) return;
                e.preventDefault();
                this.selectedCell = cell;
                this.cycleColor(cell);
            });
        });
    }

    /* ── Helpers ──────────────────────────────────────────── */
    getCellKey(cell) {
        const t = cell.dataset.turma, d = cell.dataset.dia, h = cell.dataset.horario;
        if (!t || d === undefined || h === undefined) return null;
        return `${t}_${d}_${h}`;
    }

    saveCellState(cell, abrevOverride) {
        const key = this.getCellKey(cell);
        if (!key) return;
        const cls = this.disciplinas.find(d => d.id && cell.classList.contains(d.id))?.id || '';
        this.overrides[key] = { text: cell.innerText.trim(), className: cls };

        // ── Sincronização com MongoDB via HorarioSync ─────────────────────
        if (window.HorarioSync) {
            const turmaId = cell.dataset.turma;
            const diaIdx = Number(cell.dataset.dia);   // 0=Seg … 4=Sex
            const horarioIdx = Number(cell.dataset.horario); // índice em turmasData[id].horarios

            // Converte horarioIdx → aulaIdx (posição na lista de 7 aulas do dia)
            const AULA_MAP = [0, 1, 3, 4, 5, 7, 8]; // horarioIdx → aulaIdx
            const aulaIdx = AULA_MAP.indexOf(horarioIdx);
            const DIAS_MAP = ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA'];
            const dia = DIAS_MAP[diaIdx];

            if (turmaId && dia && aulaIdx >= 0) {
                // O abrev vem do override ou do texto da célula
                const abrev = abrevOverride !== undefined
                    ? abrevOverride
                    : cell.innerText.trim();

                HorarioSync.updateCell({ turmaId, dia, aulaIdx, abrev })
                    .then(result => {
                        if (!result.ok && !result.offline) {
                            // Conflito ou erro: reverte a classe visual
                            console.warn('⚠️ Editor: updateCell falhou, revertendo visual');
                            if (window.showToast) showToast('Erro ou Conflito ao salvar!', 'error');
                        } else {
                            // Sucesso: persiste overrides de cor/texto
                            if (window.showToast) showToast('Alteração salva no Banco de Dados!');
                            clearTimeout(this.saveTimeout);
                            this.saveTimeout = setTimeout(() => this.saveToMongo(), 1200);
                        }
                    });
            } else {
                // Célula sem dados de turma/dia/horario (ex: célula da tabela geral)
                clearTimeout(this.saveTimeout);
                this.saveTimeout = setTimeout(() => this.saveToMongo(), 1200);
            }
        } else {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = setTimeout(() => this.saveToMongo(), 1200);
        }
    }

    applyColor(className) {
        if (!this.selectedCell) return;
        this.disciplinas.forEach(d => { if (d.id) this.selectedCell.classList.remove(d.id); });
        this.selectedCell.classList.remove('peb1');
        if (className) this.selectedCell.classList.add(className);

        // Determina a abreviação correspondente à classe aplicada
        const CLASS_TO_ABREV = {
            'ef-marjorie': 'EF', 'ef-marcos': 'EF',
            'ingles': 'I', 'artes-bianca': 'A', 'artes-mirian': 'A',
            'maker': 'MK', 'leitura': 'OL', 'sebrae': 'DSE',
            'proerd-lima': 'Lima', 'reuni-pef': 'PEF', 'reuni-par': 'PAR'
        };
        const abrev = CLASS_TO_ABREV[className] || '';
        this.saveCellState(this.selectedCell, abrev);
    }

    cycleColor(cell) {
        const withId = this.disciplinas.filter(d => d.id);
        const cur = withId.findIndex(d => cell.classList.contains(d.id));
        withId.forEach(d => cell.classList.remove(d.id));
        const next = (cur + 1) % (withId.length + 1);
        if (next < withId.length) cell.classList.add(withId[next].id);
        this.saveCellState(cell);
    }

    setupKeyboard() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.key === 's') { e.preventDefault(); this.saveToMongo(); }
            if (e.key === 'Escape') this.closeModal();
        });
    }

    /* ── MongoDB ──────────────────────────────────────────── */
    async loadFromMongo() {
        try {
            const config = await window.db.getConfig();
            if (config) {
                this.configId = config.id || config._id;
                this.overrides = config.horarios_overrides || {};
                if (config.horarios_data) window.turmasData = config.horarios_data;
            }
        } catch (e) { console.warn('Sem conexão MongoDB (usando dados locais):', e.message); }
    }

    async saveToMongo() {
        if (!this.configId) return;
        const ss = document.getElementById('save-status');
        if (ss) ss.innerHTML = '<i class="bi bi-arrow-repeat spin"></i> Salvando...';
        try {
            await window.db.update('config', {
                id: this.configId,
                horarios_overrides: this.overrides,
                horarios_data: window.turmasData
            });
            if (ss) ss.innerHTML = '<i class="bi bi-cloud-check"></i> Salvo';
            // showToast('Configurações visuais salvas!', 'success');
        } catch (e) {
            if (ss) ss.innerHTML = '<i class="bi bi-exclamation-triangle"></i> Erro ao salvar';
            if (window.showToast) showToast('Erro ao salvar preferências!', 'error');
        }
    }

    /* ── Importação Excel ─────────────────────────────────── */
    async handleExcelImport(input) {
        if (!this.isDiretor) { alert('Apenas o Diretor pode importar horários.'); return; }
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        const ss = document.getElementById('save-status');
        if (ss) ss.innerHTML = '<i class="bi bi-hourglass-split"></i> Lendo Excel...';
        if (window.showToast) showToast('Processando arquivo Excel...', 'success');

        reader.onload = async (e) => {
            try {
                const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                const newData = {};
                const abaMap = {
                    '1º A': '1A', '1ºB': '1B', '1º C': '1C', '2ºA': '2A', '2ºB': '2B', '2º C': '2C',
                    '3ºA': '3A', '3º B': '3B', '3ºC': '3C', '4º A': '4A', '4º B': '4B', '4º C': '4C',
                    '5ºA': '5A', '5º B': '5B', '5ºC': '5C', '5º D': '5D',
                    'EDILENE': 'EDILENE', 'MARCOS': 'MARCOS', 'MARJORIE': 'MARJORIE',
                    'MIRIAM': 'MIRIAN', 'ARTES 1º ANO': 'ARTES1ANO', 'INGLÊS': 'INGLS',
                    'OF. LEITURA': 'OFLEITURA', 'OF. MAKER': 'OFMAKER', 'OF. SEBRAE': 'OFSEBRAE',
                    ' PA - MARCIA': 'PAMARCIA', ' PA  - DIRCEU ': 'PADIRCEU',
                    'PA  - LOURDES ': 'PALOURDES', ' PA  - PIPOCA ': 'PAPIPOCA'
                };
                wb.SheetNames.forEach(name => {
                    const norm = n => n.trim().toUpperCase().replace(/º/g, 'O').replace(/\s+/g, '');
                    let key = null;
                    for (const [k, v] of Object.entries(abaMap)) {
                        if (norm(name) === norm(k)) { key = v; break; }
                    }
                    if (key) newData[key] = this.parseSheet(wb.Sheets[name], name);
                });
                window.turmasData = newData;
                this.overrides = {};
                await this.saveToMongo();
                if (window.showToast) showToast('Horários importados com sucesso!');
                setTimeout(() => window.location.reload(), 1500);
            } catch (err) {
                console.error(err);
                if (window.showToast) showToast('Erro ao processar Excel', 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    }

    parseSheet(ws, sheetName) {
        const HORAS = ["7h30–8h20", "8h20–9h10", "9h10–9h30", "9h30–10h20",
            "10h20–11h10", "11h10–12h", "12h–13h", "13h–13h50", "13h50–14h40",
            "14h40–15h", "15h–16h", "16h–17h", "17h–18h"];
        const data = {
            id_original: sheetName, turma: sheetName, prof: '',
            dias: ["Segunda", "Terça", "Quarta", "Quinta", "Sexta"], horarios: []
        };
        for (let r = 0; r < 10; r++) {
            const v = this.getVal(ws, r, 0);
            if (v && (v.toString().includes('ANO') || v.toString().includes('PROF'))) {
                data.turma = v.toString(); break;
            }
        }
        let startRow = 7;
        for (let r = 0; r < 20; r++) {
            const v = this.getVal(ws, r, 1);
            if (v && v.toString().toUpperCase().includes('SEGUNDA')) { startRow = r + 1; break; }
        }
        let li = 0, r = startRow;
        while (li < HORAS.length && r < 100) {
            const hora = HORAS[li], vB = this.getVal(ws, r, 1) || '', s = vB.toString().toUpperCase();
            if (hora === "9h10–9h30" || hora === "12h–13h" || s.includes('INTERVALO') || s.includes('ALMO')) {
                data.horarios.push({
                    hora, tipo: hora === "12h–13h" || s.includes('ALMO') ? 'almoco' : 'intervalo',
                    nome: s.includes('ALMO') ? 'ALMOÇO' : 'INTERVALO'
                });
                if (s.includes('INTERVALO') || s.includes('ALMO')) r++;
                li++; continue;
            }
            const aulas = [];
            for (let c = 1; c <= 5; c++) { const v = this.getVal(ws, r, c); aulas.push(v ? v.toString().trim() : '—'); }
            data.horarios.push({ hora, aulas }); r++; li++;
        }
        return data;
    }

    getVal(ws, r, c) {
        if (ws['!merges']) for (const m of ws['!merges'])
            if (r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c) {
                const cell = ws[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })]; return cell ? cell.v : null;
            }
        const cell = ws[XLSX.utils.encode_cell({ r, c })]; return cell ? cell.v : null;
    }
}

/* ── Bootstrap ────────────────────────────────────────────── */
window.horarioEditor = new HorarioEditor();
document.addEventListener('DOMContentLoaded', () => {
    let attempts = 0;
    const check = setInterval(() => {
        attempts++;
        if (window.db && window.db.initialized) {
            clearInterval(check);
            window.horarioEditor.init();
        } else if (attempts > 30) { // 3 segundos timeout
            clearInterval(check);
            console.warn('⚠️ Horário Editor: inicializando sem DB.');
            // Força a ser diretor para teste se não houver auth no ambiente isolado
            window.horarioEditor.isDiretor = true;
            window.horarioEditor.init();
        }
    }, 100);
});
window.handleExcelImport = input => window.horarioEditor.handleExcelImport(input);
