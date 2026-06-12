const mongoose = require('mongoose');

const FrequenciaProfessorSchema = new mongoose.Schema({
    data: { type: Date, required: true, default: Date.now },
    professorId: { type: String, required: false },
    nomeProfessor: { type: String, required: true },
    disciplina: { type: String, required: true },
    escola: { type: String, required: true },
    classe: { type: String, required: true }, // Escolhido manualmente
    quantidadeAulas: { type: Number, required: true, default: 1 }, // Escolhido manualmente
    observacao: { type: String } // Opcional
}, {
    collection: 'frequencia_professores',
    timestamps: true
});

module.exports = mongoose.model('FrequenciaProfessor', FrequenciaProfessorSchema);
