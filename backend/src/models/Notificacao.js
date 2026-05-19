const mongoose = require('mongoose');

const NotificacaoSchema = new mongoose.Schema({
    id: { type: String, unique: true },
    tipo: { type: String, required: true },
    titulo: { type: String, required: true },
    mensagem: { type: String, required: true },
    destinatarios: { type: String, required: true }, // 'todos', ID da turma, ou ID do aluno
    dataCriacao: { type: Date, default: Date.now },
    dataEnvio: { type: Date, default: Date.now },
    status: { type: String, enum: ['enviado', 'agendado'], default: 'enviado' },
    lido: [{ type: String }],
    confirmacao: [{ type: String }],
    ocultadoPor: [{ type: String }],
    escolaId: { type: String, required: true, default: 'default' }
});

module.exports = mongoose.model('Notificacao', NotificacaoSchema);
