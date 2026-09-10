const mongoose = require('mongoose');

const NotaSchema = new mongoose.Schema(
    {
        _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
        escolaId: { type: String, index: true }, // Multi-escola: discriminador de tenant
        id: { type: mongoose.Schema.Types.Mixed, index: true },
        alunoId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
        matriculaId: { type: String, index: true }, // Vínculo com a matrícula específica (Opcional por enquanto, para compatibilidade)
        avaliacaoId: { type: String, index: true }, // Referência opcional à Avaliação estruturada
        turmaId: String,
        materiaId: String,
        bimestre: Number,
        tipo: String, // prova, trabalho
        nota: Number, // ou String
        presente: { type: Boolean, default: true },
        observacoes: { type: String, default: '' },
        status: { type: String, default: 'Aprovado' }, // Aprovado, Recuperação, Reprovado
        descricao: String,
        data: Date,
        criadoPor: String,
        atualizadoPor: String,
    },
    {
        timestamps: true,
        strict: true,
        collection: 'notas',
    }
);

// Índice composto para buscar notas de um aluno específico em um bimestre/matéria rapidamente
NotaSchema.index({ alunoId: 1, bimestre: 1, materiaId: 1 });
NotaSchema.index({ turmaId: 1, bimestre: 1 }); // Para relatórios de turma
NotaSchema.index({ avaliacaoId: 1 });

module.exports = mongoose.models.Nota || mongoose.model('Nota', NotaSchema);
