/**
 * TabelaGeral — Modelo MongoDB
 * Cada documento representa UMA CÉLULA da grade de horários:
 *   turmaId + dia + aulaIdx  →  única combinação (índice único)
 *
 * aulaIdx  Horário           Nº aula
 *    0     7h30–8h20         1ª
 *    1     8h20–9h10         2ª
 *    2     9h30–10h20        3ª  (após intervalo)
 *    3     10h20–11h10       4ª
 *    4     11h10–12h         5ª
 *    5     13h–13h50         6ª  (após almoço)
 *    6     13h50–14h40       7ª
 */

const mongoose = require('mongoose');

const HORARIO_LABELS = [
    '7h30–8h20',
    '8h20–9h10',
    '9h30–10h20',
    '10h20–11h10',
    '11h10–12h',
    '13h–13h50',
    '13h50–14h40'
];

const DIAS_VALIDOS = ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA'];

const TabelaGeralSchema = new mongoose.Schema({
    turmaId: {
        type: String,
        required: true,
        trim: true
        // Ex: '1A', '2B', '3C', '4A', '5D'
    },
    turmaNome: {
        type: String,
        required: true,
        trim: true
        // Ex: '1ºA', '2ºB'
    },
    dia: {
        type: String,
        required: true,
        enum: DIAS_VALIDOS
    },
    aulaIdx: {
        type: Number,
        required: true,
        min: 0,
        max: 6
        // 0=1ª aula ... 6=7ª aula
    },
    horarioLabel: {
        type: String,
        required: true
        // Ex: '7h30–8h20'
    },
    abrev: {
        type: String,
        default: ''
        // 'EF', 'I', 'A', 'MK', 'OL', 'DSE', 'Lima', 'PEF', 'PAR', ''
    },
    professorKey: {
        type: String,
        default: ''
        // 'MARJORIE', 'MARCOS', 'INGLS', 'ARTES1ANO', 'MIRIAM',
        // 'OFMAKER', 'OFLEITURA', 'OFSEBRAE', 'LIMA', ''
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    collection: 'tabela_geral',
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// ── Índice único: uma célula por combinação turma+dia+aula ──────────────────
TabelaGeralSchema.index({ turmaId: 1, dia: 1, aulaIdx: 1 }, { unique: true });

// ── Índice para detecção de conflito de professor ───────────────────────────
TabelaGeralSchema.index({ professorKey: 1, dia: 1, aulaIdx: 1 });

// ── Helpers estáticos ───────────────────────────────────────────────────────
TabelaGeralSchema.statics.HORARIO_LABELS = HORARIO_LABELS;
TabelaGeralSchema.statics.DIAS_VALIDOS   = DIAS_VALIDOS;

/**
 * Mapeia abreviação + turmaId para a chave do professor.
 * Regra: a mesma que o frontend usa em getCorPelaAbrev / getColorClass.
 */
TabelaGeralSchema.statics.getProfessorKey = function (abrev, turmaId) {
    if (!abrev) return '';
    const u = abrev.toUpperCase();

    if (u === 'EF') {
        if (/^[123]/.test(turmaId)) return 'MARJORIE';
        if (/^[45]/.test(turmaId))  return 'MARCOS';
        return 'MARJORIE';
    }
    if (u === 'I')   return 'INGLS';
    if (u === 'A') {
        if (/^1/.test(turmaId)) return 'ARTES1ANO';
        return 'MIRIAN';
    }
    if (u === 'MK')  return 'OFMAKER';
    if (u === 'OL')  return 'OFLEITURA';
    if (u === 'DSE') return 'OFSEBRAE';
    if (u === 'Lima' || u === 'LIMA') return 'LIMA';

    // PEF e PAR são reuniões de pares — não geram conflito
    if (u === 'PEF') return 'EF_PARES';
    if (u === 'PAR') return 'ARTES_PARES';

    return ''; // PEB1 ou vazio
};

/**
 * Mapa inverso: professorKey → nome legível para exibição no modal de conflito.
 */
TabelaGeralSchema.statics.PROFESSOR_NOME = {
    MARJORIE:   'Marjorie (Ed. Física)',
    MARCOS:     'Marcos (Ed. Física)',
    INGLS:      'Marcelo (Inglês)',
    ARTES1ANO:  'Bianca (Artes 1º Ano)',
    MIRIAN:     'Mirian (Artes)',
    OFMAKER:    'Sirlene (Of. Maker)',
    OFLEITURA:  'Raquel Castelaneli (Of. Leitura)',
    OFSEBRAE:   'Cherlane (Of. Sebrae/DSE)',
    LIMA:       'Lima (PROERD)',
    EF_PARES:   'Reunião de Pares – Ed. Física',
    ARTES_PARES:'Reunião de Pares – Artes'
};

module.exports = mongoose.model('TabelaGeral', TabelaGeralSchema);
