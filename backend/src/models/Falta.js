const mongoose = require('mongoose');

const FaltaSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    escolaId: { type: String, index: true }, // Multi-escola: discriminador de tenant
    aluno: { type: mongoose.Schema.Types.Mixed, ref: 'Aluno', index: true }, // ID ou ref
    matriculaId: { type: String, index: true }, // Vínculo com a matrícula
    turma: { type: String, index: true },
    data: Date,
    materia: String, // "Sala Principal", "Matemática", etc.

    presente: Boolean,
    justificada: Boolean,
    motivo: String
}, {
    timestamps: true,
    strict: true,
    collection: 'faltas'
});

// Índices para relatórios de frequência
FaltaSchema.index({ turma: 1, data: 1 });
FaltaSchema.index({ aluno: 1, data: 1 });

module.exports = mongoose.model('Falta', FaltaSchema);
