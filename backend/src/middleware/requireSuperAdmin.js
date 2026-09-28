/**
 * requireSuperAdmin — só o gestor da rede passa (Issues #463 e #533).
 *
 * Gestor da rede = conta `perfil: 'admin'` (ver `ehSuperAdmin`). O perfil chega
 * do BANCO pelo authJWT (que precisa rodar antes), nunca do token — rebaixar
 * um admin vale na requisição seguinte.
 *
 * Diretor, secretaria, professor e responsável recebem 403.
 */
const authorize = require('./authorize');
const { ehSuperAdmin } = require('../services/escolaBloqueio');

const soAdmin = authorize('admin');

module.exports = function requireSuperAdmin(req, res, next) {
    return soAdmin(req, res, () => {
        if (!ehSuperAdmin(req.user)) {
            return res.status(403).json({
                success: false,
                codigo: 'SUPER_ADMIN_REQUERIDO',
                error: 'Acesso restrito ao super administrador do sistema.',
            });
        }
        return next();
    });
};
