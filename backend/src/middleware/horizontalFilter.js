const Professor = require('../models/Professor');

/**
 * Middleware para injetar filtros de segurança baseados no perfil do usuário.
 * Para professores, identifica quais turmas eles têm permissão para acessar.
 */
module.exports = async function horizontalFilter(req, res, next) {
    // Se não houver usuário autenticado, segue (authJWT deve lidar com isso antes)
    if (!req.user) return next();

    // Administradores e Diretores têm acesso total
    if (req.user.perfil === 'admin' || req.user.perfil === 'diretor') {
        return next();
    }

    // Filtro para Professores
    if (req.user.perfil === 'professor') {
        try {
            // Busca o cadastro do professor para ver suas turmas atribuídas
            const prof = await Professor.findOne({ email: req.user.email }).lean();
            
            if (!prof) {
                // Se for professor mas não tiver cadastro de professor (estranho), bloqueia tudo
                req.allowedTurmas = [];
            } else {
                // Consolida turmas: salaPrincipal + salasAdicionais + turmas (array helper)
                const turmasSet = new Set();
                const addTurma = (t) => {
                    if (!t) return;
                    turmasSet.add(t);
                    // Normalização: se for "1ºC", adiciona "1C". Se for "1C", adiciona "1ºC"
                    const norm = t.replace('º', '');
                    turmasSet.add(norm);
                    if (norm.length >= 2) {
                        const withSymbol = `${norm[0]}º${norm.slice(1)}`;
                        turmasSet.add(withSymbol);
                    }
                };

                if (prof.salaPrincipal) addTurma(prof.salaPrincipal);
                if (prof.salasAdicionais && Array.isArray(prof.salasAdicionais)) {
                    prof.salasAdicionais.forEach(t => addTurma(t));
                }
                if (prof.turmas && Array.isArray(prof.turmas)) {
                    prof.turmas.forEach(t => addTurma(t));
                }
                
                req.allowedTurmas = Array.from(turmasSet);
            }
            
            // Injeta o filtro na requisição para ser usado nos controllers
            req.horizontalFilter = {
                $or: [
                    { turma: { $in: req.allowedTurmas } },
                    { turmaId: { $in: req.allowedTurmas } }
                ]
            };
            
            next();
        } catch (error) {
            console.error('Erro no horizontalFilter:', error);
            res.status(500).json({ success: false, error: 'Erro de autorização horizontal' });
        }
    } else {
        next();
    }
};
