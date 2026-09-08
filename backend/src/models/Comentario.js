const mongoose = require('mongoose');

const ComentarioSchema = new mongoose.Schema({
    // Multi-escola: discriminador de tenant (_id de Escola). Sem ele este
    // documento pertence a todo mundo e a ninguém — as consultas escopadas
    // por escola simplesmente não o encontram, e com `strict: true` o valor
    // que o controller tenta gravar é descartado em silêncio.
    escolaId: { type: String, index: true },
    comunicadoId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comunicado',
        required: false,
        index: true,
    },
    notificacaoId: { type: String, required: false, index: true },
    usuarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Usuario', required: true },
    usuarioNome: { type: String, required: true },
    usuarioFoto: { type: String },
    usuarioPerfil: { type: String }, // 'responsavel', 'professor', etc.

    texto: { type: String, required: false }, // Pode ser vazio se for apenas áudio
    audioUrl: { type: String }, // ID do arquivo GridFS ou URL

    // Suporte para respostas (nested comments)
    parentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comentario',
        default: null,
        index: true,
    },

    dataCriacao: { type: Date, default: Date.now },
    dataAtualizacao: { type: Date, default: Date.now },
    ativo: { type: Boolean, default: true },
});

module.exports = mongoose.model('Comentario', ComentarioSchema);
