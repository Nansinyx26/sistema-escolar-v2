// ── Configuração ────────────────────────────────────────────────────────
const BASE_URL = window.API_BASE_URL;

const VIRTUAL_SCHEDULE = {
    'MIRIAN': {
        'SEGUNDA': { 6: 'REUNIÍO PEDAGÓGICA' },
        'TERÇA': { 4: 'ESTUDO (H.A)' },
        'QUINTA': { 2: 'REUNIÍO DE PARES' },
        'SEXTA': { 0: 'H.A', 1: 'H.A', 2: 'H.A', 3: 'H.A', 4: 'H.A', 6: 'ESTUDO (H.A)' }
    }
};

const DIAS = ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA'];
const DIAS_PT = ['Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira'];
const DIA_JS = [1, 2, 3, 4, 5];

const HORARIOS = [
    '7h30–8h20', '8h20–9h10', '9h30–10h20',
    '10h20–11h10', '11h10–12h', '13h–13h50', '13h50–14h40'
];

const NOMES_PROF = {
    MARJORIE: 'Marjorie', MARCOS: 'Marcos',
    INGLS: 'Marcelo', ARTES1ANO: 'Bianca',
    MIRIAN: 'Mirian', OFMAKER: 'Sirlene',
    OFLEITURA: 'Raquel Castelaneli',
    OFSEBRAE: 'Cherlane', LIMA: 'Lima',
    EF_PARES: 'Reunião de Pares – Ed. Física',
    ARTES_PARES: 'Reunião de Pares – Artes',
    'LEONORA': 'Leonora', 'CLEUSA': 'Cleusa', 'GISLEIDE': 'Gisleide',
    'MEIRE BRAZ': 'Meire Braz', 'MEIRE CANALI': 'Meire Canali', 'CLEIDE': 'Cleide',
    'SOLANGE': 'Solange', 'TAYRINE': 'Tayrine', 'DENISE': 'Denise',
    'ADRIANA': 'Adriana', 'SIRLEI': 'Sirlei', 'IVANI': 'Ivani',
    'JUSSARA': 'Jussara', 'MEIRE SOUZA': 'Meire Souza', 'EDITE': 'Edite', 'MARIANGELA': 'Mariangela'
};

const DISC_PROF = {
    MARJORIE: 'Educação Física (1º, 2º e 3º anos)',
    MARCOS: 'Educação Física (4º e 5º anos)',
    INGLS: 'Inglês',
    ARTES1ANO: 'Artes (1º ano)',
    MIRIAN: 'Artes (2º ao 5º ano)',
    OFMAKER: 'Oficina de Maker',
    OFLEITURA: 'Oficina de Leitura e Expressão',
    OFSEBRAE: 'Desenvolvimento Socioemocional / Sebrae',
    LIMA: 'PROERD',
    'LEONORA': 'PEB 1 (Turma 1ºA)', 'CLEUSA': 'PEB 1 (Turma 1ºB)', 'GISLEIDE': 'PEB 1 (Turma 1ºC)',
    'MEIRE BRAZ': 'PEB 1 (Turma 2ºA)', 'MEIRE CANALI': 'PEB 1 (Turma 2ºB)', 'CLEIDE': 'PEB 1 (Turma 2ºC)',
    'SOLANGE': 'PEB 1 (Turma 3ºA)', 'TAYRINE': 'PEB 1 (Turma 3ºB)', 'DENISE': 'PEB 1 (Turma 3ºC)',
    'ADRIANA': 'PEB 1 (Turma 4ºA)', 'SIRLEI': 'PEB 1 (Turma 4ºB)', 'IVANI': 'PEB 1 (Turma 4ºC)',
    'JUSSARA': 'PEB 1 (Turma 5ºA)', 'MEIRE SOUZA': 'PEB 1 (Turma 5ºB)', 'EDITE': 'PEB 1 (Turma 5ºC)', 'MARIANGELA': 'PEB 1 (Turma 5ºD)'
};

