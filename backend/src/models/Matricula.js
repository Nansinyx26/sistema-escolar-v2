const mongoose = require('mongoose');

const MatriculaSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    id: { type: mongoose.Schema.Types.Mixed, index: true }, // Optional auto-increment ID if needed

    alunoId: { type: String, required: true, ref: 'Aluno', index: true }, // Referencia ao Aluno
    turmaId: { type: String, required: true, ref: 'Turma', index: true }, // Referencia a Turma

    // Multi-escola: isolamento por tenant (_id de Escola)
    escolaId: { type: String, index: true },

    anoLetivo: { type: Number, required: true, index: true }, // Ex: 2024, 2025
    matriculaNumero: { type: String, unique: true }, // Ex: "2024001" (antigo campo matricula do aluno)

    status: {
        type: String,
        enum: ['cursando', 'aprovado', 'reprovado', 'aprovado_conselho', 'transferido', 'evadido'],
        default: 'cursando'
    },

    numeroChamada: Number,
    dataMatricula: { type: Date, default: Date.now },

    // Campos de saída (transferência, evasão, etc.)
    dataSaida: { type: Date, default: null },
    motivoSaida: { type: String, default: null }, // Ex: "Transferência para outra escola", "Evasão"

    // Auditoria: quem criou/alterou a matrícula
    criadoPor: { type: String, ref: 'Usuario', default: null }, // ID do usuário que criou (secretaria, admin)

    observacoes: String
}, {
    timestamps: true,
    collection: 'matriculas'
});

// Indice composto para garantir que um aluno só tenha uma matrícula ativa por ano (opcional, dependendo da regra de negócio)
MatriculaSchema.index({ alunoId: 1, anoLetivo: 1 }, { unique: true });

module.exports = mongoose.model('Matricula', MatriculaSchema);
