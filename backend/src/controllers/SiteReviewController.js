const SiteReview = require('../models/SiteReview');
const { siteReviewParaPublico, aderiu } = require('../utils/avaliacaoPublica');

/**
 * Avaliações feitas pelo painel (Issue #489).
 *
 * A listagem e os eventos em tempo real chegam à rede inteira: saem só
 * iniciais, papel, nota e comentário — sem id da conta e sem avatar. A
 * página inicial usa, além disso, adesão e moderação (ver
 * `AvaliacaoSistemaController.getPublic`); mudar o comentário devolve a
 * avaliação para revisão.
 */

/** Últimas avaliações, já na forma que pode circular pela rede. */
async function recentesProjetadas(limite) {
    const recentes = await SiteReview.find().sort({ updatedAt: -1 }).limit(limite).lean();
    return recentes.map(siteReviewParaPublico);
}

/** Avisa os painéis conectados. Só estatística e lista projetada. */
async function avisarPaineis(evento) {
    if (!global.io) return;
    const stats = await getStats();
    const recentReviews = await recentesProjetadas(10);
    global.io.emit(evento, { stats, recentReviews });
}

/** Campos de moderação a gravar quando o comentário muda (ou nunca foi moderado). */
function voltarParaRevisao(anterior, comment) {
    if (anterior && anterior.comment === comment && anterior.moderacao) return {};
    return { moderacao: 'pendente', moderadoPor: null, moderadoEm: null };
}

exports.create = async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const userId = req.user.id || req.user._id;
        const userName = req.user.nome || 'Usuário';
        const userType = req.user.perfil;

        if (!rating || !comment) {
            return res
                .status(400)
                .json({ success: false, error: 'Nota e comentário são obrigatórios.' });
        }
        if (rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, error: 'Nota deve ser entre 1 e 5.' });
        }

        const anterior = await SiteReview.findOne({ userId }).select('comment moderacao').lean();

        // Upsert: apenas 1 avaliação por usuário. O avatar não é mais guardado.
        const review = await SiteReview.findOneAndUpdate(
            { userId },
            {
                userId,
                userName,
                userType,
                userAvatar: '',
                rating,
                comment,
                exibirPublicamente: aderiu(req.body.exibirPublicamente),
                ...voltarParaRevisao(anterior, comment),
                updatedAt: new Date(),
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        await avisarPaineis('review:new');

        res.status(201).json({
            success: true,
            data: review,
            message: 'Avaliação salva com sucesso!',
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const { rating, comment } = req.body;

        const anterior = await SiteReview.findOne({ userId }).select('comment moderacao').lean();
        if (!anterior) {
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });
        }

        const mudancas = {
            rating,
            comment,
            userAvatar: '',
            ...voltarParaRevisao(anterior, comment),
            updatedAt: new Date(),
        };
        if (req.body.exibirPublicamente !== undefined) {
            mudancas.exibirPublicamente = aderiu(req.body.exibirPublicamente);
        }

        const review = await SiteReview.findOneAndUpdate({ userId }, mudancas, { new: true });

        await avisarPaineis('review:update');

        res.json({ success: true, data: review });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.remove = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        await SiteReview.findOneAndDelete({ userId });

        // Sem o id de quem removeu: o painel só redesenha as estatísticas.
        if (global.io) {
            const stats = await getStats();
            global.io.emit('review:remove', { stats });
        }

        res.json({ success: true, message: 'Avaliação removida.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getAll = async (_req, res) => {
    try {
        const reviews = await recentesProjetadas(20);
        const stats = await getStats();
        res.json({ success: true, data: reviews, stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getStats = async (_req, res) => {
    try {
        const stats = await getStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/** A própria avaliação: é dado do titular, sai inteiro para ele. */
exports.getMine = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const review = await SiteReview.findOne({ userId }).lean();
        res.json({ success: true, data: review });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// Helper: calcula estatísticas
async function getStats() {
    const reviews = await SiteReview.find().lean();
    const total = reviews.length;
    const avg = total > 0 ? (reviews.reduce((sum, r) => sum + r.rating, 0) / total).toFixed(1) : 0;

    // Distribuição por estrela
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviews) distribution[r.rating] = (distribution[r.rating] || 0) + 1;

    return { total, average: parseFloat(avg), distribution };
}