const PROF_PARA_SALA = {
    'LEONORA': '1A', 'CLEUSA': '1B', 'GISLEIDE': '1C',
    'MEIRE BRAZ': '2A', 'MEIRE CANALI': '2B', 'CLEIDE': '2C',
    'SOLANGE': '3A', 'TAYRINE': '3B', 'DENISE': '3C',
    'ADRIANA': '4A', 'SIRLEI': '4B', 'IVANI': '4C',
    'JUSSARA': '5A', 'MEIRE SOUZA': '5B', 'EDITE': '5C', 'MARIANGELA': '5D'
};

const EMOJI_PROF = {
    MARJORIE: '🏃‍♀️', MARCOS: '🏃‍♂️', INGLS: '🌎',
    ARTES1ANO: '🎨', MIRIAN: '🎨', OFMAKER: '🔧',
    OFLEITURA: '📖', OFSEBRAE: '🧠', LIMA: '👮'
};

const ABREV_DISC = {
    EF: 'Educação Física', I: 'Inglês', A: 'Artes',
    MK: 'Maker', OL: 'Leitura', DSE: 'Sebrae/DSE',
    Lima: 'PROERD', PEF: 'Reunião EF', PAR: 'Reunião Artes'
};

const SALA_NOMES = {
    '1A': '1º Ano A', '1B': '1º Ano B', '1C': '1º Ano C',
    '2A': '2º Ano A', '2B': '2º Ano B', '2C': '2º Ano C',
    '3A': '3º Ano A', '3B': '3º Ano B', '3C': '3º Ano C',
    '4A': '4º Ano A', '4B': '4º Ano B', '4C': '4º Ano C',
    '5A': '5º Ano A', '5B': '5º Ano B', '5C': '5º Ano C', '5D': '5º Ano D'
};

function isDiaHoje(diaKey) {
    const hoje = new Date().getDay();
    const idx = DIAS.indexOf(diaKey);
    return idx >= 0 && DIA_JS[idx] === hoje;
}

// ── Mapeia abrev+sala → chave de professor (espelha o backend) ────────────
function calcProfKey(abrev, salaId) {
    if (!abrev) return '';
    const u = abrev.toUpperCase();
    if (u === 'EF') return /^[123]/.test(salaId) ? 'MARJORIE' : 'MARCOS';
    if (u === 'I') return 'INGLS';
    if (u === 'A') return /^1/.test(salaId) ? 'ARTES1ANO' : 'MIRIAN';
    if (u === 'MK') return 'OFMAKER';
    if (u === 'OL') return 'OFLEITURA';
    if (u === 'DSE') return 'OFSEBRAE';
    if (u === 'LIMA' || abrev === 'Lima') return 'LIMA';
    if (u === 'PEF') return 'EF_PARES';
    if (u === 'PAR') return 'ARTES_PARES';
    return '';
}

// Nomes das turmas no formato do banco (1ºA, 2ºB …)
const TURMAS_NOMES_DB = {
    '1A': '1ºA', '1B': '1ºB', '1C': '1ºC',
    '2A': '2ºA', '2B': '2ºB', '2C': '2ºC',
    '3A': '3ºA', '3B': '3ºB', '3C': '3ºC',
    '4A': '4ºA', '4B': '4ºB', '4C': '4ºC',
    '5A': '5ºA', '5B': '5ºB', '5C': '5ºC', '5D': '5ºD'
};

// Constrói horário de sala a partir dos dados já embutidos no HTML
function buildFallbackSala(salaId) {
    const norm = salaId.toUpperCase().replace(/º/g, '').replace(/ANO/g, '').replace(/\s/g, '');
    const sIdx = SALAS_IDX.indexOf(norm);
    const horarios = {};
    DIAS.forEach(d => {
        if (sIdx >= 0) horarios[d] = JSON.parse(JSON.stringify(FALLBACK_DADOS[d][sIdx]));
    });
    return horarios;
}

