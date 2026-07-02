const mongoose = require('mongoose');

const DocumentoEmitidoSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },

    alunoId: { type: String, required: true, ref: 'Aluno', index: true },
    alunoNome: { type: String, required: true }, // Cache para listagem rápida

    tipo: {
        type: String,
        required: true,
        enum: [
            'declaracao_matricula',
            'declaracao_frequencia',
            'historico_escolar',
            'transferencia',
            'outro'
        ],
        index: true
    },

    // Dados do documento gerado
    titulo: { type: String, required: true },
    descricao: String,
    numeroDocumento: { type: String, unique: true }, // Ex: "DOC-2025-000123"
    anoLetivo: Number,

    // Arquivo PDF gerado
    arquivo: {
        nome: String,       // Nome do arquivo
        gridfsId: String,   // ID no GridFS (para PDFs grandes)
        base64: String,     // PDF em base64 (para documentos pequenos)
        tamanho: Number,    // Tamanho em bytes
        mimeType: { type: String, default: 'application/pdf' }
    },

    // Quem emitiu
    emitidoPor: { type: String, ref: 'Usuario', required: true },
    emitidoPorNome: String,

    // Controle
    status: {
        type: String,
        enum: ['gerado', 'entregue', 'cancelado'],
        default: 'gerado'
    },
    dataEntrega: Date,
    observacoes: String
}, {
    timestamps: true,
    strict: true,
    collection: 'documentos_emitidos'
});

// Índices para consultas frequentes
DocumentoEmitidoSchema.index({ alunoId: 1, tipo: 1 });
DocumentoEmitidoSchema.index({ emitidoPor: 1.0 });
DocumentoEmitidoSchema.index({ createdAt: -1 });

module.exports = mongoose.model('DocumentoEmitido', DocumentoEmitidoSchema);
