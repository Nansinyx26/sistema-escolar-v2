const mongoose = require('mongoose');

const NotaEspecialSchema = new mongoose.Schema({
    alunoId: mongoose.Schema.Types.Mixed,
    valor: Number,
    bimestre: Number
}, { _id: false });

const EspecialSchema = new mongoose.Schema({
    nome: String, // "Inglês", "Artes", "Educação Física", "SEBRAE", "Oficina de Leitura", "Desenvolvimento", "Socioemocional"
    turma: String, // "1A" (turma alvo)
    professor: { type: mongoose.Schema.Types.Mixed, ref: 'Professor' },
    notas: [NotaEspecialSchema],
    categoria: { type: String, enum: ['PEB2', 'Oficina'], required: true }
}, {
    timestamps: true,
    strict: true,
    collection: 'especiais'
});

module.exports = mongoose.model('Especial', EspecialSchema);
