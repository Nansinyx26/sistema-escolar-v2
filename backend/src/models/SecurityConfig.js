const mongoose = require('mongoose');

const SecurityConfigSchema = new mongoose.Schema({
    chave: {
        type: String,
        default: 'CONFIG_GERAL',
        unique: true
    },
    codigoSecretoEscola: {
        type: String,
        required: true
    },
    dataUltimaRotacao: {
        type: Date,
        default: Date.now
    },
    rotacaoAutomatica: {
        type: Boolean,
        default: true
    },
    historicoCodigos: [{
        codigo: String,
        data: Date
    }],
    tentativasInvalidas: [{
        ip: String,
        data: Date,
        acao: String
    }]
}, { collection: 'security_configs' });

module.exports = mongoose.model('SecurityConfig', SecurityConfigSchema);
