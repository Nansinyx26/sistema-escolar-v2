/**
 * requireSuperAdmin — só o administrador GLOBAL passa (Issue #463).
 *
 * Reaproveita o RBAC de `authorize('admin')` e acrescenta a única coisa que o
 * separa do admin comum: `superAdmin: true` na conta. Os dois valores chegam do
 * BANCO pelo authJWT (que precisa rodar antes), nunca do token — rebaixar um
 * super admin vale na requisição seguinte.
 *
 * Admin comum, diretor, secretaria, professor e responsável recebem 403.
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
