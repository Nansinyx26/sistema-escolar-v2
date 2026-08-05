/**
 * assertAcessoAoAluno — ponto único de autorização para qualquer rota que
 * receba um identificador de aluno (`:alunoId`, `:id`, body.alunoId).
 *
 * Regras, por perfil:
 *   admin        → acesso total;
 *   diretor      → alunos da escola ativa (req.escolaId);
 *   secretaria   → alunos da escola ativa (req.escolaId);
 *   professor    → alunos da escola ativa E de uma turma em req.allowedTurmas;
 *   responsavel  → apenas alunos vinculados ao seu e-mail;
 *   aluno        → apenas o próprio registro.
 *
 * Deve rodar DEPOIS de authJWT (usa req.user), e idealmente depois de
 * horizontalFilter (req.allowedTurmas) e filtrarPorEscola (req.escolaId).
 */
const mongoose = require('mongoose');
const Aluno = require('../models/Aluno');
const escapeRegex = require('../utils/escapeRegex');

const PERFIS_GESTAO = ['admin', 'diretor', 'secretaria'];

/** Monta um filtro que aceita _id, id legado ou matrícula sem quebrar em CastError. */
function buildAlunoQuery(alunoId) {
    const valor = String(alunoId);
    const or = [{ id: valor }, { matricula: valor }];
    if (mongoose.Types.ObjectId.isValid(valor)) or.unshift({ _id: valor });
    return { $or: or };
}

/** Normaliza a turma do aluno para comparação com req.allowedTurmas. */
function normalizarTurma(t) {
    return String(t || '').replace('º', '').toUpperCase();
}

/** true se o e-mail informado consta como responsável do aluno. */
function ehResponsavelDoAluno(aluno, email) {
    if (!email) return false;
    const alvo = String(email).toLowerCase();
    if (String(aluno.responsavel || '').toLowerCase() === alvo) return true;
    if (String(aluno.responsavelDados?.email || '').toLowerCase() === alvo) return true;
    if (Array.isArray(aluno.responsaveis)) {
        return aluno.responsaveis.some(r => String(r?.email || '').toLowerCase() === alvo);
    }
    return false;
}

/**
 * Verifica se req.user pode acessar o aluno informado.
 *
 * @param {import('express').Request} req
 * @param {string} alunoId
 * @param {Object} [opts]
 * @param {Object} [opts.aluno] documento já carregado (evita nova query)
 * @returns {Promise<{ok: boolean, status?: number, error?: string, aluno?: Object}>}
 */
async function assertAcessoAoAluno(req, alunoId, opts = {}) {
    const user = req.user;
    if (!user) return { ok: false, status: 401, error: 'Usuário não autenticado.' };
    if (!alunoId) return { ok: false, status: 400, error: 'Identificador do aluno é obrigatório.' };

    const aluno = opts.aluno || await Aluno.findOne(buildAlunoQuery(alunoId)).lean();
    if (!aluno) return { ok: false, status: 404, error: 'Aluno não encontrado.' };

    const perfil = String(user.perfil || '').toLowerCase();

    // Admin: acesso irrestrito (suporte/manutenção da rede).
    if (perfil === 'admin') return { ok: true, aluno };

    // Multi-escola: ninguém, fora o admin, cruza a fronteira da escola ativa.
    if (req.escolaId && aluno.escolaId && String(aluno.escolaId) !== String(req.escolaId)) {
        return { ok: false, status: 403, error: 'Este aluno pertence a outra escola.' };
    }

    if (PERFIS_GESTAO.includes(perfil)) return { ok: true, aluno };

    if (perfil === 'professor') {
        const permitidas = (req.allowedTurmas || []).map(normalizarTurma);
        const turmaAluno = normalizarTurma(aluno.turma || aluno.turmaId);
        if (!turmaAluno || !permitidas.includes(turmaAluno)) {
            return { ok: false, status: 403, error: 'Acesso negado. Aluno fora das suas turmas.' };
        }
        return { ok: true, aluno };
    }

    if (perfil === 'responsavel') {
        if (!ehResponsavelDoAluno(aluno, user.email)) {
            return { ok: false, status: 403, error: 'Acesso negado. Aluno não vinculado à sua conta.' };
        }
        return { ok: true, aluno };
    }

    if (perfil === 'aluno') {
        const proprio = [aluno._id, aluno.id].filter(Boolean).map(String);
        const meuId = String(user.alunoId || user.id || user._id || '');
        const meuEmail = String(user.email || '').toLowerCase();
        if (proprio.includes(meuId) || (meuEmail && String(aluno.email || '').toLowerCase() === meuEmail)) {
            return { ok: true, aluno };
        }
        return { ok: false, status: 403, error: 'Acesso negado.' };
    }

    return { ok: false, status: 403, error: 'Acesso negado.' };
}

/**
 * Versão middleware: bloqueia a request e injeta req.alunoAutorizado.
 * @param {string} [param='alunoId'] nome do parâmetro de rota
 */
function requireAcessoAoAluno(param = 'alunoId') {
    return async (req, res, next) => {
        try {
            const alunoId = req.params[param] || req.body?.[param];
            const resultado = await assertAcessoAoAluno(req, alunoId);
            if (!resultado.ok) {
                return res.status(resultado.status).json({ success: false, error: resultado.error });
            }
            req.alunoAutorizado = resultado.aluno;
            next();
        } catch (e) {
            console.error('[assertAcessoAoAluno] erro:', e.message);
            res.status(500).json({ success: false, error: 'Erro na verificação de acesso ao aluno.' });
        }
    };
}

/** Regex ancorada e escapada para casar e-mail sem interpretar metacaracteres. */
function emailExatoRegex(email) {
    return new RegExp(`^${escapeRegex(String(email))}$`, 'i');
}

module.exports = assertAcessoAoAluno;
module.exports.assertAcessoAoAluno = assertAcessoAoAluno;
module.exports.requireAcessoAoAluno = requireAcessoAoAluno;
module.exports.buildAlunoQuery = buildAlunoQuery;
module.exports.emailExatoRegex = emailExatoRegex;
module.exports.ehResponsavelDoAluno = ehResponsavelDoAluno;
