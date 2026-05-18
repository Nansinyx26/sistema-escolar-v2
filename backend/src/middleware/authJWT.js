const jwt = require('jsonwebtoken');
const JWT_SECRET = require('../utils/jwtConfig');

module.exports = function authJWT(req, res, next) {
    // Tenta obter o token do cookie primeiro, depois do header Authorization
    const token = req.cookies.escola_jwt || (req.headers.authorization && req.headers.authorization.startsWith('Bearer ') 
        ? req.headers.authorization.split(' ')[1] 
        : null);

    if (!token) {
        return res.status(401).json({ success: false, error: 'Token de acesso necessário' });
    }
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (e) {
        return res.status(401).json({ success: false, error: 'Token inválido ou expirado' });
    }
};
