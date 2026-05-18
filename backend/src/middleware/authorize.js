/**
 * Middleware para Controle de Acesso Baseado em Cargos (RBAC)
 * @param {...String} allowedProfiles - Perfis permitidos (admin, diretor, professor, coordenacao)
 */
module.exports = function authorize(...allowedProfiles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Usuário não autenticado' 
            });
        }

        const userProfile = req.user.perfil;

        // Admin tem acesso total sempre
        if (userProfile === 'admin') {
            return next();
        }

        if (allowedProfiles.includes(userProfile)) {
            return next();
        }

        return res.status(403).json({ 
            success: false, 
            error: `Acesso negado. Requer perfil: [${allowedProfiles.join(', ')}]` 
        });
    };
};
