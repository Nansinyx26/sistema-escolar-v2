const mongoose = require('mongoose');

const BadgeSchema = new mongoose.Schema({
    alunoId: {
        type: String,
        required: true,
        index: true
    },
    tipo: {
        type: String,
        enum: ['PRESENCA', 'EXCELENCIA', 'EVOLUCAO', 'PARTICIPACAO'],
        required: true
    },
    nivel: {
        type: Number,
        default: 1 // 1=Bronze, 2=Prata, 3=Ouro
    },
    titulo: {
        type: String,
        required: true
    },
    descricao: String,
    dataConquista: {
        type: Date,
        default: Date.now
    },
    icone: {
        type: String,
        default: 'bi-trophy-fill'
    }
}, {
    timestamps: true,
    collection: 'badges'
});

// Índice único para evitar duplicidade da mesma insígnia de mesmo nível para o aluno
BadgeSchema.index({ alunoId: 1, tipo: 1, nivel: 1 }, { unique: true });

module.exports = mongoose.model('Badge', BadgeSchema);
