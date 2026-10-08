/**
 * SolicitacaoFerramenta — o pedido de um professor para usar uma ferramenta
 * que a direção ainda não liberou (Issue #720).
 *
 * Diferente de `PermissaoFerramenta` (o estado atual), aqui cada pedido é um
 * registro próprio: o professor pode pedir de novo depois de uma recusa, e
 * cada pedido guarda quem decidiu e quando.
 *
 * Só pode existir UM pedido pendente por (escola, professor, ferramenta) —
 * o índice único parcial abaixo garante, inclusive sob cliques repetidos.
 */
const mongoose = require('mongoose');

const STATUS_SOLICITACAO = ['pendente', 'autorizada', 'recusada', 'cancelada'];

const SolicitacaoFerramentaSchema = new mongoose.Schema(
    {
        escolaId: { type: String, required: true },
        // `Usuario._id` (String) do professor que pediu.
        professorId: { type: String, required: true },
        ferramentaId: { type: String, required: true },

        // Texto opcional do professor para a direção.
        mensagem: { type: String, trim: true, maxlength: 500 },

        status: { type: String, enum: STATUS_SOLICITACAO, default: 'pendente' },

        decididaPor: { type: String, default: null },
        decididaEm: { type: Date, default: null },
        motivoDecisao: { type: String, trim: true, maxlength: 500 },
    },
    { timestamps: true, collection: 'solicitacoes_ferramentas' }
);

SolicitacaoFerramentaSchema.index(
    { escolaId: 1, professorId: 1, ferramentaId: 1 },
    { unique: true, partialFilterExpression: { status: 'pendente' } }
);
// Fila de pedidos da direção, mais recentes primeiro.
SolicitacaoFerramentaSchema.index({ escolaId: 1, status: 1, createdAt: -1 });

const SolicitacaoFerramenta = mongoose.model('SolicitacaoFerramenta', SolicitacaoFerramentaSchema);

module.exports = SolicitacaoFerramenta;
module.exports.STATUS_SOLICITACAO = STATUS_SOLICITACAO;
