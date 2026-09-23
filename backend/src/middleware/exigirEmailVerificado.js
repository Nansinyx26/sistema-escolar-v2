/**
 * exigirEmailVerificado — porta do portal do responsável (Issue #412).
 *
 * A ficha do aluno aponta para um e-mail; quem prova ter aquela caixa postal
 * é quem vê os dados. Conta anterior ao marco da mudança não é afetada — ver
 * `services/verificacaoEmail.js`.
 */
const { contaPrecisaConfirmar } = require('../services/verificacaoEmail');

async function exigirEmailVerificado(req, res, next) {
    try {
        if (!req.user) return next();
        if (await contaPrecisaConfirmar(req.user.id || req.user._id)) {
            return res.status(403).json({
                success: false,
                codigo: 'EMAIL_NAO_VERIFICADO',
                error: 'Confirme seu e-mail para acessar os dados do aluno. Enviamos um link para o endereço do seu cadastro.',
            });
        }
        return next();
    } catch (e) {
        // Falha ao consultar a conta não pode virar acesso liberado.
        return res.status(500).json({ success: false, error: 'Erro ao conferir o cadastro.' });
    }
}

module.exports = exigirEmailVerificado;
