const mongoose = require('mongoose');

/**
 * TravaDistribuida — controle de concorrência e idempotência entre instâncias do backend.
 *
 * POR QUE NO BANCO (Issue #336 / Épico #334)
 * ----------------------------------------
 * Quando o backend roda em mais de uma instância atrás de um balanceador,
 * rotinas agendadas (cron) e tarefas de boot correm o risco de executar
 * simultaneamente em cada instância.
 *
 * O MongoDB Atlas já é dependência central do sistema, servindo como
 * armazenamento distribuído compartilhado (sem necessidade de Redis).
 *
 * TIPOS DE TRAVA
 * --------------
 * - 'janela': Chave única baseada no período (ex: `janela:rotacao-codigo:2026-09-17`).
 *   Inserção única atômica. Quem colide (E11000) pula a rotina.
 *   A chave NÃO é liberada após a execução, evitando que instâncias com leve
 *   descompasso de relógio repitam a ação. É limpa automaticamente pelo índice TTL.
 *
 * - 'arrendamento': Chave com expiração de tempo (lease), usada para seções
 *   críticas como inicialização no boot. Se uma instância cair no meio, outra
 *   pode assumir a trava após a expiração de `expiraEm`.
 */
const TravaDistribuidaSchema = new mongoose.Schema(
    {
        _id: { type: String, required: true },
        tipo: { type: String, enum: ['janela', 'arrendamento'], required: true },
        dono: { type: String, required: true },
        adquiridaEm: { type: Date, default: Date.now },
        expiraEm: { type: Date, required: true },
    },
    {
        collection: 'travas_distribuidas',
        versionKey: false,
    }
);

// TTL: o MongoDB remove o documento automaticamente após a passagem de expiraEm
TravaDistribuidaSchema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });

module.exports =
    mongoose.models.TravaDistribuida || mongoose.model('TravaDistribuida', TravaDistribuidaSchema);
