const mongoose = require('mongoose');

/**
 * Registro de incidentes de segurança com dado pessoal (Resolução CD/ANPD
 * nº 15/2024 — Issue #513).
 *
 * A resolução pede duas coisas diferentes, e este modelo atende as duas:
 *   1. comunicar à ANPD (e aos titulares) em 3 dias úteis a partir da ciência,
 *      quando o incidente puder acarretar risco ou dano relevante;
 *   2. manter o REGISTRO de todo incidente — inclusive do que não foi
 *      comunicado — por no mínimo 5 anos.
 *
 * Por isso a coleção NÃO tem TTL (ao contrário do `AuditLog`, de 365 dias) e o
 * modelo recusa exclusão. Atualizar é permitido — a apuração avança —, mas
 * cada passo entra em `historico`, e o registro encerrado fica fechado.
 *
 * Texto livre (descrição, avaliação, medidas) é lido só pelo admin. Ele não
 * vai ao `AuditLog`, e a tela deve orientar a não escrever nome de pessoa.
 */

const CATEGORIAS_DADOS = [
    'identificacao',
    'contato',
    'saude',
    'deficiencia',
    'escolar',
    'imagem',
    'credenciais',
    'outros',
];
const CATEGORIAS_TITULARES = ['alunos', 'responsaveis', 'professores', 'equipe', 'outros'];

const EventoSchema = new mongoose.Schema(
    {
        evento: { type: String, required: true },
        em: { type: Date, default: Date.now },
        por: String, // id da conta
        perfil: String,
    },
    { _id: false }
);

const IncidenteSegurancaSchema = new mongoose.Schema(
    {
        protocolo: { type: String, required: true, unique: true, uppercase: true, trim: true },
        escolaId: { type: String, index: true }, // ausente = incidente da rede
        titulo: { type: String, required: true, trim: true, maxlength: 160 },
        descricao: { type: String, trim: true, maxlength: 4000, default: '' },

        // A contagem do prazo começa na CIÊNCIA de que dado pessoal foi
        // afetado, não na data em que o incidente aconteceu.
        cienciaEm: { type: Date, required: true },
        ocorridoEm: { type: Date, default: null },

        categoriasDados: { type: [{ type: String, enum: CATEGORIAS_DADOS }], default: [] },
        categoriasTitulares: {
            type: [{ type: String, enum: CATEGORIAS_TITULARES }],
            default: [],
        },
        titularesEstimados: { type: Number, min: 0, default: null },

        risco: {
            type: String,
            enum: ['a_avaliar', 'relevante', 'nao_relevante'],
            default: 'a_avaliar',
        },
        avaliacaoRisco: { type: String, trim: true, maxlength: 4000, default: '' },
        medidas: { type: String, trim: true, maxlength: 4000, default: '' },

        comunicacaoAnpd: {
            comunicadoEm: { type: Date, default: null },
            protocolo: { type: String, trim: true, maxlength: 80, default: '' },
        },
        comunicacaoTitulares: {
            comunicadoEm: { type: Date, default: null },
            meio: { type: String, trim: true, maxlength: 80, default: '' },
        },
        justificativaNaoComunicacao: { type: String, trim: true, maxlength: 4000, default: '' },

        situacao: { type: String, enum: ['aberto', 'encerrado'], default: 'aberto', index: true },
        encerradoEm: { type: Date, default: null },

        registradoPor: String,
        historico: { type: [EventoSchema], default: () => [] },
    },
    { timestamps: true, collection: 'incidentes_seguranca' }
);

IncidenteSegurancaSchema.index({ situacao: 1, cienciaEm: -1 });

// Guarda mínima de 5 anos (art. 10 da resolução): nenhuma exclusão passa pelo
// mongoose. Mesmo desenho do AuditLog, sem a parte de atualização.
for (const operacao of ['deleteOne', 'deleteMany', 'findOneAndDelete']) {
    IncidenteSegurancaSchema.pre(operacao, function bloquear() {
        const erro = new Error(
            `Registro de incidente não pode ser excluído (Res. CD/ANPD 15/2024): "${operacao}".`
        );
        erro.codigo = 'INCIDENTE_NAO_EXCLUIVEL';
        throw erro;
    });
}

const IncidenteSeguranca =
    mongoose.models.IncidenteSeguranca ||
    mongoose.model('IncidenteSeguranca', IncidenteSegurancaSchema);

IncidenteSeguranca.CATEGORIAS_DADOS = CATEGORIAS_DADOS;
IncidenteSeguranca.CATEGORIAS_TITULARES = CATEGORIAS_TITULARES;

module.exports = IncidenteSeguranca;