// Constrói horário de professor especialista a partir dos dados embutidos
function buildFallbackProfessor(profKey) {
    const byDia = {};
    DIAS.forEach(dia => {
        const diaData = FALLBACK_DADOS[dia];
        SALAS_IDX.forEach((salaId, salaIdx) => {
            (diaData[salaIdx] || []).forEach((abrev, aulaIdx) => {
                if (!abrev || calcProfKey(abrev, salaId) !== profKey) return;
                if (!byDia[dia]) byDia[dia] = {};
                byDia[dia][aulaIdx] = {
                    turmaId: salaId,
                    turmaNome: TURMAS_NOMES_DB[salaId] || salaId,
                    abrev,
                    horarioLabel: HORARIOS[aulaIdx]
                };
            });
        });
    });
    return byDia;
}

// Fetch silencioso em background para sincronizar com o banco
function fetchBackground(url, callback) {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 12000);
    fetch(url, { signal: ctrl.signal, credentials: 'include' })
        .then(r => r.json())
        .then(json => { if (json && json.success) callback(json); })
        .catch(() => { }); // falha silenciosa — dados embutidos já estão visíveis
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const profKey = params.get('prof');
    const salaId = params.get('sala');

    if (!profKey && !salaId) { showError('Nenhum professor ou sala especificado na URL.'); return; }

    if (profKey) {
        const profKeyNorm = profKey.toUpperCase().replace(/_/g, ' ').trim();
        const salaVinculada = PROF_PARA_SALA[profKeyNorm];

        if (salaVinculada) {
            // ── PEB1 via ?prof=NOME ──────────────────────────────────────
            const salaLabel = SALA_NOMES[salaVinculada] || salaVinculada;
            const nomeReal = NOMES_PROF[profKeyNorm] || profKey;
            document.getElementById('profName').textContent = nomeReal;
            document.getElementById('profDisc').textContent = `PEB 1 — Turma ${salaLabel}`;
            document.getElementById('profAvatar').textContent = '👩‍🏫';
            document.getElementById('pageTitle').textContent = `Horário — ${nomeReal}`;
            document.getElementById('profBanner').style.display = 'flex';
            document.getElementById('totalTurmas').parentElement.style.display = 'none';

            // Renderiza IMEDIATAMENTE com dados já embutidos no HTML
            renderModoSala(buildFallbackSala(salaVinculada), salaVinculada);

            // Atualiza em background com dados do banco (sem bloquear a tela)
            fetchBackground(
                `${BASE_URL}/tabela-geral/sala/${encodeURIComponent(salaVinculada)}?t=${Date.now()}`,
                json => renderModoSala(json.data.horarios, salaVinculada)
            );
            return;
        }

        // ── Professor especialista via ?prof=KEY ────────────────────────
        const nome = NOMES_PROF[profKey] || profKey;
        const disc = DISC_PROF[profKey] || 'Especialista';
        const emoji = EMOJI_PROF[profKey] || '👩‍🏫';
        document.getElementById('profName').textContent = nome;
        document.getElementById('profDisc').textContent = disc;
        document.getElementById('profAvatar').textContent = emoji;
        document.getElementById('pageTitle').textContent = `Horário — ${nome}`;
        document.getElementById('profBanner').style.display = 'flex';

        // Renderiza IMEDIATAMENTE com dados embutidos
        renderModoProfessor(buildFallbackProfessor(profKey), profKey);

        // Atualiza em background com dados do banco
        fetchBackground(
            `${BASE_URL}/tabela-geral/prof/${encodeURIComponent(profKey)}?t=${Date.now()}`,
            json => renderModoProfessor(json.data.horarios, profKey)
        );

    } else {
        // ── Sala direta via ?sala=ID ───────────────────────────────────────
        const salaLabel = SALA_NOMES[salaId] || salaId;
        document.getElementById('profName').textContent = `Turma ${salaLabel}`;
        document.getElementById('profDisc').textContent = 'PEB1 — Horário completo da sala';
        document.getElementById('profAvatar').textContent = '🏫';
        document.getElementById('pageTitle').textContent = `Horário — Turma ${salaLabel}`;
        document.getElementById('profBanner').style.display = 'flex';
        document.getElementById('totalTurmas').parentElement.style.display = 'none';

        // Renderiza IMEDIATAMENTE com dados embutidos
        renderModoSala(buildFallbackSala(salaId), salaId);

        // Atualiza em background com dados do banco
        fetchBackground(
            `${BASE_URL}/tabela-geral/sala/${encodeURIComponent(salaId)}?t=${Date.now()}`,
            json => renderModoSala(json.data.horarios, salaId)
        );
    }
});

