const mongoose = require('mongoose');
const AvaliacaoSistema = require('../models/AvaliacaoSistema');
const Usuario = require('../models/Usuario');
const SiteReview = require('../models/SiteReview');
const { logAction } = require('../utils/auditHelper');
const {
    FILTRO_PAGINA_INICIAL,
    avaliacaoParaPublico,
    aderiu,
} = require('../utils/avaliacaoPublica');

/**
 * Avaliações do sistema (Issue #489).
 *
 * A página inicial é pública: nada de nome completo, foto ou id da conta. A
 * avaliação só aparece lá se a pessoa escolheu aparecer (`exibirPublicamente`)
 * e a administração aprovou (`moderacao`). Mudar o texto devolve a avaliação
 * para revisão — a aprovação vale para o texto que foi lido.
 */
exports.create = async (req, res) => {
    try {
        const { estrelas, texto } = req.body;
        const exibirPublicamente = aderiu(req.body.exibirPublicamente);
        const usuarioId = req.user.id || req.user._id;

        if (!estrelas || !texto) {
            return res
                .status(400)
                .json({ success: false, error: 'Estrelas e texto são obrigatórios.' });
        }

        const usuario = await Usuario.findById(usuarioId).select('nome perfil').lean();
        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        const avaliacaoExistente = await AvaliacaoSistema.findOne({ usuarioId });
        if (avaliacaoExistente) {
            const textoMudou = avaliacaoExistente.texto !== texto;
            avaliacaoExistente.estrelas = estrelas;
            avaliacaoExistente.texto = texto;
            avaliacaoExistente.exibirPublicamente = exibirPublicamente;
            // A foto não é mais guardada: nenhuma saída a usa.
            avaliacaoExistente.foto = '';
            avaliacaoExistente.dataCriacao = Date.now();
            if (textoMudou || !avaliacaoExistente.moderacao) {
                avaliacaoExistente.moderacao = 'pendente';
                avaliacaoExistente.moderadoPor = undefined;
                avaliacaoExistente.moderadoEm = undefined;
            }
            await avaliacaoExistente.save();
            return res
                .status(200)
                .json({ success: true, message: 'Avaliação atualizada com sucesso!' });
        }

        const avaliacao = new AvaliacaoSistema({
            usuarioId,
            nome: usuario.nome,
            perfil: usuario.perfil,
            estrelas,
            texto,
            exibirPublicamente,
            moderacao: 'pendente',
        });

        await avaliacao.save();
        res.status(201).json({ success: true, message: 'Avaliação enviada com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/** SiteReview (avaliação feita pelo painel) na forma de AvaliacaoSistema. */
function siteReviewComoAvaliacao(r) {
    return {
        _id: r._id,
        nome: r.userName,
        perfil: r.userType,
        estrelas: r.rating,
        texto: r.comment,
        dataCriacao: r.updatedAt || r.createdAt,
    };
}

/**
 * GET /api/avaliacoes/public — página inicial, sem login.
 * Só aderidas e aprovadas; iniciais em vez de nome; sem foto e sem id da conta.
 */
exports.getPublic = async (_req, res) => {
    try {
        const [avaliacoes, siteReviews] = await Promise.all([
            AvaliacaoSistema.find({ ativo: { $ne: false }, ...FILTRO_PAGINA_INICIAL }).lean(),
            SiteReview.find(FILTRO_PAGINA_INICIAL).lean(),
        ]);

        const combinadas = [
            ...avaliacoes.map(avaliacaoParaPublico),
            ...siteReviews.map((r) => avaliacaoParaPublico(siteReviewComoAvaliacao(r))),
        ];
        combinadas.sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));

        res.status(200).json({ success: true, data: combinadas });
    } catch (error) {
        console.error('[AvaliacaoSistemaController.getPublic] Error:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar avaliações.' });
    }
};

const COLECOES = {
    sistema: AvaliacaoSistema,
    painel: SiteReview,
};

/**
 * GET /api/avaliacoes/moderacao — fila da administração.
 * Mostra texto e estrelas; quem escreveu aparece por iniciais e papel.
 */
exports.listarParaModeracao = async (req, res) => {
    try {
        const situacao = ['pendente', 'aprovada', 'recusada'].includes(req.query.situacao)
            ? req.query.situacao
            : 'pendente';
        const filtro =
            situacao === 'pendente'
                ? { moderacao: { $in: ['pendente', null] } }
                : { moderacao: situacao };

        const [sistema, painel] = await Promise.all([
            AvaliacaoSistema.find(filtro).sort({ dataCriacao: -1 }).limit(200).lean(),
            SiteReview.find(filtro).sort({ updatedAt: -1 }).limit(200).lean(),
        ]);

        const data = [
            ...sistema.map((a) => ({
                colecao: 'sistema',
                ...avaliacaoParaPublico(a),
                exibirPublicamente: a.exibirPublicamente === true,
                moderacao: a.moderacao || 'pendente',
            })),
            ...painel.map((r) => ({
                colecao: 'painel',
                ...avaliacaoParaPublico(siteReviewComoAvaliacao(r)),
                exibirPublicamente: r.exibirPublicamente === true,
                moderacao: r.moderacao || 'pendente',
            })),
        ].sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));

        res.json({ success: true, data });
    } catch {
        res.status(500).json({
            success: false,
            error: 'Erro ao listar avaliações para moderação.',
        });
    }
};

/**
 * PATCH /api/avaliacoes/moderacao/:colecao/:id  { decisao: 'aprovada' | 'recusada' }
 * A decisão vai para o AuditLog com antes e depois, por id.
 */
exports.moderar = async (req, res) => {
    try {
        const Modelo = COLECOES[req.params.colecao];
        const { decisao } = req.body || {};
        if (!Modelo || !['aprovada', 'recusada'].includes(decisao)) {
            return res.status(400).json({ success: false, error: 'Coleção ou decisão inválida.' });
        }
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });
        }

        const doc = await Modelo.findById(req.params.id);
        if (!doc)
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });

        const anterior = doc.moderacao || 'pendente';
        doc.moderacao = decisao;
        doc.moderadoPor = String(req.user.id || req.user._id);
        doc.moderadoEm = new Date();
        await doc.save();

        await logAction(req, 'AVALIACAO_MODERADA', 'AvaliacaoSistema', {
            recursoId: String(doc._id),
            valorAnterior: { moderacao: anterior },
            valorNovo: { moderacao: decisao },
            descricao: `Avaliação ${doc._id} (${req.params.colecao}): ${anterior} → ${decisao}.`,
        });

        res.json({ success: true, data: { id: doc._id, moderacao: doc.moderacao } });
    } catch {
        res.status(500).json({ success: false, error: 'Erro ao moderar a avaliação.' });
    }
};
