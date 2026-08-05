const mongoose = require('mongoose');

const MessageReactionSchema = new mongoose.Schema({
    messageId: { type: String, required: true, index: true },
    // Usuario._id é String neste projeto — usar ObjectId aqui fazia o cast
    // divergir e a reação não persistir de forma consistente. String casa 1:1.
    senderId: { type: String, required: true, index: true },
    // Sem enum: secretaria/coordenador/aluno também reagem (o enum antigo
    // rejeitava esses perfis com erro de validação).
    senderType: { type: String, required: true },
    senderName: { type: String, required: true },
    escolaId: { type: String, index: true }, // isolamento multi-tenant
    parentId: { type: String },
    parentName: { type: String },
    studentName: { type: String },
    emoji: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

// Apenas 1 reação por usuário por mensagem
MessageReactionSchema.index({ messageId: 1, senderId: 1 }, { unique: true });

module.exports = mongoose.model('MessageReaction', MessageReactionSchema, 'messageReactions');
