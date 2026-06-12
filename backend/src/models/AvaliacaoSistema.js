const mongoose = require('mongoose');

const AvaliacaoSistemaSchema = new mongoose.Schema({
    usuarioId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Usuario',
        required: true
    },
    nome: {
        type: String,
        required: true
    },
    perfil: {
        type: String,
        required: true,
        enum: ['admin', 'diretor', 'professor', 'responsavel']
    },
    estrelas: {
        type: Number,
        required: true,
        min: 1,
        max: 5
    },
    texto: {
        type: String,
        required: true,
        maxlength: 1000
    },
    ativo: {
        type: Boolean,
        default: true
    },
    foto: {
        type: String,
        default: ""
    },
    dataCriacao: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('AvaliacaoSistema', AvaliacaoSistemaSchema, 'avaliacoes_sistema');
