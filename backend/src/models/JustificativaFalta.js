const mongoose = require('mongoose');

const JustificativaFaltaSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },

    alunoId: { type: String, required: true, ref: 'Aluno', index: true },
    alunoNome: { type: String, required: true },

    // Período da ausência
    dataInicio: { type: Date, required: true },
    dataFim: { type: Date, required: true },

    motivo: { type: String, required: true },
    categoria: {
        type: String,
        enum: ['saude', 'familiar', 'judicial', 'religioso', 'outro'],
        default: 'outro'
    },

    // Documento comprobatório (atestado médico, etc.)
    documentoAnexo: {
        nome: String,
        gridfsId: String,
        base64: String,
        mimeType: String
    },

    // Quem enviou a justificativa (responsável ou secretaria)
    enviadoPor: { type: String, ref: 'Usuario' },
    enviadoPorNome: String,
    origemEnvio: {
        type: String,
        enum: ['portal_responsavel', 'secretaria', 'presencial'],
        default: 'secretaria'
    },

    // Análise da secretaria
    status: {
        type: String,
        enum: ['pendente', 'aprovada', 'rejeitada'],
        default: 'pendente',
        index: true
    },
    analisadoPor: { type: String, ref: 'Usuario' },
    analisadoPorNome: String,
    dataAnalise: Date,
    motivoRejeicao: String,

    observacoes: String
}, {
    timestamps: true,
    strict: true,
    collection: 'justificativas_faltas'
});

// Índices para consultas frequentes
JustificativaFaltaSchema.index({ alunoId: 1, dataInicio: 1 });
JustificativaFaltaSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('JustificativaFalta', JustificativaFaltaSchema);
