const mongoose = require('mongoose');

const ChatDiretoSchema = new mongoose.Schema({
    remetenteId: { type: String, required: true, index: true },
    destinatarioId: { type: String, required: true, index: true },
    // Multi-escola: isolamento por tenant (_id de Escola)
    escolaId: { type: String, index: true },
    turmaId: String,
    alunoId: String,
    contexto: {
        tipo: { type: String, enum: ['FALTA', 'NOTA', 'PEDAGOGICO', 'GERAL'], default: 'GERAL' },
        referenciaId: String // ID da falta ou nota relacionada
    },
    mensagem: { type: String, default: '' },
    anexo: {
        url: String,
        nome: String,
        tipo: String,
        tamanho: Number,
        gridfsId: String,
        miniatura: String
    },
    audio: {
        url: String,
        duracao: Number,
        gridfsId: String
    },
    editada: { type: Boolean, default: false },
    editadaEm: Date,
    encaminhada: { type: Boolean, default: false },
    apagadaParaTodos: { type: Boolean, default: false },
    apagadaPara: [{ type: String }],
    respostaParaId: { type: String },
    reacoes: [{
        usuarioId: String,
        usuarioNome: String,
        emoji: String,
        criadoEm: { type: Date, default: Date.now }
    }],
    status: { type: String, enum: ['enviada', 'entregue', 'lida'], default: 'enviada' },
    lida: { type: Boolean, default: false },
    dataEnvio: { type: Date, default: Date.now }
}, {
    timestamps: true,
    collection: 'chat_direto'
});

// Índice para listar conversas entre dois usuários
ChatDiretoSchema.index({ remetenteId: 1, destinatarioId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatDireto', ChatDiretoSchema);
