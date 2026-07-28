const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../utils/jwtConfig');
const Usuario = require('../models/Usuario');
const { tokenEstaRevogado } = require('../utils/sessionToken');
const logger = require('../utils/logger');
const logContext = require('../utils/logContext');

module.exports = async function authJWT(req, res, next) {
    // Tenta obter o token do cookie primeiro, depois do header Authorization
    let token = req.cookies.escola_jwt;
    if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        const parts = req.headers.authorization.split(' ');
        if (parts[1] && parts[1] !== 'null' && parts[1] !== 'undefined') {
            token = parts[1];
        }
    }

    if (!token) {
        // PERMISSÃO ESPECIAL EM DESENVOLVIMENTO para o serviço de voz
        if (process.env.NODE_ENV === 'development' && (req.path === '/api/tts' || req.baseUrl === '/api/tts')) {
            req.user = { id: 'dev-user', nome: 'Dev User', perfil: 'diretor' };
            return next();
        }
        return res.status(401).json({ success: false, error: 'Token de acesso necessário' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // Um token de propósito diferente (ex.: o 'pre-auth' de 5 min do fluxo
        // 2FA) é assinado com o MESMO segredo e passaria no verify acima. Sem
        // esta checagem, o token intermediário do 2FA autenticava sessão
        // completa — pulando o segundo fator inteiro.
        if (decoded.purpose && decoded.purpose !== 'session') {
            return res.status(401).json({ success: false, error: 'Token inválido para esta operação' });
        }

        // LOGOUT REAL: `clearCookie` só pede ao browser para esquecer o cookie —
        // o token continuava válido até `exp` e o header Authorization aceitava
        // a cópia. A denylist por `jti` mata a sessão no servidor.
        if (await tokenEstaRevogado(decoded)) {
            return res.status(401).json({ success: false, error: 'Sessão encerrada. Faça login novamente.' });
        }

        // Verificação de invalidação de sessão (senha alterada, conta removida)
        const user = await Usuario.findById(decoded.id || decoded._id)
            .select('tokenVersion ativo perfil')
            .lean();

        const userTokenVersion = (user && user.tokenVersion !== undefined) ? user.tokenVersion : 0;
        const decodedTokenVersion = decoded.tokenVersion !== undefined ? decoded.tokenVersion : 0;
        if (!user || userTokenVersion !== decodedTokenVersion) {
            return res.status(401).json({ success: false, error: 'Sessão expirada ou senha alterada. Faça login novamente.' });
        }

        // Conta desativada/anonimizada perde o acesso IMEDIATAMENTE. Antes só
        // tokenVersion era comparado: um usuário desligado seguia operando com
        // o cookie até ele expirar (8h).
        if (user.ativo === false) {
            return res.status(401).json({ success: false, error: 'Conta desativada. Procure a administração da escola.' });
        }

        // O perfil vem do BANCO, não do token: um rebaixamento de privilégio
        // passa a valer na requisição seguinte, sem esperar novo login.
        req.user = { ...decoded, perfil: user.perfil };

        // A partir daqui todo log da requisição sai identificado.
        logContext.set({
            userId: String(decoded.id || decoded._id || ''),
            perfil: user.perfil,
            escolaId: decoded.escolaId ? String(decoded.escolaId) : undefined,
        });

        next();
    } catch (e) {
        // O cliente recebe sempre a mesma mensagem (não revela qual token falhou),
        // mas o motivo real precisa existir no log: sem isso, um pico de 401 é
        // indistinguível entre expiração normal, relógio dessincronizado e
        // segredo JWT trocado num deploy.
        logger.warn('Falha na verificação do JWT', {
            reason: e.name === 'TokenExpiredError' ? 'expirado'
                : e.name === 'JsonWebTokenError' ? 'assinatura_invalida'
                : 'erro_inesperado',
            errName: e.name,
        });
        return res.status(401).json({ success: false, error: 'Token inválido ou expirado' });
    }
};
