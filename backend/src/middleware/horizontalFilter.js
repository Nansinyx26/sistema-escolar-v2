const Professor = require('../models/Professor');
const { turmasDoProfessorNaEscola } = require('../services/turmasDoProfessor');

/**
 * Middleware para injetar filtros de segurança baseados no perfil do usuário.
 * Para professores, identifica quais turmas eles têm permissão para acessar.
 *
 * Roda DEPOIS do `filtrarPorEscola` (Issue #707): as turmas são as do
 * professor NA ESCOLA ATIVA (`req.escolaId`). Antes ele rodava primeiro e
 * juntava as turmas de todas as escolas do professor — com a escola B ativa, a
 * "1A" que ele dá em A liberava a "1A" de B. `horizontalFilterOrdem.test.js`
 * trava a ordem nas montagens de `routes/api.js`.
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
            const prof = await Professor.findOne({
                idUsuario: String(req.user.id || req.user._id),
            }).lean();

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

                // Só as turmas desta escola (salaPrincipal + salasAdicionais +
                // turmas da escola do cadastro, ou as do vínculo adicional).
                turmasDoProfessorNaEscola(prof, req.escolaId).forEach(addTurma);

                req.allowedTurmas = Array.from(turmasSet);
            }

            // Injeta o filtro na requisição para ser usado nos controllers
            req.horizontalFilter = {
                $or: [
                    { turma: { $in: req.allowedTurmas } },
                    { turmaId: { $in: req.allowedTurmas } },
                ],
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
