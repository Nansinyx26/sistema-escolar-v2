const mongoose = require('mongoose');

/**
 * FaltaFuncionario — a "Planilha de Faltas FUNCIONÁRIOS" (controle de RH).
 *
 * Um documento por funcionário/mês. As colunas da planilha impressa viram
 * campos do dia: ABONADAS, ATESTADO, DESCONTO HORAS, T.R.E., (IN)JUSTIFICADAS
 * e OBSERVAÇÕES. A coluna CALENDÁRIO não é gravada — ela é derivada da data
 * (fim de semana) e do CalendarioEscolar da escola, então feriado remarcado
 * pela direção se reflete na planilha sem precisar reescrever registro.
 *
 * `dias` é ESPARSO: só entram os dias com alguma marcação. Mês sem nenhuma
 * falta é um documento com `dias: []` (ou nem existe).
 */
const DiaFaltaSchema = new mongoose.Schema({
    dia: { type: Number, required: true, min: 1, max: 31 },
    abonadas: { type: Boolean, default: false },
    atestado: { type: Boolean, default: false },
    descontoHoras: { type: Number, default: 0, min: 0, max: 24 },
    tre: { type: Boolean, default: false },          // T.R.E. — Tempo de Reposição/Estudo
    injustificadas: { type: Boolean, default: false }, // (IN) JUSTIFICADAS
    observacoes: { type: String, default: '', maxlength: 300 }
}, { _id: false });

const FaltaFuncionarioSchema = new mongoose.Schema({
    // Multi-escola: isolamento por tenant (_id de Escola) — ver filtrarPorEscola
    escolaId: { type: String, index: true },

    funcionarioId: { type: String, required: true, index: true }, // Usuario._id
    funcionarioNome: { type: String, required: true },
    funcionarioEmail: { type: String },
    cargo: {
        type: String,
        enum: ['professor', 'diretor', 'secretaria', 'admin'],
        default: 'professor'
    },

    ano: { type: Number, required: true },
    mes: { type: Number, required: true, min: 1, max: 12 },

    dias: { type: [DiaFaltaSchema], default: [] },

    // Quem fez o último lançamento (o próprio funcionário ou a gestão)
    atualizadoPor: String,
    atualizadoPorNome: String
}, {
    timestamps: true,
    strict: true,
    collection: 'faltas_funcionarios'
});

// Uma planilha por funcionário/mês DENTRO da escola. Sem escolaId no índice,
// o mesmo funcionário atuando em duas escolas colidiria no mesmo documento.
FaltaFuncionarioSchema.index(
    { escolaId: 1, funcionarioId: 1, ano: 1, mes: 1 },
    { unique: true }
);
// Consulta da direção: "todos os funcionários no mês X"
FaltaFuncionarioSchema.index({ escolaId: 1, ano: 1, mes: 1 });

module.exports = mongoose.model('FaltaFuncionario', FaltaFuncionarioSchema);
