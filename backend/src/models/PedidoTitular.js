const mongoose = require('mongoose');

/**
 * Pedidos de titulares de dados pessoais sob a LGPD (Issue #413).
 *
 * Registra formalmente cada requisição de direito do titular (exclusão/anonimização,
 * exportação/portabilidade, retificação ou informação) com protocolo auditável,
 * prazo legal (LGPD Art. 19, II: 15 dias), status de atendimento e histórico
 * completo de despacho pela administração.
 */
const HistoricoPedidoSchema = new mongoose.Schema(
    {
        status: {
            type: String,
            enum: ['pendente', 'em_analise', 'concluido', 'rejeitado'],
            required: true,
        },
        alteradoEm: { type: Date, default: Date.now },
        alteradoPor: { type: String, trim: true },
        observacao: { type: String, trim: true },
    },
    { _id: false }
);

const PedidoTitularSchema = new mongoose.Schema(
    {
        protocolo: {
            type: String,
            required: true,
            unique: true,
            uppercase: true,
            trim: true,
            index: true,
        },
        usuarioId: { type: String, required: true, index: true },
        usuarioEmail: { type: String, required: true, lowercase: true, trim: true, index: true },
        usuarioNome: { type: String, trim: true },
        perfil: { type: String, trim: true },
        escolaId: { type: String, index: true },
        tipo: {
            type: String,
            enum: ['exclusao', 'exportacao', 'retificacao', 'informacao'],
            default: 'exclusao',
            required: true,
            index: true,
        },
        motivo: { type: String, trim: true, default: '' },
        status: {
            type: String,
            enum: ['pendente', 'em_analise', 'concluido', 'rejeitado'],
            default: 'pendente',
            index: true,
        },
        prazoAtendimento: { type: Date, required: true, index: true },
        detalhes: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        historico: { type: [HistoricoPedidoSchema], default: () => [] },
        decididoEm: { type: Date, default: null },
        decididoPor: { type: String, default: null },
        respostaAdmin: { type: String, trim: true, default: '' },
    },
    {
        timestamps: true,
        collection: 'pedidos_titular',
    }
);

PedidoTitularSchema.index({ escolaId: 1, status: 1, createdAt: -1 });
PedidoTitularSchema.index({ usuarioId: 1, createdAt: -1 });
PedidoTitularSchema.index({ status: 1, prazoAtendimento: 1 });

module.exports =
    mongoose.models.PedidoTitular || mongoose.model('PedidoTitular', PedidoTitularSchema);
