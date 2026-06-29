const mongoose = require('mongoose');

const ComunicadoSchema = new mongoose.Schema({
    titulo: { type: String, required: true },
    conteudo: { type: String, required: true }, // HTML formatado
    imagens: [{ type: String }], // Array de strings (Base64 ou URLs)
    diretorId: { type: String, ref: 'Usuario', required: true },
    diretorNome: { type: String, required: true },
    diretorFoto: { type: String },
    diretorPerfil: { type: String },
    
    // Destinatários: 'todos', 'professores', 'responsaveis', 'turma:ID', 'usuario:ID'
    destinatarios: [{ type: String, required: true }],
    
    // Novas propriedades Redesign 3.0
    categoria: { type: String, default: 'Direção', enum: ['Todos', 'Direção', 'Professores', 'Responsáveis', 'Sistema'] },
    prioridade: { type: String, default: 'Normal', enum: ['Normal', 'Importante', 'Urgente'] },
    arquivos: [{ 
        nome: String, 
        url: String, 
        tipo: String // 'pdf', 'doc', etc.
    }],
    dataAgendada: { type: Date, default: null }, // Para envio programado

    visualizacoes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Usuario' }],
    reacoesCount: { type: Number, default: 0 },
    comentariosCount: { type: Number, default: 0 },
    
    dataCriacao: { type: Date, default: Date.now },
    dataAtualizacao: { type: Date, default: Date.now },
    ativo: { type: Boolean, default: true }
});

module.exports = mongoose.models.Comunicado || mongoose.model('Comunicado', ComunicadoSchema);
