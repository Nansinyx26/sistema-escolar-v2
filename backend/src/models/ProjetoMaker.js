const mongoose = require('mongoose');

/**
 * ProjetoMaker — projeto da oficina maker / cultura maker.
 *
 * Domínio novo, criado para sustentar `criarProjetoMaker`. O cadastro de
 * Professor já reconhece "Of. Maker" como área de atuação (`tipoEspecial`),
 * então o conceito existia no sistema sem uma coleção própria.
 *
 * Deliberadamente enxuto: registra o que a escola precisa acompanhar
 * (o que é, quem participa, em que etapa está) sem tentar virar um gestor de
 * projetos completo.
 */

const ProjetoMakerSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    escolaId: { type: String, index: true },

    titulo: { type: String, required: true },
    descricao: String,

    // Turmas envolvidas, pelo nome — mesma convenção de Aluno/Falta.
    turmas: { type: [String], default: [] },

    area: {
        type: String,
        enum: ['robotica', 'programacao', 'impressao3d', 'marcenaria', 'eletronica', 'sustentabilidade', 'outro'],
        default: 'outro'
    },

    situacao: {
        type: String,
        enum: ['planejamento', 'em_andamento', 'concluido', 'suspenso'],
        default: 'planejamento',
        index: true
    },

    dataInicio: Date,
    dataPrevistaFim: Date,

    materiais: { type: [String], default: [] },

    responsavelId: { type: String, index: true },
    responsavelNome: String,

    criadoPor: { type: String, required: true },
    criadoPorNome: String,

    ativo: { type: Boolean, default: true },
    criadoEm: { type: Date, default: Date.now }
}, {
    timestamps: true,
    strict: true,
    collection: 'projetos_maker'
});

ProjetoMakerSchema.index({ escolaId: 1, situacao: 1, criadoEm: -1 });

module.exports = mongoose.models.ProjetoMaker
    || mongoose.model('ProjetoMaker', ProjetoMakerSchema);
