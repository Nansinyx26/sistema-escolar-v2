const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../utils/jwtConfig');
const Usuario = require('../models/Usuario');

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
        
        // Verificação de invalidação de sessão (Check de Alteração de Senha)
        const user = await Usuario.findById(decoded.id || decoded._id).select('tokenVersion').lean();
        const userTokenVersion = (user && user.tokenVersion !== undefined) ? user.tokenVersion : 0;
        const decodedTokenVersion = decoded.tokenVersion !== undefined ? decoded.tokenVersion : 0;
        if (!user || userTokenVersion !== decodedTokenVersion) {
            return res.status(401).json({ success: false, error: 'Sessão expirada ou senha alterada. Faça login novamente.' });
        }

        req.user = decoded;
        next();
    } catch (e) {
        return res.status(401).json({ success: false, error: 'Token inválido ou expirado' });
    }
};
