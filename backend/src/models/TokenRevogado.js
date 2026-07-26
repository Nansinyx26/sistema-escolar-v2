const mongoose = require('mongoose');

/**
 * Denylist de tokens de sessão revogados (logout).
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * JWT é stateless: uma vez assinado, vale até `exp`. O logout antigo só fazia
 * `res.clearCookie` — que apenas PEDE ao browser para esquecer o cookie. O
 * token em si continuava perfeitamente válido pelas 8h restantes, e o
 * `authJWT` aceita token também via header `Authorization: Bearer`. Ou seja:
 * qualquer cópia do token (log de proxy, histórico de um terminal, máquina
 * compartilhada, XSS anterior) seguia autenticando DEPOIS do logout.
 *
 * Guardamos o `jti` do token revogado. O índice TTL em `expiraEm` limpa o
 * registro sozinho quando o token expiraria naturalmente — a coleção não
 * cresce sem limite.
 */
const TokenRevogadoSchema = new mongoose.Schema({
    jti: { type: String, required: true, unique: true, index: true },
    usuarioId: { type: String, index: true },
    // Momento em que o token expiraria por conta própria (vindo do claim `exp`).
    // Depois disso o registro é inútil: o jwt.verify já rejeita sozinho.
    expiraEm: { type: Date, required: true },
    revogadoEm: { type: Date, default: Date.now }
}, {
    collection: 'tokens_revogados'
});

// TTL: o Mongo remove o documento quando `expiraEm` passa.
TokenRevogadoSchema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.TokenRevogado
    || mongoose.model('TokenRevogado', TokenRevogadoSchema);