function renderModoProfessor(horarios, profKey) {
    document.getElementById('stateLoading').style.display = 'none';

    const grid = document.getElementById('weekGrid');
    grid.innerHTML = ''; // Limpa o grid para evitar duplicações
    let totalAulas = 0;
    const turmasSet = new Set();
    let diasComAula = 0;

    const virtual = VIRTUAL_SCHEDULE[profKey] || {};

    DIAS.forEach((dia, diaIdx) => {
        const diaData = horarios[dia] || {};
        const diaVirtual = virtual[dia] || {};
        let aulasNoDia = 0;

        const card = document.createElement('div');
        card.className = `day-card${isDiaHoje(dia) ? ' today' : ''}`;
        card.appendChild(makeDayHeader(DIAS_PT[diaIdx]));

        const list = document.createElement('div');
        list.className = 'aulas-list';

        HORARIOS.forEach((hora, aulaIdx) => {
            const aula = diaData[aulaIdx];
            const vDesc = diaVirtual[aulaIdx];
            const livre = !aula && !vDesc;

            let info1 = '';
            let info2 = '';
            let abrev = '';
            let salaId = '';

            if (aula) {
                info1 = aula.turmaNome || aula.turmaId;
                info2 = ABREV_DISC[aula.abrev] || aula.abrev || '—';
                abrev = aula.abrev;
                salaId = aula.turmaId;
            } else if (vDesc) {
                info1 = 'ATIVIDADE';
                info2 = vDesc;
                abrev = 'reuniao'; // para cor cinza
            } else {
                info1 = 'Livre';
                info2 = '';
            }

            if (!livre) {
                if (aula) turmasSet.add(aula.turmaId);
                totalAulas++;
                aulasNoDia++;
            }

            list.appendChild(makeSlot(aulaIdx + 1, hora, info1, info2, livre, abrev, salaId));
        });

        if (aulasNoDia > 0) diasComAula++;
        card.appendChild(list);
        grid.appendChild(card);
    });

    setResume(totalAulas, turmasSet.size, diasComAula);
    // Adapta label do chip
    document.querySelector('#totalTurmas + .lbl').innerHTML = 'Turmas<br>atendidas';
}

