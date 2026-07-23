const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
    usuarioId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Usuario',
        required: false
    },
    usuarioNome: String,
    usuarioEmail: String,
    perfil: String,
    acao: {
        type: String,
        required: true
    }, // Ex: 'CREATE_USER', 'DELETE_STUDENT', 'UPDATE_GRADE'
    recurso: String, // Ex: 'Alunos', 'Notas', 'Usuarios'
    recursoId: String,
    // Multi-escola: permite ao diretor auditar apenas a própria escola
    escolaId: { type: String, index: true },
    detalhes: {
        valorAnterior: mongoose.Schema.Types.Mixed,
        valorNovo: mongoose.Schema.Types.Mixed,
        descricao: String
    },
    ip: String,
    userAgent: String,
    dispositivo: String,
    data: {
        type: Date,
        default: Date.now
    }
}, { collection: 'audit_logs' });

// Índices para busca rápida na tela de auditoria
AuditLogSchema.index({ data: -1 });
AuditLogSchema.index({ usuarioId: 1 });
AuditLogSchema.index({ acao: 1 });
AuditLogSchema.index({ recurso: 1 });

// ============================================
// MELHORIA: TTL Automático — Retenção LGPD (Roadmap #14)
// ============================================
// Exclui logs automaticamente após 365 dias (1 ano).
// Implementa a política de retenção da LGPD sem cron job.
// O campo 'data' serve como referência de expiração.
AuditLogSchema.index({ data: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', AuditLogSchema);
