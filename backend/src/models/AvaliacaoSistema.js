const mongoose = require('mongoose');

const AvaliacaoSistemaSchema = new mongoose.Schema({
    usuarioId: {
        type: String,
        ref: 'Usuario',
        required: true,
    },
    nome: {
        type: String,
        required: true,
    },
    perfil: {
        type: String,
        required: true,
        enum: ['admin', 'diretor', 'professor', 'responsavel'],
    },
    estrelas: {
        type: Number,
        required: true,
        min: 1,
        max: 5,
    },
    texto: {
        type: String,
        required: true,
        maxlength: 1000,
    },
    ativo: {
        type: Boolean,
        default: true,
    },
    foto: {
        type: String,
        default: '',
    },
    dataCriacao: {
        type: Date,
        default: Date.now,
    },
    // Adesão e moderação (Issue #489): a avaliação só vai para a página
    // inicial se a pessoa escolheu aparecer E a administração aprovou.
    // Documento antigo, sem estes campos, não entra no filtro — fica fora.
    exibirPublicamente: { type: Boolean, default: false },
    moderacao: {
        type: String,
        enum: ['pendente', 'aprovada', 'recusada'],
        default: 'pendente',
        index: true,
    },
    moderadoPor: { type: String },
    moderadoEm: { type: Date },
});

module.exports =
    mongoose.models.AvaliacaoSistema ||
    mongoose.model('AvaliacaoSistema', AvaliacaoSistemaSchema, 'avaliacoes_sistema');