const FALLBACK_DADOS = {
    "SEGUNDA": [["", "I", "OL", "", "", "", ""], ["", "", "EF", "I", "", "", ""], ["", "MK", "I", "", "", "", ""], ["", "", "", "", "", "A", "A"], ["EF", "EF", "", "", "", "", "I"], ["I", "A", "", "EF", "", "", ""], ["", "", "", "", "", "I", ""], ["A", "", "", "", "", "PEF", "EF"], ["", "", "", "", "", "", "DSE"], ["", "", "", "MK", "", "", ""], ["", "", "", "", "", "MK", ""], ["", "", "MK", "", "", "", ""], ["EF", "EF", "", "", "A", "", ""], ["", "", "", "", "I", "", ""], ["", "", "", "", "EF", "", ""], ["", "", "A", "A", "OL", "", ""]],
    "TERÇA": [["", "", "", "", "", "EF", "DSE"], ["", "", "MK", "", "", "", ""], ["", "", "", "EF", "", "", ""], ["EF", "EF", "", "", "", "", ""], ["", "", "", "", "", "", ""], ["", "", "", "", "", "DSE", "EF"], ["", "", "EF", "", "", "A", "A"], ["OL", "DSE", "I", "", "", "", ""], ["", "", "A", "A", "", "", ""], ["", "", "", "", "EF", "OL", "I"], ["", "", "", "", "", "I", "EF"], ["", "", "", "I", "", "", ""], ["", "", "", "MK", "I", "", ""], ["A", "A", "EF", "", "", "", ""], ["DSE", "I", "OL", "", "", "", ""], ["I", "EF", "DSE", "", "", "MK", ""]],
    "QUARTA": [["", "", "", "EF", "", "", ""], ["", "", "EF", "", "", "", ""], ["", "", "", "", "", "DSE", "OL"], ["", "", "", "", "OL", "I", "DSE"], ["", "", "A", "A", "EF", "MK", ""], ["", "", "", "", "A", "", ""], ["", "", "MK", "", "", "", ""], ["", "", "", "", "", "EF", "EF"], ["", "", "", "", "", "", "I"], ["", "", "", "", "", "", ""], ["A", "A", "", "OL", "", "", ""], ["", "", "", "", "DSE", "A", "A"], ["", "EF", "", "", "", "", ""], ["", "", "", "", "", "EF", "EF"], ["", "", "EF", "EF", "", "", ""], ["", "", "", "", "", "", ""]],
    "QUINTA": [["A", "A", "EF", "", "", "", ""], ["", "", "PAR", "A", "A", "DSE", "OL"], ["", "EF", "", "", "", "A", "A"], ["", "", "", "EF", "", "", ""], ["", "", "", "", "", "", ""], ["EF", "OL", "", "", "", "", ""], ["", "", "", "", "EF", "", ""], ["", "", "", "A", "", "", ""], ["", "", "", "MK", "OL", "EF", "EF"], ["A", "A", "EF", "EF", "", "", ""], ["", "", "DSE", "", "", "", ""], ["EF", "EF", "OL", "", "", "", ""], ["", "", "", "", "A", "OL", "DSE"], ["OL", "DSE", "MK", "", "", "", ""], ["", "MK", "", "", "", "A", "A"], ["", "", "", "", "", "", ""]],
    "SEXTA": [["", "", "", "", "", "MK", ""], ["", "", "EF", "", "", "", ""], ["", "", "", "EF", "", "", ""], ["", "", "MK", "", "", "", ""], ["", "", "", "", "", "DSE", "OL"], ["", "", "", "MK", "", "", ""], ["EF", "", "", "", "", "OL", "DSE"], ["", "MK", "", "", "", "", ""], ["", "EF", "", "", "", "", ""], ["", "DSE", "", "", "", "", ""], ["", "", "EF", "EF", "", "", ""], ["", "EF", "", "", "", "", ""], ["", "Lima", "", "", "", "", ""], ["", "", "Lima", "", "", "", ""], ["", "", "", "Lima", "", "", ""], ["", "", "", "", "Lima", "EF", "EF"]]
};
const SALAS_IDX = ['1A', '1B', '1C', '2A', '2B', '2C', '3A', '3B', '3C', '4A', '4B', '4C', '5A', '5B', '5C', '5D'];

