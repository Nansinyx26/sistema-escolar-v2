const mongoose = require('mongoose');

/**
 * ChatMensagem — persiste cada par pergunta/resposta do chatbot IA.
 * Indexado por usuário para histórico eficiente.
 */
const ChatMensagemSchema = new mongoose.Schema(
    {
        // Multi-escola: discriminador de tenant (_id de Escola). Sem ele este
        // documento pertence a todo mundo e a ninguém — as consultas escopadas
        // por escola simplesmente não o encontram, e com `strict: true` o valor
        // que o controller tenta gravar é descartado em silêncio.
        escolaId: { type: String, index: true },
        usuarioId: { type: String, required: true, index: true },
        usuarioPerfil: {
            type: String,
            required: true,
            enum: ['admin', 'diretor', 'professor', 'responsavel'],
        },
        usuarioNome: { type: String },
        alunoId: { type: String, default: null }, // contexto do aluno, se enviado
        pergunta: { type: String, required: true },
        resposta: { type: String, required: true },
        criadoEm: { type: Date, default: Date.now },
    },
    {
        collection: 'chat_mensagens',
        timestamps: false,
    }
);

// TTL: mantém histórico por 180 dias para não inflar o banco
ChatMensagemSchema.index({ criadoEm: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

module.exports = mongoose.model('ChatMensagem', ChatMensagemSchema);
