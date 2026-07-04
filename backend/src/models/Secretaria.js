const mongoose = require('mongoose');

const SecretariaSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    id: { type: mongoose.Schema.Types.Mixed, index: true },
    idUsuario: { type: String, index: true, required: true }, // Vínculo com Usuario._id
    nome: { type: String, required: true },
    email: { type: String, unique: true },
    telefone: String,
    escola: String,
    // Multi-escola: vínculos do usuário com escolas (escolaId = _id de Escola)
    vinculos: [{ escolaId: { type: String, index: true }, cargo: String, _id: false }],
    setor: { type: String, default: 'Secretaria Geral' }, // Ex: 'Secretaria Geral', 'Secretaria Acadêmica'
    cargo: { type: String, default: 'Secretário(a)' },
    permissoes: {
        matriculas: { type: Boolean, default: true },
        documentos: { type: Boolean, default: true },
        comunicados: { type: Boolean, default: true },
        frequencia: { type: Boolean, default: true },
        relatorios: { type: Boolean, default: true },
        calendario: { type: Boolean, default: true },
        cadastroAlunos: { type: Boolean, default: true },
        cadastroResponsaveis: { type: Boolean, default: true }
    },
    foto: String,
    ativo: { type: Boolean, default: true }
}, {
    timestamps: true,
    strict: true,
    collection: 'secretarias'
});

// Índice para busca por usuário vinculado
SecretariaSchema.index({ idUsuario: 1 }, { unique: true });

module.exports = mongoose.model('Secretaria', SecretariaSchema);