// ── MODO SALA: mostra o que acontece em cada aula da turma ─────────────
// horarios[dia][aulaIdx] = abrev (string ou undefined)
function renderModoSala(horarios, salaId) {
    document.getElementById('stateLoading').style.display = 'none';

    // Normaliza salaId para busca no fallback (remove º, Ano, espaços)
    const normalizedSala = salaId.toUpperCase().replace(/º/g, '').replace(/ANO/g, '').replace(/\s/g, '');
    const sIdx = SALAS_IDX.indexOf(normalizedSala);

    DIAS.forEach(d => {
        // Se o dia não existe ou está vazio, usa o fallback
        const dayData = horarios[d];
        const hasData = Array.isArray(dayData) && dayData.some(a => a && a.trim() !== '');
        if (!hasData && sIdx >= 0) {
            horarios[d] = JSON.parse(JSON.stringify(FALLBACK_DADOS[d][sIdx]));
        }
    });

    const grid = document.getElementById('weekGrid');
    grid.innerHTML = ''; // Limpa o grid para evitar duplicações
    let totalEspecialistas = 0;
    let diasComEsp = 0;

    DIAS.forEach((dia, diaIdx) => {
        const diaData = horarios[dia] || {};
        let espNoDia = 0;

        const card = document.createElement('div');
        card.className = `day-card${isDiaHoje(dia) ? ' today' : ''}`;
        card.appendChild(makeDayHeader(DIAS_PT[diaIdx]));

        const list = document.createElement('div');
        list.className = 'aulas-list';

        HORARIOS.forEach((hora, aulaIdx) => {
            const rawAbrev = diaData[aulaIdx];
            const abrev = (rawAbrev && typeof rawAbrev === 'string') ? rawAbrev.trim() : '';
            const isPEB = !abrev || abrev.toUpperCase() === 'PEB1' || abrev.toUpperCase() === 'LIVRE';

            const info1 = isPEB ? 'PEB1' : (ABREV_DISC[abrev] || abrev);
            let info2 = isPEB ? 'Aula regular' : getNomeProfPorAbrev(abrev, salaId);

            // Adiciona a "Ação" do professor (H.A, ESTUDO, PARES) conforme imagem
            if (!isPEB) {
                const acao = getAcaoEspecialista(abrev, dia, aulaIdx);
                if (acao) info2 += ` — ${acao}`;
                totalEspecialistas++;
                espNoDia++;
            }

            list.appendChild(makeSlot(aulaIdx + 1, hora, info1, info2, isPEB, abrev, salaId));
        });

        if (espNoDia > 0) diasComEsp++;
        card.appendChild(list);
        grid.appendChild(card);
    });

    // Resumo adaptado para sala
    document.getElementById('totalAulas').textContent = totalEspecialistas;
    document.getElementById('totalDias').textContent = diasComEsp;
    document.getElementById('summaryBar').style.display = 'flex';
    grid.style.display = 'grid';

    // Ajusta labels
    const chips = document.querySelectorAll('.summary-chip .lbl');
    if (chips[0]) chips[0].innerHTML = 'Aulas com<br>especialista';
    if (chips[2]) chips[2].innerHTML = 'Dias com<br>especialista';
}

// ── Helpers de render ───────────────────────────────────────────────────
function makeDayHeader(label) {
    const h = document.createElement('div');
    h.className = 'day-header';
    h.textContent = label;
    return h;
}

function makeSlot(num, hora, linha1, linha2, livre, abrev, salaId) {
    const slot = document.createElement('div');
    let baseClass = livre ? 'livre' : 'ocupada';

    // Adiciona classe de cor baseada na abrev/sala
    const colorClass = getClassPorAbrev(abrev, salaId);
    if (colorClass) {
        baseClass += ' ' + colorClass;
    }

    slot.className = `aula-slot ${baseClass}`;

    const numEl = document.createElement('div');
    numEl.className = 'aula-num';
    numEl.textContent = num;

    const info = document.createElement('div');
    info.className = 'aula-info';

    const horaEl = document.createElement('div');
    horaEl.className = 'aula-hora';
    horaEl.textContent = hora;

    const l1 = document.createElement('div');
    l1.className = 'aula-turma';
    l1.textContent = linha1;

    const l2 = document.createElement('div');
    l2.className = 'aula-disc';
    l2.textContent = linha2;

    info.appendChild(horaEl);
    info.appendChild(l1);
    if (linha2) info.appendChild(l2);

    const dot = document.createElement('div');
    dot.className = `aula-dot ${livre ? 'livre' : 'ocupada'}`;

    slot.appendChild(numEl);
    slot.appendChild(info);
    slot.appendChild(dot);
    return slot;
}

