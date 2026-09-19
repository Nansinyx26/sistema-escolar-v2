/**
 * ConviteEquipeController — o admin convida direção e secretaria (Issue #386).
 *
 * Rotas em /api/admin/convites-equipe, atrás de authJWT + authorize('admin').
 * O aceite (público, por token) fica no UserController, junto dos outros
 * cadastros, porque reusa as mesmas validações de senha e de consentimento.
 */
const mongoose = require('mongoose');
const ConviteEquipe = require('../models/ConviteEquipe');
const Escola = require('../models/Escola');
const Usuario = require('../models/Usuario');
const convites = require('../services/convitesEquipe');
const { logAction } = require('../utils/auditHelper');
const logger = require('../utils/logger');

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PAGINA_DO_PERFIL = {
    diretor: 'cadastro-diretor-publico.html',
    secretaria: 'cadastro-secretaria-publico.html',
};

/**
 * O token vai no FRAGMENTO (`#convite=`): o navegador não envia o fragmento ao
 * servidor nem o repassa no Referer, então ele não aparece em log de acesso de
 * nenhum servidor no caminho.
 */
function montarLink(req, perfil, token) {
    const base = (process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`).replace(
        /\/+$/,
        ''
    );
    return `${base}/html/pages/${PAGINA_DO_PERFIL[perfil]}#convite=${token}`;
}

function htmlDoConvite(perfil, escolaNome, link, expiraEm) {
    const cargo = perfil === 'diretor' ? 'direção' : 'secretaria';
    const prazo = expiraEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return `
        <div style="font-family:Arial,sans-serif;max-width:520px;padding:24px;border:1px solid #e5e7eb;border-radius:8px;">
            <h2 style="margin-top:0;">Convite para o Sistema Escolar</h2>
            <p>Você foi convidado(a) a criar sua conta de <strong>${cargo}</strong> da escola <strong>${escolaNome}</strong>.</p>
            <p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#1a56db;color:#fff;text-decoration:none;border-radius:6px;">Criar minha conta</a></p>
            <p style="color:#555;font-size:13px;">O link vale uma única vez, até ${prazo}. Se você não esperava este convite, ignore este e-mail.</p>
        </div>`;
}

function resumo(c) {
    return {
        id: String(c._id),
        email: c.email,
        perfil: c.perfil,
        escolaId: c.escolaId,
        criadoEm: c.createdAt,
        expiraEm: c.expiraEm,
        usadoEm: c.usadoEm,
        revogadoEm: c.revogadoEm,
        situacao: convites.situacao(c),
    };
}

// POST /api/admin/convites-equipe
exports.criar = async (req, res) => {
    try {
        const email = String(req.body?.email || '')
            .trim()
            .toLowerCase();
        const perfil = String(req.body?.perfil || '');
        const escolaId = String(req.body?.escolaId || '');

        if (!EMAIL_VALIDO.test(email)) {
            return res.status(400).json({ success: false, error: 'E-mail inválido.' });
        }
        if (!convites.PERFIS_CONVIDAVEIS.includes(perfil)) {
            return res
                .status(400)
                .json({ success: false, error: 'Perfil deve ser diretor ou secretaria.' });
        }
        if (!mongoose.Types.ObjectId.isValid(escolaId)) {
            return res.status(400).json({ success: false, error: 'Escola inválida.' });
        }
        const escola = await Escola.findById(escolaId).select('nome').lean();
        if (!escola) {
            return res.status(404).json({ success: false, error: 'Escola não encontrada.' });
        }
        if (await Usuario.exists({ email })) {
            return res.status(409).json({
                success: false,
                error: 'Já existe conta com este e-mail. Ajuste o perfil em Usuários.',
            });
        }

        const criadoPor = String(req.user?.id || req.user?._id || '');
        const { convite, token } = await convites.criarConvite({
            email,
            perfil,
            escolaId,
            criadoPor,
        });
        const link = montarLink(req, perfil, token);

        let emailEnviado = false;
        if (process.env.NODE_ENV !== 'test') {
            const { enviarEmail } = require('../services/EnvioEmail');
            const envio = await enviarEmail(
                email,
                'Convite para criar sua conta — Sistema Escolar',
                htmlDoConvite(perfil, escola.nome, link, convite.expiraEm)
            );
            emailEnviado = !!envio?.ok;
            if (!emailEnviado) {
                logger.warn('[Convite] E-mail do convite não foi entregue', {
                    conviteId: String(convite._id),
                    action: 'convite.envioFalhou',
                });
            }
        }

        await logAction(req, 'CONVITE_EQUIPE_CRIADO', 'Segurança', {
            recursoId: String(convite._id),
            valorNovo: { perfil, escolaId },
            descricao: `Convite de ${perfil} criado para a escola ${escolaId} (convite ${convite._id}).`,
        });

        // O link sai aqui uma única vez: o banco só tem o hash e não consegue
        // reconstruí-lo. Serve para o admin entregar em mãos se o e-mail falhar.
        return res.status(201).json({
            success: true,
            data: { ...resumo(convite.toObject()), link, emailEnviado },
        });
    } catch (error) {
        logger.error('[Convite] Falha ao criar convite', { err: error, action: 'convite.criar' });
        return res.status(500).json({ success: false, error: 'Erro ao criar convite.' });
    }
};

// GET /api/admin/convites-equipe
exports.listar = async (_req, res) => {
    try {
        const lista = await ConviteEquipe.find({})
            .select('-tokenHash')
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();
        return res.json({ success: true, data: lista.map(resumo) });
    } catch (error) {
        logger.error('[Convite] Falha ao listar convites', {
            err: error,
            action: 'convite.listar',
        });
        return res.status(500).json({ success: false, error: 'Erro ao listar convites.' });
    }
};

// DELETE /api/admin/convites-equipe/:id
exports.revogar = async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ success: false, error: 'Convite não encontrado.' });
        }
        const revogadoPor = String(req.user?.id || req.user?._id || '');
        const convite = await ConviteEquipe.findOneAndUpdate(
            { _id: req.params.id, usadoEm: null, revogadoEm: null },
            { $set: { revogadoEm: new Date(), revogadoPor } },
            { new: true }
        ).lean();
        if (!convite) {
            return res
                .status(409)
                .json({ success: false, error: 'Convite inexistente, já usado ou já revogado.' });
        }
        await logAction(req, 'CONVITE_EQUIPE_REVOGADO', 'Segurança', {
            recursoId: String(convite._id),
            descricao: `Convite ${convite._id} revogado.`,
        });
        return res.json({ success: true, data: resumo(convite) });
    } catch (error) {
        logger.error('[Convite] Falha ao revogar convite', {
            err: error,
            action: 'convite.revogar',
        });
        return res.status(500).json({ success: false, error: 'Erro ao revogar convite.' });
    }
};
