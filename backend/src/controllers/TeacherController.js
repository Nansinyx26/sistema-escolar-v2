const Professor = require('../models/Professor');
const ImageProcessor = require('../utils/imageProcessor');

exports.list = async (req, res) => {
    try {
        const filters = { ativo: { $ne: false } };

        // Add optional filters from query
        Object.keys(req.query).forEach(key => {
            if (req.query[key]) {
                filters[key] = req.query[key];
            }
        });

        // Mecanismo de auto-correção: garante que todo Usuario com perfil 'professor' tenha um registro na coleção 'professores'
        const Usuario = require('../models/Usuario');
        const mongoose = require('mongoose');
        const usuariosProfessores = await Usuario.find({ perfil: 'professor', ativo: { $ne: false } }).lean();

        for (const u of usuariosProfessores) {
            const existingProf = await Professor.findOne({
                $or: [
                    { idUsuario: u._id.toString() },
                    { email: u.email.toLowerCase() }
                ]
            });

            if (!existingProf) {
                console.log(`🔧 [AUTO-HEAL] Sincronizando perfil pedagógico de Professor em falta para: ${u.nome} (${u.email})`);
                const materiasEspeciais = ['Inglês', 'Educação Física', 'Artes', 'SEBRAE', 'Oficina de Leitura'];
                const disc = u.disciplina || 'Geral';
                const isEspecial = materiasEspeciais.includes(disc);
                const t = u.turma || '';

                const salaPrincipal = isEspecial ? 'VARIADOS' : t;
                const salasAdicionais = isEspecial && t ? [t] : [];
                const materias = [disc];

                await Professor.create({
                    _id: new mongoose.Types.ObjectId().toString(),
                    idUsuario: u._id.toString(),
                    nome: u.nome,
                    email: u.email.toLowerCase(),
                    telefone: u.telefone || '(00) 00000-0000',
                    disciplina: disc,
                    salaPrincipal: salaPrincipal,
                    salasAdicionais: salasAdicionais,
                    turmas: t ? [t] : [],
                    materias: materias,
                    tipoEspecial: isEspecial,
                    role: 'professor',
                    ativo: true,
                    escola: 'default'
                });
            }
        }

        const teachers = await Professor.find(filters).lean();

        // Normalização para o frontend
        const normalizedTeachers = teachers.map(t => ({
            ...t,
            id: t.id || t._id
        }));

        res.json({ success: true, data: normalizedTeachers });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.get = async (req, res) => {
    try {
        const teacher = await Professor.findOne({ $or: [{ _id: req.params.id }, { id: req.params.id }] });
        if (!teacher) return res.status(404).json({ success: false, error: 'Professor não encontrado' });
        res.json({ success: true, data: teacher });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.create = async (req, res) => {
    try {
        // Conversão automática de imagem para WebP
        if (req.body.foto && ImageProcessor.isBase64Image(req.body.foto)) {
            try {
                req.body.foto = await ImageProcessor.convertToWebPBase64(req.body.foto);
            } catch (imgError) {
                console.warn('Falha ao converter imagem do professor para WebP:', imgError);
            }
        }

        // Calcula turmas unificadas
        const principal = req.body.salaPrincipal;
        const adicionais = Array.isArray(req.body.salasAdicionais) ? req.body.salasAdicionais : [];
        req.body.turmas = principal && principal !== 'VARIADOS' ? [principal, ...adicionais] : adicionais;

        const teacher = new Professor(req.body);
        await teacher.save();
        res.status(201).json({ success: true, data: teacher });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        // Conversão automática de imagem para WebP
        if (req.body.foto && ImageProcessor.isBase64Image(req.body.foto)) {
            try {
                if (!req.body.foto.startsWith('data:image/webp')) {
                    req.body.foto = await ImageProcessor.convertToWebPBase64(req.body.foto);
                }
            } catch (imgError) {
                console.warn('Falha ao converter imagem do professor para WebP:', imgError);
            }
        }

        // Calcula turmas unificadas
        const principal = req.body.salaPrincipal;
        const adicionais = Array.isArray(req.body.salasAdicionais) ? req.body.salasAdicionais : [];
        req.body.turmas = principal && principal !== 'VARIADOS' ? [principal, ...adicionais] : adicionais;

        delete req.body._id;
        const teacher = await Professor.findOneAndUpdate(
            { $or: [{ _id: req.params.id }, { id: req.params.id }] },
            req.body,
            { new: true }
        );
        if (!teacher) return res.status(404).json({ success: false, error: 'Professor não encontrado' });
        res.json({ success: true, data: teacher });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.delete = async (req, res) => {
    try {
        await Professor.findOneAndDelete({ $or: [{ _id: req.params.id }, { id: req.params.id }] });
        res.json({ success: true, message: 'Professor removido' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
