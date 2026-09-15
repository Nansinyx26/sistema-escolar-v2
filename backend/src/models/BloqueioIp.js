const mongoose = require('mongoose');

/**
 * Tentativas falhas e bloqueio temporário de um IP num fluxo de autenticação.
 *
 * Um documento por `<escopo>:<chave do IP>`. Guarda duas coisas que precisam
 * mudar juntas, na mesma operação atômica:
 *   - o contador de falhas da janela atual (`falhas`, `janelaFimEm`);
 *   - o bloqueio e a reincidência (`bloqueadoAte`, `nivel`).
 *
 * NADA AQUI É PERMANENTE. `bloqueadoAte` sempre tem data, e o índice TTL em
 * `expiraEm` apaga o registro depois que o bloqueio acaba e a memória de
 * reincidência passa. O IP (dado pessoal) não fica guardado além disso.
 */
const BloqueioIpSchema = new mongoose.Schema(
    {
        _id: { type: String },
        escopo: { type: String, required: true },
        chave: { type: String, required: true },
        falhas: { type: Number, default: 0 },
        janelaFimEm: { type: Date, default: null },
        nivel: { type: Number, default: 0 },
        duracaoMs: { type: Number, default: 0 },
        bloqueadoAte: { type: Date, default: null },
        ultimoBloqueioEm: { type: Date, default: null },
        expiraEm: { type: Date, required: true },
    },
    {
        collection: 'bloqueios_ip',
        versionKey: false,
    }
);

BloqueioIpSchema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });
// Listagem do painel administrativo: só os bloqueios ativos.
BloqueioIpSchema.index({ bloqueadoAte: -1 });

module.exports = mongoose.models.BloqueioIp || mongoose.model('BloqueioIp', BloqueioIpSchema);
