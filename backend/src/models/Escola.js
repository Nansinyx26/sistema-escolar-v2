const mongoose = require('mongoose');

/**
 * Escola — entidade central do suporte multi-escola.
 * `ativo: false` = exibida com cadeado no modal da landing (não clicável).
 * `codigoSecreto` = código de cadastro POR ESCOLA (nunca exposto em rotas públicas).
 */
const EscolaSchema = new mongoose.Schema(
    {
        nome: { type: String, required: true, unique: true, trim: true },
        tipo: { type: String, enum: ['EMEF', 'CIEP'], required: true },
        endereco: { type: String, default: '' },
        bairro: { type: String, default: '' },
        municipio: { type: String, default: 'Americana' },
        codigoSecreto: { type: String, select: false },

        // ─── Identificação no Censo Escolar (INEP) ──────────────────────────────
        // Sem o código INEP da unidade não existe declaração: o Educacenso identifica
        // a escola por ele, não pelo nome. Fica opcional no schema porque a escola é
        // cadastrada no sistema antes de a rede informar o código, mas a exportação
        // (`services/conformidade/educacenso.js`) recusa o lote sem ele.
        // Sem `sparse` no campo: o índice único parcial declarado abaixo já cobre,
        // e declarar os dois faz o mongoose criar índice duplicado.
        codigoInep: { type: String, trim: true },
        // `tipo` (EMEF/CIEP) descreve o prédio; o Censo pergunta quem MANTÉM a
        // escola, que é o que define de onde vem o Fundeb.
        dependenciaAdministrativa: {
            type: String,
            enum: ['MUNICIPAL', 'ESTADUAL', 'FEDERAL', 'PRIVADA'],
            default: 'MUNICIPAL',
        },
        ativo: { type: Boolean, default: false },
        criadoEm: { type: Date, default: Date.now },
    },
    { collection: 'escolas' }
);

EscolaSchema.index({ ativo: 1, tipo: 1 });
// Código INEP é único quando existe — duas escolas com o mesmo código fariam a
// rede declarar matrícula de uma no lugar da outra.
EscolaSchema.index(
    { codigoInep: 1 },
    { unique: true, partialFilterExpression: { codigoInep: { $type: 'string' } } }
);

module.exports = mongoose.model('Escola', EscolaSchema);
