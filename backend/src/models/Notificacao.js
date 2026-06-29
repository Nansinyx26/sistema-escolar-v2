const mongoose = require('mongoose');

const NotificacaoSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    tipo: { type: String, required: true }, // 'informativo', 'alerta', etc.
    categoria: { 
        type: String, 
        enum: ['direcao', 'academico', 'financeiro', 'saude', 'evento'], 
        default: 'informativo' 
    },
    prioridade: { 
        type: String, 
        enum: ['normal', 'alta'], 
        default: 'normal' 
    },
    titulo: { type: String, required: true },
    mensagem: { type: String, required: true },
    corpoHtml: { type: String }, // Para e-mails
    destinatarios: { type: mongoose.Schema.Types.Mixed, required: true },
    comunicadoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Comunicado', default: null, index: true },
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
    escolaId: { type: String, required: true, default: 'default' }
});

module.exports = mongoose.model('Notificacao', NotificacaoSchema);
