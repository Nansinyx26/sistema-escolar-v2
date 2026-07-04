const express = require('express');
const router = express.Router();
const Escola = require('../models/Escola');
const authJWT = require('../middleware/authJWT');
const { vinculosDoUsuario } = require('../middleware/filtrarPorEscola');
const { getRedirectPath } = require('../controllers/UserController');

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

module.exports = router;
