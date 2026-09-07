const mongoose = require('mongoose');

const FrequenciaProfessorSchema = new mongoose.Schema(
    {
        // Multi-escola: discriminador de tenant (_id de Escola). Sem ele este
        // documento pertence a todo mundo e a ninguém — as consultas escopadas
        // por escola simplesmente não o encontram, e com `strict: true` o valor
        // que o controller tenta gravar é descartado em silêncio.
        escolaId: { type: String, index: true },
        data: { type: Date, required: true, default: Date.now },
        professorId: { type: String, required: false },
        nomeProfessor: { type: String, required: true },
        disciplina: { type: String, required: true },
        escola: { type: String, required: true },
        classe: { type: String, required: true }, // Escolhido manualmente
        quantidadeAulas: { type: Number, required: true, default: 1 }, // Escolhido manualmente
        observacao: { type: String }, // Opcional
    },
    {
        collection: 'frequencia_professores',
        timestamps: true,
    }
);

module.exports = mongoose.model('FrequenciaProfessor', FrequenciaProfessorSchema);
