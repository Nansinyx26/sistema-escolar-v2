/**
 * ModeracaoJob — a fila de análise assíncrona, em MongoDB.
 *
 * POR QUE NÃO REDIS/BULLMQ (§8.5)
 * ===============================
 * O deploy é single-process no Render e o volume esperado é de dezenas de
 * análises por dia. Subir Redis para isso é adicionar um serviço a mais para
 * cair de madrugada, um a mais para monitorar e um a mais para pagar — custo
 * desproporcional ao problema. O `moderacaoQueue` isola a troca atrás da
 * interface, então migrar para BullMQ quando passar de ~1000 análises/dia é
 * mudar um arquivo, não a arquitetura.
 *
 * O lock é `findOneAndUpdate` atômico: duas instâncias podem consumir a mesma
 * coleção sem processar o mesmo job duas vezes (R8 da spec).
 */

const mongoose = require('mongoose');

const ModeracaoJobSchema = new mongoose.Schema(
    {
        tipo: { type: String, required: true },

        // O que o handler precisa para trabalhar. NUNCA o conteúdo em si — só
        // referências (mensagemId, gridfsId). Mesmo princípio de §6.1: a fila
        // não pode virar um segundo lugar onde o texto ofensivo fica guardado.
        payload: { type: mongoose.Schema.Types.Mixed, default: {} },

        escolaId: { type: String, index: true },

        status: {
            type: String,
            enum: ['pendente', 'processando', 'concluido', 'falhou'],
            default: 'pendente',
            index: true,
        },

        tentativas: { type: Number, default: 0 },
        proximaTentativaEm: { type: Date, default: Date.now },
        ultimoErro: { type: String },

        // Quem pegou o job e quando — sem isso, um processo que morre no meio
        // deixa o job em 'processando' para sempre.
        travadoPor: { type: String, default: null },
        travadoEm: { type: Date, default: null },

        criadoEm: { type: Date, default: Date.now },
        concluidoEm: { type: Date },
    },
    { collection: 'moderacao_jobs' }
);

// A query do worker: "o que está pendente e já pode ser tentado de novo".
ModeracaoJobSchema.index({ status: 1, proximaTentativaEm: 1 });

// Job concluído não precisa viver: 7 dias é o bastante para investigar um
// incidente e curto o bastante para a coleção não virar depósito.
ModeracaoJobSchema.index(
    { concluidoEm: 1 },
    { expireAfterSeconds: 7 * 24 * 60 * 60, partialFilterExpression: { status: 'concluido' } }
);

module.exports = mongoose.model('ModeracaoJob', ModeracaoJobSchema);
