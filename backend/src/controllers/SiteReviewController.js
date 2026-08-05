const SiteReview = require('../models/SiteReview');
const Usuario = require('../models/Usuario');

exports.create = async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const userId = req.user.id || req.user._id;
        const userName = req.user.nome || 'Usuário';
        const userType = req.user.perfil;

        if (!rating || !comment) {
            return res.status(400).json({ success: false, error: 'Nota e comentário são obrigatórios.' });
        }
        if (rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, error: 'Nota deve ser entre 1 e 5.' });
        }

        // Busca o avatar atualizado do usuário
        const userObj = await Usuario.findById(userId).lean();
        const userAvatar = userObj ? (userObj.foto || userObj.fotoGoogle || '') : '';

        // Upsert: apenas 1 avaliação por usuário
        const review = await SiteReview.findOneAndUpdate(
            { userId },
            { userId, userName, userType, userAvatar, rating, comment, updatedAt: new Date() },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        // Emitir evento realtime para atualizar todos os dashboards
        if (global.io) {
            const stats = await getStats();
            const recentReviews = await SiteReview.find().sort({ updatedAt: -1 }).limit(10).lean();
            global.io.emit('review:new', { review, stats, recentReviews });
        }

        res.status(201).json({ success: true, data: review, message: 'Avaliação salva com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const { rating, comment } = req.body;

        // Busca o avatar atualizado do usuário
        const userObj = await Usuario.findById(userId).lean();
        const userAvatar = userObj ? (userObj.foto || userObj.fotoGoogle || '') : '';

        const review = await SiteReview.findOneAndUpdate(
            { userId },
            { rating, comment, userAvatar, updatedAt: new Date() },
            { new: true }
        );

        if (!review) {
            return res.status(404).json({ success: false, error: 'Avaliação não encontrada.' });
        }

        if (global.io) {
            const stats = await getStats();
            const recentReviews = await SiteReview.find().sort({ updatedAt: -1 }).limit(10).lean();
            global.io.emit('review:update', { review, stats, recentReviews });
        }

        res.json({ success: true, data: review });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.remove = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        await SiteReview.findOneAndDelete({ userId });

        if (global.io) {
            const stats = await getStats();
            global.io.emit('review:remove', { userId, stats });
        }

        res.json({ success: true, message: 'Avaliação removida.' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getAll = async (req, res) => {
    try {
        const reviews = await SiteReview.find().sort({ updatedAt: -1 }).limit(20).lean();
        const stats = await getStats();
        res.json({ success: true, data: reviews, stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getStats = async (req, res) => {
    try {
        const stats = await getStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

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
    reviews.forEach(r => { distribution[r.rating] = (distribution[r.rating] || 0) + 1; });

    return { total, average: parseFloat(avg), distribution };
}
