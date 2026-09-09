const mongoose = require('mongoose');

const TIPOS_AUTORIZACAO = [
    'tratamentoOdontologico',
    'tratamentoMedicoEmergencial',
    'testagemAcuidade',
    'atividadesFisicas',
    'atividadesExtraclasse',
    'conducaoEscolar',
    'antitermico',
];

const METADADOS_AUTORIZACOES = {
    tratamentoOdontologico: {
        titulo: 'Tratamento odontológico',
        descricao:
            'Autoriza a escola a encaminhar o(a) aluno(a) ao atendimento odontológico oferecido ou conveniado pela escola, incluindo avaliações preventivas.',
    },
    tratamentoMedicoEmergencial: {
        titulo: 'Tratamento médico emergencial',
        descricao:
            'Em caso de acidente ou mal súbito, autoriza a escola a buscar atendimento médico de urgência (hospital ou SAMU) imediatamente.',
    },
    testagemAcuidade: {
        titulo: 'Testagem acuidade visual/auditiva',
        descricao:
            'Autoriza exames simples e não invasivos de visão e audição na própria escola para identificação precoce de necessidades.',
    },
    atividadesFisicas: {
        titulo: 'Atividades físicas',
        descricao:
            'Autoriza a participação nas aulas regulares de educação física, jogos e esportes escolares.',
    },
    atividadesExtraclasse: {
        titulo: 'Atividades extraclasse / excursões',
        descricao:
            'Autoriza a participação em passeios pedagógicos, visitas e excursões fora da escola organizados pela instituição.',
    },
    conducaoEscolar: {
        titulo: 'Condução escolar contratada',
        descricao:
            'Indica que o transporte do(a) aluno(a) é realizado por van ou transporte particular contratado pelo responsável.',
    },
    antitermico: {
        titulo: 'Autoriza antitérmico',
        descricao:
            'Autoriza a escola a administrar medicamento antitérmico em caso de febre, respeitando o remédio e dose informados.',
    },
};

const AutorizacaoSchema = new mongoose.Schema(
    {
        escolaId: { type: String, required: true, index: true },
        alunoId: { type: mongoose.Schema.Types.Mixed, required: true, index: true },
        responsavelId: { type: mongoose.Schema.Types.Mixed, index: true },
        responsavelNome: { type: String, trim: true },
        responsavelEmail: { type: String, trim: true, lowercase: true },
        tipoAutorizacao: {
            type: String,
            required: true,
            enum: TIPOS_AUTORIZACAO,
        },
        titulo: { type: String },
        descricao: { type: String },
        aceita: { type: Boolean, default: null },
        detalhes: { type: mongoose.Schema.Types.Mixed, default: undefined },
        dataResposta: { type: Date },
        atualizadoEm: { type: Date, default: Date.now },
    },
    {
        timestamps: true,
    }
);

AutorizacaoSchema.index({ escolaId: 1, alunoId: 1, tipoAutorizacao: 1 }, { unique: true });
AutorizacaoSchema.index({ escolaId: 1, responsavelEmail: 1 });

const Autorizacao = mongoose.models.Autorizacao || mongoose.model('Autorizacao', AutorizacaoSchema);
Autorizacao.TIPOS_AUTORIZACAO = TIPOS_AUTORIZACAO;
Autorizacao.METADADOS_AUTORIZACOES = METADADOS_AUTORIZACOES;

module.exports = Autorizacao;
