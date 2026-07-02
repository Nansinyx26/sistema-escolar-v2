const mongoose = require('mongoose');

const MessageReactionSchema = new mongoose.Schema({
    messageId: { type: String, required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
    senderType: { type: String, enum: ['responsavel', 'professor', 'diretor', 'admin'], required: true },
    senderName: { type: String, required: true },
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
