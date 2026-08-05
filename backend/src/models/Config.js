const mongoose = require('mongoose');

const ConfigSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    escolaNome: String,
    anoLetivo: Number,
    materias: [{
        id: String,
        nome: String,
        icone: String,
        cor: String
    }],
    tiposAvaliacao: [{
        id: String,
        nome: String,
        peso: Number
    }],
    bimestres: [{
        numero: Number,
        inicio: String, // ou Date
        fim: String // ou Date
    }],
    mediaAprovacao: Number,
    frequenciaMinima: Number,
    exigirChamadaAntesDeAula: { type: Boolean, default: false },
    alfabetizacaoNiveis: [{
        id: String,
        nome: String,
        cor: String,
        descricao: String
    }]
}, {
    timestamps: true,
    strict: true,
    collection: 'config' // Força nome singular para coincidir com 'config' do JSON se quiser, ou 'configs' padrão mongo
});

module.exports = mongoose.model('Config', ConfigSchema);
