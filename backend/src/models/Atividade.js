const mongoose = require('mongoose');

/**
 * Atividade — tarefa/avaliação proposta a uma turma.
 *
 * Domínio novo, criado para sustentar `criarAtividade` e
 * `atividadesPendentesCorrecao`. Segue as convenções dos modelos vizinhos:
 * `_id` string, `escolaId` como discriminador de tenant, `turma` pelo nome
 * (que é como Aluno e Falta referenciam turma neste sistema).
 *
 * ENTREGAS
 * --------
 * `entregas[]` guarda o que cada aluno entregou e se já foi corrigido. É esse
 * subdocumento que responde "o que falta corrigir?" sem precisar de uma
 * segunda coleção — o volume por atividade é da ordem de dezenas, não milhares.
 */

const EntregaSchema = new mongoose.Schema({
    alunoId: { type: String, required: true },
    alunoNome: String,
    entregueEm: { type: Date, default: Date.now },
    corrigida: { type: Boolean, default: false },
    nota: Number,
    observacao: String
}, { _id: false });

const AtividadeSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    escolaId: { type: String, index: true },

    titulo: { type: String, required: true },
    descricao: String,

    turma: { type: String, required: true, index: true },
    materia: String,
    bimestre: Number,

    tipo: {
        type: String,
        enum: ['tarefa', 'prova', 'trabalho', 'projeto', 'leitura', 'outro'],
        default: 'tarefa'
    },

    dataEntrega: { type: Date, index: true },
    valor: Number,

    // Quem propôs. `criadoPor` é o Usuario._id, para casar com o vínculo do
    // professor e permitir "minhas atividades".
    criadoPor: { type: String, required: true, index: true },
    criadoPorNome: String,

    entregas: { type: [EntregaSchema], default: [] },

    ativo: { type: Boolean, default: true },
    criadoEm: { type: Date, default: Date.now }
}, {
    timestamps: true,
    strict: true,
    collection: 'atividades'
});

// Consulta principal: atividades de uma turma numa escola, por prazo.
AtividadeSchema.index({ escolaId: 1, turma: 1, dataEntrega: -1 });

module.exports = mongoose.models.Atividade || mongoose.model('Atividade', AtividadeSchema);
