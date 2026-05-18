const mongoose = require('mongoose');

const ProfessorSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    id: { type: mongoose.Schema.Types.Mixed, index: true },
    nome: { type: String, required: true },
    email: { type: String, index: true },
    telefone: String,

    // Áreas de atuação
    salaPrincipal: String, // ex "1A"
    salasAdicionais: [String], // ["1B", "2A"]
    escola: String,
    disciplina: String,
    materias: [String], // ["Portugues", "Matematica"]
    tipoEspecial: Boolean, // Inglês, Artes, Ed. Física, SEBRAE, Oficina de Leitura

    turmas: [String], // Helper field para unificar salaPrincipal + salasAdicionais

    role: { type: String, default: 'professor' },
    foto: String,

    ativo: { type: Boolean, default: true }
}, {
    timestamps: true,
    strict: true,
    collection: 'professores'
});

module.exports = mongoose.model('Professor', ProfessorSchema);
