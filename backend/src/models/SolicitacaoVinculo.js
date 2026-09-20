const mongoose = require('mongoose');

/**
 * Pedido de inclusão de responsável na ficha de um aluno (Issue #398).
 *
 * O acesso de um responsável aos dados do filho é decidido pelo e-mail que
 * consta na ficha. Até esta Issue, o próprio responsável podia acrescentar
 * outro e-mail e esse e-mail passava a ver tudo na hora, sem a escola saber.
 * Agora a inclusão nasce aqui, como pedido, e só vira acesso quando a
 * secretaria aprova.
 *
 * O pedido guarda quem pediu, para quem, e a decisão — é o registro que
 * responde "quem autorizou esta pessoa a ver os dados desta criança".
 */
const SolicitacaoVinculoSchema = new mongoose.Schema(
    {
        escolaId: { type: String, index: true },
        alunoId: { type: String, required: true, index: true },
        // Quem pediu (responsável já vinculado).
        solicitanteId: { type: String, required: true },
        solicitanteEmail: { type: String, required: true, lowercase: true, trim: true },
        // Quem entra na ficha se for aprovado.
        email: { type: String, required: true, lowercase: true, trim: true },
        nome: { type: String, trim: true },
        parentesco: { type: String, trim: true },
        telefone: { type: String, trim: true },
        status: {
            type: String,
            enum: ['pendente', 'aprovada', 'recusada'],
            default: 'pendente',
            index: true,
        },
        decididoEm: { type: Date, default: null },
        decididoPor: { type: String, default: null },
        motivoRecusa: { type: String, default: null },
    },
    { timestamps: true, collection: 'solicitacoes_vinculo' }
);

SolicitacaoVinculoSchema.index({ escolaId: 1, status: 1, createdAt: -1 });
// Um pedido pendente por e-mail e aluno: reenviar não vira fila de duplicatas.
SolicitacaoVinculoSchema.index(
    { alunoId: 1, email: 1 },
    { unique: true, partialFilterExpression: { status: 'pendente' } }
);

module.exports =
    mongoose.models.SolicitacaoVinculo ||
    mongoose.model('SolicitacaoVinculo', SolicitacaoVinculoSchema);
