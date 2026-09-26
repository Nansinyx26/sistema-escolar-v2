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

        // Decisão da escola sobre usar o assistente de IA (Issue #401).
        // `undefined` = sem decisão registrada: vale o padrão da rede
        // (`IA_ESCOLAS_PADRAO`, que nasce desligado).
        iaHabilitada: { type: Boolean },

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

        // ─── Bloqueio administrativo (Issue #463) ───────────────────────────────
        // NÃO é o mesmo que `ativo`. `ativo: false` é "a escola ainda não entrou
        // no sistema" (cadeado do modal da landing, sem motivo nem autor).
        // `status: 'bloqueada'` é uma decisão do super admin sobre uma escola que
        // JÁ opera: corta o login e as sessões de toda a equipe e das famílias,
        // tem motivo obrigatório e fica registrada em quem/quando e no AuditLog.
        // Quem aplica o bloqueio em runtime é `services/escolaBloqueio.js`.
        status: { type: String, enum: ['ativa', 'bloqueada'], default: 'ativa' },
        motivoBloqueio: { type: String, trim: true, maxlength: 500 },
        // `Usuario._id` é String (não ObjectId) neste projeto — ver models/Usuario.js.
        bloqueadaEm: { type: Date },
        bloqueadaPor: { type: String, ref: 'Usuario' },
        desbloqueadaEm: { type: Date },
        desbloqueadaPor: { type: String, ref: 'Usuario' },

        criadoEm: { type: Date, default: Date.now },
    },
    { collection: 'escolas' }
);

EscolaSchema.index({ ativo: 1, tipo: 1 });
// Lista da gestão de escolas (filtro por status, ordenada por nome) e o
// conjunto de bloqueadas que o `escolaBloqueio` consulta a cada poucos segundos.
EscolaSchema.index({ status: 1, nome: 1 });
// Código INEP é único quando existe — duas escolas com o mesmo código fariam a
// rede declarar matrícula de uma no lugar da outra.
EscolaSchema.index(
    { codigoInep: 1 },
    { unique: true, partialFilterExpression: { codigoInep: { $type: 'string' } } }
);

module.exports = mongoose.model('Escola', EscolaSchema);
