const mongoose = require('mongoose');

const RelatorioSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    escolaId: { type: String, index: true },
    turma: { type: String, index: true },
    autor: { type: mongoose.Schema.Types.Mixed, ref: 'Professor' },
    data: Date,
    // Dia civil em `YYYY-MM-DD`. O `data` acima é um instante, e instante
    // depende de fuso: o relatório do dia 29 gravado às 21h de Brasília vira
    // dia 30 em UTC. A chave do relatório diário é a data do calendário da
    // escola, não um ponto na linha do tempo — por isso ela é string.
    dia: { type: String },
    conteudo: String, // texto/markdown
    periodo: String, // diário/quinzenal
    materia: String
}, {
    timestamps: true,
    strict: true,
    collection: 'relatorios'
});

// Um relatório por turma/matéria/dia. É o índice que garante isso, não o
// controller: sem ele, dois saves simultâneos do mesmo dia (auto-save +
// clique em "Salvar") criam duas linhas e a tela passa a mostrar uma delas
// ao acaso. `partialFilterExpression` deixa de fora os documentos antigos
// e os relatórios não-diários, que não têm `dia`.
RelatorioSchema.index(
    { escolaId: 1, turma: 1, materia: 1, dia: 1 },
    { unique: true, partialFilterExpression: { dia: { $type: 'string' } } }
);

module.exports = mongoose.model('Relatorio', RelatorioSchema);
