const mongoose = require('mongoose');

const ProfessorSchema = new mongoose.Schema(
    {
        _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
        id: { type: mongoose.Schema.Types.Mixed, index: true },
        idUsuario: { type: String, index: true }, // Vínculo com Usuario._id
        nome: { type: String, required: true },
        email: { type: String, index: true },
        telefone: String,
        idade: Number,
        biografia: String,
        atividadesPessoais: String,
        ideiasParaAno: String,
        tipoAtuacao: String, // principal ou materia
        professorKey: String,

        // Áreas de atuação
        salaPrincipal: String, // ex "1A"
        salasAdicionais: [String], // ["1B", "2A"]
        escola: String,
        // Multi-escola: vínculos do usuário com escolas (escolaId = _id de Escola).
        // As turmas de cima (salaPrincipal/salasAdicionais/turmas) são da escola do
        // cadastro — o primeiro vínculo. Numa escola de vínculo adicional, as turmas
        // atribuídas pela gestão dela ficam em `turmas` do próprio vínculo (Issue
        // #707; ver services/turmasDoProfessor.js). Sem default: ausente quer dizer
        // "nunca atribuída", diferente de lista vazia.
        vinculos: [
            {
                escolaId: { type: String, index: true },
                cargo: String,
                turmas: { type: [String], default: undefined },
                _id: false,
            },
        ],
        disciplina: String,
        materias: [String], // ["Portugues", "Matematica"]
        tipoEspecial: Boolean, // Inglês, Artes, Ed. Física, SEBRAE, Oficina de Leitura, Of. Maker

        turmas: [String], // Helper field para unificar salaPrincipal + salasAdicionais

        role: { type: String, default: 'professor' },
        foto: String,

        ativo: { type: Boolean, default: true },
    },
    {
        timestamps: true,
        strict: true,
        collection: 'professores',
    }
);

module.exports = mongoose.model('Professor', ProfessorSchema);
