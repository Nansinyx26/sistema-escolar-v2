const mongoose = require('mongoose');

const AvaliacaoHistoricoSchema = new mongoose.Schema(
    {
        _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
        escolaId: { type: String, index: true },
        avaliacaoId: { type: String, required: true, index: true },
        notaId: { type: String, index: true },
        alunoId: { type: String, required: true, index: true },
        alunoNome: { type: String, default: '' },
        notaAnterior: { type: Number },
        notaNova: { type: Number, required: true },
        presenteAnterior: { type: Boolean },
        presenteNovo: { type: Boolean },
        motivo: { type: String, default: 'Lançamento de nota' },
        alteradoPorId: { type: String, required: true },
        alteradoPorNome: { type: String, default: '' },
        alteradoPorPerfil: { type: String, default: '' },
        dataAlteracao: { type: Date, default: Date.now, index: true },
    },
    {
        timestamps: true,
        strict: true,
        collection: 'avaliacoes_historico',
    }
);

AvaliacaoHistoricoSchema.index({ avaliacaoId: 1, dataAlteracao: -1 });
AvaliacaoHistoricoSchema.index({ alunoId: 1, dataAlteracao: -1 });

module.exports =
    mongoose.models.AvaliacaoHistorico ||
    mongoose.model('AvaliacaoHistorico', AvaliacaoHistoricoSchema);
