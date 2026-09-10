const mongoose = require('mongoose');

const AvaliacaoSchema = new mongoose.Schema(
    {
        _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
        escolaId: { type: String, index: true }, // Multi-escola: tenant isolation
        id: { type: mongoose.Schema.Types.Mixed, index: true },
        titulo: { type: String, required: true, trim: true },
        descricao: { type: String, default: '', trim: true },
        turmaId: { type: String, required: true, index: true },
        materiaId: { type: String, required: true, index: true },
        professorId: { type: String, index: true },
        professorNome: { type: String, default: '' },
        bimestre: { type: Number, required: true, min: 1, max: 4, index: true },
        tipo: { type: String, default: 'Prova', trim: true }, // Prova, Trabalho, Seminário, Redação, etc.
        peso: { type: Number, default: 1, min: 0.1 },
        data: { type: Date, default: Date.now },
        criadoPor: { type: String },
        atualizadoPor: { type: String },
    },
    {
        timestamps: true,
        strict: true,
        collection: 'avaliacoes',
    }
);

// Índices compostos para consultas eficientes
AvaliacaoSchema.index({ escolaId: 1, turmaId: 1, bimestre: 1 });
AvaliacaoSchema.index({ escolaId: 1, materiaId: 1 });
AvaliacaoSchema.index({ escolaId: 1, professorId: 1 });

module.exports = mongoose.models.Avaliacao || mongoose.model('Avaliacao', AvaliacaoSchema);
