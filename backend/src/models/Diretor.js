const mongoose = require('mongoose');

const DiretorSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    id: { type: mongoose.Schema.Types.Mixed, index: true },
    idUsuario: { type: String, index: true }, // Vínculo com Usuario._id
    nome: { type: String, required: true },
    email: { type: String, unique: true },
    telefone: String,
    idade: Number,
    biografia: String,
    escola: String,
    permissoes: [String],
    role: { type: String, default: 'director' },
    foto: String,
    ativo: { type: Boolean, default: true }
}, {
    timestamps: true,
    strict: true,
    collection: 'diretores'
});

module.exports = mongoose.model('Diretor', DiretorSchema);
