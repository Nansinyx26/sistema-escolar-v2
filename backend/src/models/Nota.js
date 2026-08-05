const mongoose = require('mongoose');

const NotaSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    escolaId: { type: String, index: true }, // Multi-escola: discriminador de tenant
    id: { type: mongoose.Schema.Types.Mixed, index: true },
    alunoId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
    matriculaId: { type: String, index: true }, // Vínculo com a matrícula específica (Opcional por enquanto, para compatibilidade)
    turmaId: String,
    materiaId: String,
    bimestre: Number,
    tipo: String, // prova, trabalho
    nota: Number, // ou String
    descricao: String,
    data: Date
}, {
    timestamps: true,
    strict: true,
    collection: 'notas'
});

// Índice composto para buscar notas de um aluno específico em um bimestre/matéria rapidamente
NotaSchema.index({ alunoId: 1, bimestre: 1, materiaId: 1 });
NotaSchema.index({ turmaId: 1, bimestre: 1 }); // Para relatórios de turma

module.exports = mongoose.models.Nota || mongoose.model('Nota', NotaSchema);
