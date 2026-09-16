const mongoose = require('mongoose');

/**
 * Contador de rate limit compartilhado entre instâncias.
 *
 * POR QUE NO BANCO
 * ----------------
 * O contador em memória pertence a um processo: com duas instâncias cada uma
 * conta metade das requisições, e o teto real dobra; a cada reinício do Render
 * o contador zera. O MongoDB já é dependência do sistema, então guardar o
 * contador aqui não traz serviço novo nem custo.
 *
 * Um documento por chave (`<limitador>:<ip ou usuário>`). A atualização é
 * atômica (ver services/protecaoAbuso/StoreMongoRateLimit.js) e o índice TTL
 * apaga o documento quando a janela acaba: a coleção não cresce sem limite.
 */
const RateLimitContadorSchema = new mongoose.Schema(
    {
        _id: { type: String },
        hits: { type: Number, default: 0 },
        expiraEm: { type: Date, required: true },
    },
    {
        collection: 'rate_limit_contadores',
        versionKey: false,
    }
);

RateLimitContadorSchema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });

module.exports =
    mongoose.models.RateLimitContador ||
    mongoose.model('RateLimitContador', RateLimitContadorSchema);
