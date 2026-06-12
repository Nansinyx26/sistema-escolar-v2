const mongoose = require('mongoose');

const RelatorioSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    turma: { type: String, index: true },
    autor: { type: mongoose.Schema.Types.Mixed, ref: 'Professor' },
    data: Date,
    conteudo: String, // texto/markdown
    periodo: String, // diário/quinzenal
    materia: String
}, {
    timestamps: true,
    strict: true,
    collection: 'relatorios'
});

module.exports = mongoose.model('Relatorio', RelatorioSchema);
