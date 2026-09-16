/**
 * StoreMongoRateLimit — armazenamento do express-rate-limit no MongoDB.
 *
 * Implementa a interface `Store` do express-rate-limit (increment, decrement,
 * resetKey, get). Cada limitador recebe a SUA instância, com prefixo próprio:
 * a biblioteca proíbe reaproveitar a mesma instância, e o prefixo impede que
 * dois limitadores com a mesma chave (`ip:1.2.3.4`) somem no mesmo contador.
 *
 * ATOMICIDADE
 * -----------
 * `increment` é UMA operação no banco (findOneAndUpdate com pipeline): se a
 * janela ainda vale, soma 1; se acabou, recomeça em 1 com janela nova. Duas
 * instâncias incrementando a mesma chave ao mesmo tempo nunca perdem contagem,
 * e não existe o intervalo "li, calculei, gravei" em que outra requisição
 * passaria sem ser contada.
 *
 * BANCO FORA DO AR
 * ----------------
 * Liberar tudo quando o banco cai transformaria qualquer instabilidade do
 * Atlas numa janela sem limite nenhum. Em vez disso, cada instância volta a
 * contar na própria memória até o banco responder de novo. O teto passa a
 * valer por instância, que é o comportamento de antes deste armazenamento.
 */
const mongoose = require('mongoose');
const { MemoryStore } = require('express-rate-limit');
const RateLimitContador = require('../../models/RateLimitContador');
const logger = require('../../utils/logger');

const INTERVALO_AVISO_MS = 60 * 1000;
let ultimoAvisoEm = 0;

function avisarQueda(erro) {
    const agora = Date.now();
    if (agora - ultimoAvisoEm < INTERVALO_AVISO_MS) return;
    ultimoAvisoEm = agora;
    logger.warn('[rate-limit] Contador compartilhado indisponível; contando na memória local', {
        errName: erro?.name,
        errMessage: erro?.message,
        action: 'ratelimit.storeFallback',
    });
}

const bancoPronto = () => mongoose.connection.readyState === 1;

class StoreMongoRateLimit {
    /**
     * @param {string} nome identificador do limitador (vira prefixo da chave)
     */
    constructor(nome) {
        this.prefix = `${nome}:`;
        // Chaves ficam num armazenamento compartilhado, não no processo.
        this.localKeys = false;
        this.memoria = new MemoryStore();
        this.windowMs = 60 * 1000;
    }

    init(opcoes) {
        this.windowMs = opcoes.windowMs;
        this.memoria.init(opcoes);
    }

    async get(chave) {
        if (!bancoPronto()) return this.memoria.get(chave);
        try {
            const doc = await RateLimitContador.collection.findOne({ _id: this.prefix + chave });
            if (!doc || doc.expiraEm <= new Date()) return undefined;
            return { totalHits: doc.hits, resetTime: doc.expiraEm };
        } catch (erro) {
            avisarQueda(erro);
            return this.memoria.get(chave);
        }
    }

    async increment(chave) {
        if (!bancoPronto()) return this.memoria.increment(chave);
        const agora = new Date();
        const janelaValida = { $gt: ['$expiraEm', agora] };
        try {
            const doc = await RateLimitContador.collection.findOneAndUpdate(
                { _id: this.prefix + chave },
                [
                    {
                        $set: {
                            hits: { $cond: [janelaValida, { $add: ['$hits', 1] }, 1] },
                            expiraEm: {
                                $cond: [
                                    janelaValida,
                                    '$expiraEm',
                                    new Date(agora.getTime() + this.windowMs),
                                ],
                            },
                        },
                    },
                ],
                { upsert: true, returnDocument: 'after' }
            );
            return { totalHits: doc.hits, resetTime: doc.expiraEm };
        } catch (erro) {
            avisarQueda(erro);
            return this.memoria.increment(chave);
        }
    }

    async decrement(chave) {
        if (!bancoPronto()) return this.memoria.decrement(chave);
        try {
            await RateLimitContador.collection.updateOne(
                { _id: this.prefix + chave, hits: { $gt: 0 }, expiraEm: { $gt: new Date() } },
                { $inc: { hits: -1 } }
            );
        } catch (erro) {
            avisarQueda(erro);
        }
    }

    async resetKey(chave) {
        await this.memoria.resetKey(chave);
        if (!bancoPronto()) return;
        try {
            await RateLimitContador.collection.deleteOne({ _id: this.prefix + chave });
        } catch (erro) {
            avisarQueda(erro);
        }
    }
}

module.exports = StoreMongoRateLimit;
