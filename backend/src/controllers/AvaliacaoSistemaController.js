const AvaliacaoSistema = require('../models/AvaliacaoSistema');
const Usuario = require('../models/Usuario');
const SiteReview = require('../models/SiteReview');

exports.create = async (req, res) => {
    try {
        const { estrelas, texto } = req.body;
        const usuarioId = req.user.id || req.user._id;

        if (!estrelas || !texto) {
            return res.status(400).json({ success: false, error: 'Estrelas e texto são obrigatórios.' });
        }

        const usuario = await Usuario.findById(usuarioId).lean();
        if (!usuario) {
            return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
        }

        // Verifica se o usuário já avaliou (opcional: permite só 1 por usuário)
        const avaliacaoExistente = await AvaliacaoSistema.findOne({ usuarioId });
        if (avaliacaoExistente) {
            // Atualiza a existente
            avaliacaoExistente.estrelas = estrelas;
            avaliacaoExistente.texto = texto;
            avaliacaoExistente.foto = usuario.foto || usuario.fotoGoogle || '';
            avaliacaoExistente.dataCriacao = Date.now();
            await avaliacaoExistente.save();
            return res.status(200).json({ success: true, message: 'Avaliação atualizada com sucesso!' });
        }

        const avaliacao = new AvaliacaoSistema({
            usuarioId,
            nome: usuario.nome,
            perfil: usuario.perfil,
            estrelas,
            texto,
            foto: usuario.foto || usuario.fotoGoogle || ''
        });

        await avaliacao.save();
        res.status(201).json({ success: true, message: 'Avaliação enviada com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getPublic = async (req, res) => {
    try {
        // 1. Busca todas as avaliações feitas pela Landing Page
        const avaliacoes = await AvaliacaoSistema.find({ ativo: true })
            .sort({ dataCriacao: -1 })
            .lean();

        // 2. Busca todas as avaliações feitas pelo Dashboard / Realtime
        const siteReviews = await SiteReview.find()
            .sort({ updatedAt: -1 })
            .lean();

        // 3. Unifica o formato do SiteReview para corresponder à estrutura de exibição
        const mappedSiteReviews = siteReviews.map(r => ({
            _id: r._id,
            usuarioId: r.userId,
            nome: r.userName,
            perfil: r.userType,
            estrelas: r.rating,
            texto: r.comment,
            foto: r.userAvatar || '',
            ativo: true,
            dataCriacao: r.updatedAt || r.createdAt || new Date()
        }));

        // 4. Combina ambas as fontes
        const combined = [...avaliacoes, ...mappedSiteReviews];

        // 5. Ordena por data decrescente para mostrar as mais novas primeiro
        combined.sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));

        res.status(200).json({ success: true, data: combined });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
