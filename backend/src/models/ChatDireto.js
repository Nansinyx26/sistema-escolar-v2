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
    mensagem: { type: String, required: true },
    lida: { type: Boolean, default: false },
    dataEnvio: { type: Date, default: Date.now }
}, {
    timestamps: true,
    collection: 'chat_direto'
});

// Índice para listar conversas entre dois usuários
ChatDiretoSchema.index({ remetenteId: 1, destinatarioId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatDireto', ChatDiretoSchema);
