const express = require('express');
const router = express.Router();
const Escola = require('../models/Escola');
const authJWT = require('../middleware/authJWT');
const { vinculosDoUsuario } = require('../middleware/filtrarPorEscola');
const { getRedirectPath } = require('../controllers/UserController');
const SecurityController = require('../controllers/SecurityController');
const Usuario = require('../models/Usuario');

// Perfis de equipe que possuem vínculo por escola (código secreto da escola)
const CARGO_MODEL = {
    professor: () => require('../models/Professor'),
    diretor: () => require('../models/Diretor'),
    secretaria: () => require('../models/Secretaria'),
};

/**
 * GET /api/escolas?tipo=Todas|EMEF|CIEP
 * Pública — alimenta o modal "Escolas em Americana" da landing page.
 * NUNCA expõe codigoSecreto (select:false no schema + projeção explícita).
 */
router.get('/', async (req, res) => {
    try {
        const { tipo } = req.query;
        const filtro = {};
        if (tipo && tipo !== 'Todas' && ['EMEF', 'CIEP'].includes(tipo)) filtro.tipo = tipo;

        const escolas = await Escola.find(filtro)
            .select('nome tipo endereco bairro municipio ativo')
            .sort({ tipo: 1, nome: 1 })
            .lean();

        res.json({ success: true, data: escolas });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /api/escolas/minhas
 * Autenticada — escolas vinculadas ao usuário logado (sidebar de troca).
 */
router.get('/minhas', authJWT, async (req, res) => {
    try {
        const vinculos = await vinculosDoUsuario(req.user);
        const ids = vinculos.map(v => v.escolaId);
        const escolas = ids.length
            ? await Escola.find({ _id: { $in: ids } }).select('nome tipo bairro ativo').lean()
            : [];
        res.json({
            success: true,
            data: escolas,
            escolaAtivaId: (req.session && req.session.escolaAtivaId) || null
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/escolas/trocar/:escolaId
 * Autenticada — troca a escola ativa da sessão (botão lateral).
 * Verifica vínculo (403 se não tiver) e devolve o redirect do cargo atual.
 */
router.post('/trocar/:escolaId', authJWT, async (req, res) => {
    try {
        const { escolaId } = req.params;

        const escola = await Escola.findById(escolaId).select('nome ativo').lean();
        if (!escola) return res.status(404).json({ success: false, error: 'Escola não encontrada.' });
        if (!escola.ativo) return res.status(403).json({ success: false, error: 'Esta escola ainda não está disponível no sistema.' });

        // Admin transita livremente; demais perfis precisam de vínculo
        if (req.user.perfil !== 'admin') {
            const vinculos = await vinculosDoUsuario(req.user);
            const temVinculo = vinculos.some(v => String(v.escolaId) === String(escolaId));
            if (!temVinculo) {
                return res.status(403).json({
                    success: false,
                    error: `Você não possui vínculo com a escola "${escola.nome}". Solicite acesso à direção.`
                });
            }
        }

        req.session.escolaAtivaId = String(escolaId);
        req.session.usuarioId = String(req.user.id || req.user._id);

        res.json({
            success: true,
            message: `Agora você está operando em: ${escola.nome}`,
            escolaAtivaId: String(escolaId),
            redirect_to: getRedirectPath(req.user)
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/escolas/mudar
 * Autenticada — MUDA a escola do usuário de equipe (professor/diretor/secretaria)
 * quando ele passa a trabalhar em outra escola. Valida pelo CÓDIGO SECRETO da
 * nova escola (mesma prova de vínculo usada no cadastro), cria o vínculo se não
 * existir, atualiza o escolaId da conta e ativa a nova escola na sessão.
 *
 * Body: { codigoEscola, escolaId? }
 */
router.post('/mudar', authJWT, async (req, res) => {
    try {
        const perfil = req.user?.perfil;
        const loader = CARGO_MODEL[perfil];
        if (!loader) {
            return res.status(403).json({
                success: false,
                error: 'Apenas professor, diretor ou secretaria podem trocar de escola por aqui.'
            });
        }

        const { codigoEscola, escolaId } = req.body || {};
        if (!codigoEscola) {
            return res.status(400).json({ success: false, error: 'Informe o código secreto da nova escola.' });
        }

        // 1. Valida o código secreto (por escola quando escolaId presente)
        const codeResult = await SecurityController.validateCode(codigoEscola, escolaId || null);
        if (!codeResult) {
            return res.status(403).json({ success: false, error: 'Código secreto da escola inválido ou expirado.' });
        }
        const escola = codeResult.escola;
        if (!escola || !escola._id) {
            return res.status(400).json({ success: false, error: 'Nenhuma escola cadastrada corresponde a este código.' });
        }
        const novaEscolaId = String(escola._id);

        // 2. Atualiza o vínculo no documento do cargo (cria se não existir)
        const Model = loader();
        const doc = await Model.findOne({
            $or: [{ idUsuario: String(req.user.id || req.user._id) }, { email: req.user.email }]
        });
        if (doc) {
            doc.vinculos = Array.isArray(doc.vinculos) ? doc.vinculos : [];
            const jaTem = doc.vinculos.some(v => String(v.escolaId) === novaEscolaId);
            if (!jaTem) doc.vinculos.push({ escolaId: novaEscolaId, cargo: perfil });
            doc.escola = escola.nome; // nome legível
            await doc.save();
        }

        // 3. Atualiza o escolaId da conta (usado por filtros/notificações)
        await Usuario.updateOne(
            { $or: [{ _id: req.user.id || req.user._id }, { email: req.user.email }] },
            { $set: { escolaId: novaEscolaId, escola: escola.nome } }
        );

        // 4. Ativa a nova escola na sessão
        if (req.session) {
            req.session.escolaAtivaId = novaEscolaId;
            req.session.usuarioId = String(req.user.id || req.user._id);
        }

        res.json({
            success: true,
            message: `Escola atualizada para: ${escola.nome}`,
            escolaAtivaId: novaEscolaId,
            escolaNome: escola.nome,
            redirect_to: getRedirectPath(req.user)
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

module.exports = router;
