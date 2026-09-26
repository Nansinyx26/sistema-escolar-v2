const mongoose = require('mongoose');

function normalizeCategoria(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    const aliases = {
        direção: 'direcao',
        direcao: 'direcao',
        academico: 'academico',
        acadêmico: 'academico',
        financeiro: 'financeiro',
        saude: 'saude',
        evento: 'evento',
        informativo: 'informativo',
        todos: 'todos',
        professores: 'professores',
        responsaveis: 'responsaveis',
        responsáveis: 'responsaveis',
        sistema: 'sistema',
    };
    return aliases[normalized] || 'informativo';
}

function normalizePrioridade(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    const aliases = {
        baixa: 'normal',
        media: 'normal',
        média: 'normal',
        normal: 'normal',
        importante: 'alta',
        urgente: 'alta',
        alta: 'alta',
    };
    return aliases[normalized] || 'normal';
}

const NotificacaoSchema = new mongoose.Schema({
    // Índice único em produção sem `sparse`: dois documentos sem `id` colidem
    // em `{ id: null }` (E11000) e só a primeira notificação do
    // NotificationService era gravada. O default garante o campo em todo
    // caminho de criação, sem depender de migração do índice.
    id: {
        type: String,
        unique: true,
        default: () => `notif_${new mongoose.Types.ObjectId().toHexString()}`,
    },
    tipo: { type: String, required: true }, // 'informativo', 'alerta', etc.
    categoria: {
        type: String,
        enum: [
            'direcao',
            'academico',
            'financeiro',
            'saude',
            'evento',
            'informativo',
            'todos',
            'professores',
            'responsaveis',
            'sistema',
        ],
        default: 'informativo',
    },
    prioridade: {
        type: String,
        enum: ['normal', 'alta', 'media', 'baixa', 'urgente', 'importante'],
        default: 'normal',
    },
    titulo: { type: String, required: true },
    mensagem: { type: String, required: true },
    corpoHtml: { type: String }, // Para e-mails
    destinatarios: { type: mongoose.Schema.Types.Mixed, required: true },
    comunicadoId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Comunicado',
        default: null,
        index: true,
    },
    dataCriacao: { type: Date, default: Date.now },
    dataEnvio: { type: Date, default: Date.now },
    status: { type: String, enum: ['enviado', 'agendado'], default: 'enviado' },
    enviadoPush: { type: Boolean, default: false },
    enviadoEmail: { type: Boolean, default: false },
    lido: [{ type: String }],
    confirmacao: [{ type: String }], // Usuários que confirmaram leitura (para prioridade alta)
    ocultadoPor: [{ type: String }],
    comentariosCount: { type: Number, default: 0 },
    paraResponsavel: { type: Boolean, default: false },
    criadoPor: { type: String },
    escolaId: { type: String, required: true, default: 'default', index: true },
});

NotificacaoSchema.pre('validate', function (next) {
    if (this.categoria !== undefined) {
        this.categoria = normalizeCategoria(this.categoria);
    }
    if (this.prioridade !== undefined) {
        this.prioridade = normalizePrioridade(this.prioridade);
    }
    next();
});

// Índices compostos para acelerar listagens escopadas e ordenadas por data (Issue #338)
NotificacaoSchema.index({ escolaId: 1, dataCriacao: -1 });
NotificacaoSchema.index({ tipo: 1, dataCriacao: -1 });

module.exports = mongoose.model('Notificacao', NotificacaoSchema);
