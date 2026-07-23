const AvaliacaoSistema = require('../models/AvaliacaoSistema');
const Usuario = require('../models/Usuario');
const SiteReview = require('../models/SiteReview');
const Professor = require('../models/Professor');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');

/**
 * Normaliza o campo foto para uma URL que o <img> da landing consegue
 * carregar. Trata o prefixo "gridfs:<id>" (foto salva no GridFS pelos
 * perfis de equipe) — sem isso, a URL virava /api/files/gridfs:<id> e
 * a imagem nunca carregava, caindo nas iniciais.
 */
function resolverFotoPublica(foto) {
    if (!foto || typeof foto !== 'string') return '';
    if (foto.startsWith('gridfs:')) return `/api/files/${foto.slice('gridfs:'.length)}`;
    return foto; // data:, http(s):, /api/files/... já prontos
}

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
        const avaliacoes = await AvaliacaoSistema.find({ ativo: true }).lean();

        // 2. Busca todas as avaliações feitas pelo Dashboard / Realtime
        const siteReviews = await SiteReview.find().lean();

        // 3. Unifica IDs de usuários para busca em massa
        const allUserIds = [
            ...new Set([
                ...avaliacoes.map(a => a.usuarioId?.toString()),
                ...siteReviews.map(r => r.userId?.toString())
            ])
        ].filter(Boolean);

        const usuarios = await Usuario.find({ _id: { $in: allUserIds } })
            .select('nome foto fotoGoogle perfil')
            .lean();

        const usuariosMap = {};
        usuarios.forEach(u => {
            usuariosMap[u._id.toString()] = u;
        });

        // Fallback de foto: perfis de equipe guardam a foto na própria
        // collection (professores/diretores/secretarias), não em usuarios.
        const [profs, dirs, secs] = await Promise.all([
            Professor.find({ idUsuario: { $in: allUserIds } }).select('idUsuario foto').lean().catch(() => []),
            Diretor.find({ idUsuario: { $in: allUserIds } }).select('idUsuario foto').lean().catch(() => []),
            Secretaria.find({ idUsuario: { $in: allUserIds } }).select('idUsuario foto').lean().catch(() => []),
        ]);
        const fotoPerfilMap = {};
        [...profs, ...dirs, ...secs].forEach(d => {
            if (d.idUsuario && d.foto && !fotoPerfilMap[String(d.idUsuario)]) {
                fotoPerfilMap[String(d.idUsuario)] = d.foto;
            }
        });

        // 4. Formata Avaliacoes do Sistema com dados atuais
        const formattedAvaliacoes = avaliacoes.map(a => {
            const u = a.usuarioId ? usuariosMap[a.usuarioId.toString()] : null;
            return {
                _id: a._id,
                usuarioId: a.usuarioId,
                nome: u?.nome || a.nome || "Usuário",
                perfil: u?.perfil || a.perfil,
                estrelas: a.estrelas,
                texto: a.texto,
                foto: resolverFotoPublica(u?.foto || u?.fotoGoogle || fotoPerfilMap[a.usuarioId?.toString()] || a.foto || ''),
                ativo: true,
                dataCriacao: a.dataCriacao
            };
        });

        // 5. Formata SiteReviews com dados atuais
        const mappedSiteReviews = siteReviews.map(r => {
            const u = r.userId ? usuariosMap[r.userId.toString()] : null;
            return {
                _id: r._id,
                usuarioId: r.userId,
                nome: u?.nome || r.userName || "Usuário",
                perfil: u?.perfil || r.userType,
                estrelas: r.rating,
                texto: r.comment,
                foto: resolverFotoPublica(u?.foto || u?.fotoGoogle || fotoPerfilMap[r.userId?.toString()] || r.userAvatar || ''),
                ativo: true,
                dataCriacao: r.updatedAt || r.createdAt || new Date()
            };
        });

        // 6. Combina e ordena
        const combined = [...formattedAvaliacoes, ...mappedSiteReviews];
        combined.sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));

        res.status(200).json({ success: true, data: combined });
    } catch (error) {
        console.error('[AvaliacaoSistemaController.getPublic] Error:', error);
        res.status(500).json({ success: false, error: 'Erro ao buscar avaliações.' });
    }
};