function setResume(aulas, turmas, dias) {
    document.getElementById('totalAulas').textContent = aulas;
    document.getElementById('totalTurmas').textContent = turmas;
    document.getElementById('totalDias').textContent = dias;
    document.getElementById('summaryBar').style.display = 'flex';
    document.getElementById('weekGrid').style.display = 'grid';
}

function getNomeProfPorAbrev(abrev, salaId) {
    if (!abrev) return '';
    const u = abrev.toUpperCase();
    if (u === 'EF' || u.includes('ED. FÍS') || u.includes('ED. FIS')) return /^[123]/.test(salaId) ? 'Marjorie' : 'Marcos';
    if (u === 'I' || u.includes('INGL')) return 'Marcelo';
    if (u === 'A' || u.includes('ARTES')) return /^1/.test(salaId) ? 'Bianca' : 'Mirian';
    if (u === 'MK' || u.includes('MAKER')) return 'Sirlene';
    if (u === 'OL' || u.includes('LEITURA')) return 'Raquel Castelaneli';
    if (u === 'DSE' || u.includes('SEBRAE')) return 'Cherlane';
    if (u === 'Lima' || u.includes('PROERD') || u === 'LIMA') return 'Lima (PROERD)';
    if (u === 'PEF' || u.includes('REUNIÍO') || u.includes('REUNIAO')) return 'Reunião de Pares';
    if (u === 'PAR') return 'Reunião de Pares – Artes';
    return '';
}

function getClassPorAbrev(abrev, salaId) {
    if (!abrev) return '';
    const u = abrev.toUpperCase();
    if (u === 'EF' || u.includes('ED. FÍS') || u.includes('ED. FIS')) return /^[123]/.test(salaId) ? 'ef-marjorie' : 'ef-marcos';
    if (u === 'I' || u.includes('INGL')) return 'ingles';
    if (u === 'A' || u.includes('ARTES')) return /^1/.test(salaId) ? 'artes-bianca' : 'artes-mirian';
    if (u === 'MK' || u.includes('MAKER')) return 'maker';
    if (u === 'OL' || u.includes('LEITURA')) return 'leitura';
    if (u === 'DSE' || u.includes('SEBRAE') || u === 'DS') return 'sebrae';
    if (u === 'Lima' || u.includes('PROERD') || u === 'LIMA') return 'proerd';
    if (u === 'PEF' || u === 'PAR' || u.includes('REUNIÍO') || u.includes('REUNIAO')) return 'reuniao';
    return '';
}

function getAcaoEspecialista(abrev, dia, aulaIdx) {
    if (!abrev) return '';
    const d = dia.toUpperCase();
    const u = abrev.toUpperCase();

    // Lógica baseada na foto fornecida pelo usuário
    if (d === 'SEGUNDA' && aulaIdx === 2) return 'PARES';
    if (d === 'SEGUNDA' && aulaIdx === 3) return 'ESTUDO';
    if (d === 'QUARTA' && aulaIdx === 2) return 'ESTUDO';
    if (d === 'QUINTA') return 'H.A.';
    if (d === 'SEXTA' && aulaIdx === 3) return 'H.A.';

    // Reunião de pares específica
    if (u === 'PEF' || u === 'PAR') return 'PARES';

    return '';
}

function showError(msg) {
    document.getElementById('stateLoading').style.display = 'none';
    document.getElementById('errorMsg').textContent = msg;
    document.getElementById('stateError').style.display = 'block';
}
