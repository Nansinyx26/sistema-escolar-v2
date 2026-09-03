const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema(
    {
        usuarioId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Usuario',
            required: false,
        },
        usuarioNome: String,
        usuarioEmail: String,
        perfil: String,
        acao: {
            type: String,
            required: true,
        }, // Ex: 'CREATE_USER', 'DELETE_STUDENT', 'UPDATE_GRADE'
        recurso: String, // Ex: 'Alunos', 'Notas', 'Usuarios'
        recursoId: String,
        // Multi-escola: permite ao diretor auditar apenas a própria escola
        escolaId: { type: String, index: true },
        detalhes: {
            valorAnterior: mongoose.Schema.Types.Mixed,
            valorNovo: mongoose.Schema.Types.Mixed,
            descricao: String,
        },
        ip: String,
        userAgent: String,
        dispositivo: String,
        data: {
            type: Date,
            default: Date.now,
        },
    },
    { collection: 'audit_logs' }
);

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

// ============================================
// APPEND-ONLY — Marco Civil da Internet, art. 15
// ============================================
// O log de auditoria é a prova de quem alterou nota, justificou falta ou
// exportou dado de aluno. Prova que o próprio autor da fraude pode apagar não
// é prova: quem alterou a nota é exatamente quem tem motivo para remover a
// linha, e quem tem acesso administrativo ao sistema costuma ser quem tem
// acesso à tela de auditoria.
//
// Os hooks abaixo recusam QUALQUER escrita que não seja inserção. Não é
// paranoia com o time: é tirar da mão de todo mundo — inclusive de um controller
// futuro escrito distraidamente — a capacidade de alterar o registro. Um
// `AuditLog.deleteMany()` que hoje não existe em lugar nenhum passa a ser um
// erro em tempo de execução, e não uma linha que passa despercebida em revisão.
//
// O QUE ISTO NÃO COBRE — e por que está escrito aqui
// --------------------------------------------------
// Middleware de mongoose só vale para quem passa PELO mongoose. Continuam
// capazes de apagar:
//
//   • acesso direto ao driver (`mongoose.connection.collection('audit_logs')`),
//     que é o que o `limparBanco()` dos testes usa de propósito;
//   • qualquer cliente conectado ao banco com privilégio de escrita (mongosh,
//     Compass, script de manutenção).
//
// A barreira definitiva é do BANCO, não da aplicação: o usuário de aplicação no
// Atlas precisa ter `insert` e `find` na coleção `audit_logs` e NÃO ter
// `update`/`remove`. Ver docs/CONFORMIDADE-LEGAL.md §2. Este código é a camada
// que impede o acidente; a permissão do banco é a que impede o dolo.
//
// A EXPIRAÇÃO POR TTL CONTINUA FUNCIONANDO
// ----------------------------------------
// Quem apaga o documento vencido é o mongod, internamente, sem passar por
// mongoose — a política de retenção de 365 dias acima segue valendo sem furar
// a regra.
const OPERACOES_PROIBIDAS = [
    'updateOne',
    'updateMany',
    'replaceOne',
    'findOneAndUpdate',
    'findOneAndReplace',
    'deleteOne',
    'deleteMany',
    'findOneAndDelete',
];

class AuditLogImutavelError extends Error {
    constructor(operacao) {
        super(
            `AuditLog é append-only (Marco Civil, art. 15): a operação "${operacao}" ` +
                'não é permitida sobre audit_logs.'
        );
        this.name = 'AuditLogImutavelError';
        this.codigo = 'AUDIT_LOG_IMUTAVEL';
    }
}

for (const operacao of OPERACOES_PROIBIDAS) {
    AuditLogSchema.pre(operacao, function bloquear() {
        throw new AuditLogImutavelError(operacao);
    });
}

// `save()` sobre documento JÁ EXISTENTE é edição disfarçada de gravação — o
// caminho mais provável de alguém "corrigir" um log sem perceber que corrigiu.
AuditLogSchema.pre('save', function bloquearEdicao(next) {
    if (!this.isNew) return next(new AuditLogImutavelError('save (documento existente)'));
    next();
});

const AuditLog = mongoose.model('AuditLog', AuditLogSchema);
AuditLog.AuditLogImutavelError = AuditLogImutavelError;

module.exports = AuditLog;
