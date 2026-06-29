const mongoose = require('mongoose');

const MatriculaSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    id: { type: mongoose.Schema.Types.Mixed, index: true }, // Optional auto-increment ID if needed

    alunoId: { type: String, required: true, ref: 'Aluno', index: true }, // Referencia ao Aluno
    turmaId: { type: String, required: true, ref: 'Turma', index: true }, // Referencia a Turma

    anoLetivo: { type: Number, required: true, index: true }, // Ex: 2024, 2025
    matriculaNumero: { type: String, unique: true }, // Ex: "2024001" (antigo campo matricula do aluno)

    status: {
        type: String,
        enum: ['cursando', 'aprovado', 'reprovado', 'aprovado_conselho', 'transferido', 'evadido'],
        default: 'cursando'
    },

    numeroChamada: Number,
    dataMatricula: { type: Date, default: Date.now },

    observacoes: String
}, {
    timestamps: true,
    collection: 'matriculas'
});

// Indice composto para garantir que um aluno só tenha uma matrícula ativa por ano (opcional, dependendo da regra de negócio)
MatriculaSchema.index({ alunoId: 1, anoLetivo: 1 }, { unique: true });

module.exports = mongoose.model('Matricula', MatriculaSchema);
