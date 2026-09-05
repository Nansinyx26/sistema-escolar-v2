const mongoose = require('mongoose');

const AtribuicaoProfessorSchema = new mongoose.Schema(
    {
        // Multi-escola: discriminador de tenant (_id de Escola). Sem ele este
        // documento pertence a todo mundo e a ninguém — some das consultas
        // escopadas por escola, e o `deleteMany` da sincronização não tem o que
        // comparar para poupar as demais unidades.
        escolaId: { type: String, index: true },
        nome: {
            type: String,
            required: true,
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
    },
    {
        timestamps: true,
        collection: 'atribuicoes_professores',
    }
);

module.exports = mongoose.model('AtribuicaoProfessor', AtribuicaoProfessorSchema);
