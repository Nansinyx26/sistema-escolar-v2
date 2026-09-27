/**
 * RestricaoAcessoController — bloqueio de acesso de um responsável por decisão
 * judicial, controlado pela gestão da escola do aluno (Issue #491).
 *
 * A regra de acesso está em `utils/restricaoAcesso.js`; aqui só se marca e
 * desmarca. Cada mudança vai ao AuditLog com antes e depois (quantidade de
 * restrições) e o e-mail mascarado. Nenhum texto livre é aceito: a decisão
 * judicial fica arquivada na secretaria, não no sistema.
 */
const Aluno = require('../models/Aluno');
const Usuario = require('../models/Usuario');
const escapeRegex = require('../utils/escapeRegex');
const assertAcessoAoAluno = require('../middleware/assertAcessoAoAluno');
const { logAction } = require('../utils/auditHelper');
const { maskEmail } = require('../utils/logSanitizer');
const { normalizarEmail } = require('../utils/restricaoAcesso');
const logger = require('../utils/logger');

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Aluno da escola de quem pede, ou a resposta de recusa já enviada. */
async function alunoDaGestao(req, res) {
    const acesso = await assertAcessoAoAluno(req, req.params.id);
    if (!acesso.ok) {
        res.status(acesso.status).json({ success: false, error: acesso.error });
        return null;
    }
    const aluno = await Aluno.findById(acesso.aluno?._id || req.params.id);
    if (!aluno) {
        res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        return null;
    }
    return aluno;
}

function emailDoCorpo(req, res) {
    const email = normalizarEmail(req.body?.email);
    if (!EMAIL_VALIDO.test(email)) {
        res.status(400).json({ success: false, error: 'Informe um e-mail válido.' });
        return null;
    }
    return email;
}

/**
 * Encerra sessões e conexões em tempo real da conta com este e-mail. As
 * rotas HTTP já recusam na próxima requisição, mas as salas do socket foram
 * calculadas no login — sem isto, a pessoa bloqueada seguiria recebendo os
 * avisos da turma até reconectar.
 */
async function encerrarSessoesDe(email) {
    try {
        const exato = new RegExp(`^${escapeRegex(email)}$`, 'i');
        await Usuario.updateMany({ email: exato }, { $inc: { tokenVersion: 1 } });
        if (global.io?.fetchSockets) {
            const sockets = await global.io.fetchSockets();
            for (const s of sockets) {
                if (normalizarEmail(s.user?.email) === email) s.disconnect(true);
            }
        }
    } catch (err) {
        logger.error('[RestricaoAcesso] Falha ao encerrar sessões', {
            err,
            action: 'restricao.encerrarSessoes',
        });
    }
}

/** GET /api/secretaria/alunos/:id/restricoes-acesso */
exports.listar = async (req, res) => {
    try {
        const aluno = await alunoDaGestao(req, res);
        if (!aluno) return;
        const data = (aluno.restricoesAcesso || []).map((r) => ({
            email: r.email,
            motivo: r.motivo,
            registradoEm: r.registradoEm,
        }));
        return res.json({ success: true, data });
    } catch {
        return res.status(500).json({ success: false, error: 'Erro ao consultar as restrições.' });
    }
};

/** POST /api/secretaria/alunos/:id/restricoes-acesso  { email, confirmacao: true } */
exports.incluir = async (req, res) => {
    try {
        const email = emailDoCorpo(req, res);
        if (!email) return;
        if (req.body?.confirmacao !== true) {
            return res.status(400).json({
                success: false,
                codigo: 'CONFIRMACAO_OBRIGATORIA',
                error: 'Confirme que a decisão judicial está arquivada na secretaria.',
            });
        }

        const aluno = await alunoDaGestao(req, res);
        if (!aluno) return;

        const antes = (aluno.restricoesAcesso || []).length;
        if ((aluno.restricoesAcesso || []).some((r) => r.email === email)) {
            return res.json({
                success: true,
                message: 'Este e-mail já está bloqueado para o aluno.',
            });
        }

        aluno.restricoesAcesso = [
            ...(aluno.restricoesAcesso || []),
            {
                email,
                motivo: 'decisao_judicial',
                registradoPor: String(req.user.id || req.user._id),
                registradoEm: new Date(),
            },
        ];
        await aluno.save();

        await logAction(req, 'ACESSO_RESPONSAVEL_BLOQUEADO', 'Aluno', {
            recursoId: String(aluno._id),
            valorAnterior: { restricoes: antes },
            valorNovo: { restricoes: antes + 1 },
            descricao: `Acesso de ${maskEmail(email)} ao aluno ${aluno._id} bloqueado por decisão judicial.`,
        });

        await encerrarSessoesDe(email);

        return res.status(201).json({ success: true, message: 'Acesso bloqueado.' });
    } catch {
        return res.status(500).json({ success: false, error: 'Erro ao bloquear o acesso.' });
    }
};

/** POST /api/secretaria/alunos/:id/restricoes-acesso/remover  { email } */
exports.retirar = async (req, res) => {
    try {
        const email = emailDoCorpo(req, res);
        if (!email) return;
        const aluno = await alunoDaGestao(req, res);
        if (!aluno) return;

        const antes = (aluno.restricoesAcesso || []).length;
        const restantes = (aluno.restricoesAcesso || []).filter((r) => r.email !== email);
        if (restantes.length === antes) {
            return res
                .status(404)
                .json({ success: false, error: 'Este e-mail não está bloqueado.' });
        }
        aluno.restricoesAcesso = restantes;
        await aluno.save();

        await logAction(req, 'ACESSO_RESPONSAVEL_DESBLOQUEADO', 'Aluno', {
            recursoId: String(aluno._id),
            valorAnterior: { restricoes: antes },
            valorNovo: { restricoes: restantes.length },
            descricao: `Bloqueio de ${maskEmail(email)} ao aluno ${aluno._id} retirado.`,
        });

        return res.json({ success: true, message: 'Bloqueio retirado.' });
    } catch {
        return res.status(500).json({ success: false, error: 'Erro ao retirar o bloqueio.' });
    }
};
