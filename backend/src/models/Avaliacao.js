const mongoose = require('mongoose');

const AvaliacaoSchema = new mongoose.Schema(
    {
        _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
        escolaId: { type: String, index: true }, // Multi-escola: tenant isolation
        id: { type: mongoose.Schema.Types.Mixed, index: true },
        titulo: { type: String, required: true, trim: true },
        descricao: { type: String, default: '', trim: true },
        turmaId: { type: String, required: true, index: true }, // canônico: "1A"
        turmaNome: { type: String, default: '' }, // exibição: "1ºA"
        serie: { type: Number, min: 1, index: true }, // ano/série da turma: 1 = 1º Ano
        materiaId: { type: String, required: true, index: true },
        materiaNome: { type: String, default: '' },
        professorId: { type: String, index: true }, // Usuario._id do professor responsável
        professorNome: { type: String, default: '' },
        bimestre: { type: Number, required: true, min: 1, max: 4, index: true },
        tipo: { type: String, default: 'Prova', trim: true }, // Prova, Trabalho, Seminário, Redação, etc.
        peso: { type: Number, default: 1, min: 0.1 },
        // Pontuação máxima da avaliação, na escala 0–10 do sistema. Documentos
        // anteriores ao campo não o têm e valem 10 (ver AvaliacaoController).
        valor: { type: Number, default: 10, min: 0.1, max: 10 },
        data: { type: Date, default: Date.now },
        dataEntrega: { type: Date, default: null }, // prazo de entrega, quando houver
        criadoPor: { type: String }, // Usuario._id de quem criou
        criadoPorNome: { type: String, default: '' },
        criadoPorPerfil: { type: String, default: '' },
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
