const mongoose = require('mongoose');

const AtribuicaoProfessorSchema = new mongoose.Schema({
    nome: {
        type: String,
        required: true
    },
    classe: String,
    pontuacao: Number,
    serieTurma: String,
    ha: Number,
    rp: Number,
    estudoL: Number,
    estudoEsc: Number,
    cargaHoraria: String,
    observacoes: String,
}, {
    timestamps: true,
    collection: 'atribuicoes_professores'
});

module.exports = mongoose.model('AtribuicaoProfessor', AtribuicaoProfessorSchema);
