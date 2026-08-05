const mongoose = require('mongoose');

const RecuperacaoSenhaSchema = new mongoose.Schema({
    usuarioId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Usuario',
        required: true
    },
    codigo: {
        type: String,
        required: true
    },
    criadoEm: {
        type: Date,
        default: Date.now,
        required: true
    },
    expiraEm: {
        type: Date,
        required: true
    },
    status: {
        type: String,
        enum: ['ativo', 'utilizado', 'expirado'],
        default: 'ativo',
        required: true
    },
    tentativas: {
        type: Number,
        default: 0
    }
}, { collection: 'recuperacoes_senha', timestamps: true });

RecuperacaoSenhaSchema.index({ criadoEm: 1 });
RecuperacaoSenhaSchema.index({ usuarioId: 1, status: 1 });

module.exports = mongoose.model('RecuperacaoSenha', RecuperacaoSenhaSchema);
