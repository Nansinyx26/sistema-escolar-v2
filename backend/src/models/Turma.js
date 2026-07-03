const mongoose = require('mongoose');

const TurmaSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    id: { type: String, index: true }, // "1A"
    nome: String, // "1A"
    ano: Number,
    sala: String,
    periodo: String,
    capacidade: Number,

    professor: { type: mongoose.Schema.Types.Mixed, ref: 'Professor' }, // Pode ser ID ou Object

    descricao: String,
    ativo: { type: Boolean, default: true }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    strict: true,
    collection: 'turmas'
});

// Virtual para alunos
TurmaSchema.virtual('alunos', {
    ref: 'Aluno',
    localField: 'nome', // ou 'id'
    foreignField: 'turma',
    justOne: false
});

module.exports = mongoose.models.Turma || mongoose.model('Turma', TurmaSchema);
