const mongoose = require('mongoose');

const CalendarioEscolarSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },

    titulo: { type: String, required: true },
    descricao: String,

    // Multi-escola: isolamento por tenant (_id de Escola)
    escolaId: { type: String, index: true },

    dataInicio: { type: Date, required: true },
    dataFim: { type: Date, required: true },

    tipo: {
        type: String,
        required: true,
        enum: [
            'aula',              // Dia letivo normal
            'feriado',           // Feriado (sem aula)
            'recesso',           // Recesso escolar
            'reuniao_pais',      // Reunião de pais
            'conselho_classe',   // Conselho de classe
            'prova',             // Período de avaliações
            'evento',            // Eventos escolares
            'formacao',          // Formação de professores
            'matricula',         // Período de matrícula
            'outro'
        ],
        index: true
    },

    anoLetivo: { type: Number, required: true, index: true },

    // Se aplica a turmas específicas ou à escola toda
    abrangencia: {
        type: String,
        enum: ['escola', 'turma'],
        default: 'escola'
    },
    turmasIds: [{ type: String, ref: 'Turma' }], // Só quando abrangencia = 'turma'

    cor: { type: String, default: '#4A90D9' }, // Cor para exibição no calendário

    criadoPor: { type: String, ref: 'Usuario', required: true },
    criadoPorNome: String,

    ativo: { type: Boolean, default: true }
}, {
    timestamps: true,
    strict: true,
    collection: 'calendario_escolar'
});

// Índices para consultas de calendário
CalendarioEscolarSchema.index({ anoLetivo: 1, tipo: 1 });
CalendarioEscolarSchema.index({ dataInicio: 1, dataFim: 1 });

module.exports = mongoose.model('CalendarioEscolar', CalendarioEscolarSchema);
