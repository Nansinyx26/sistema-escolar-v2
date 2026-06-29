const Diretor = require('../models/Diretor');
const ImageProcessor = require('../utils/imageProcessor');

exports.list = async (req, res) => {
    try {
        const filters = { ativo: { $ne: false } };

        // Adiciona filtros opcionais via query string
        Object.keys(req.query).forEach(key => {
            if (req.query[key]) {
                filters[key] = req.query[key];
            }
        });

        const directors = await Diretor.find(filters).lean();

        // Normalização para o frontend
        const normalizedDirs = directors.map(d => ({
            ...d,
            id: d.id || d._id
        }));

        res.json({ success: true, data: normalizedDirs });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.get = async (req, res) => {
    try {
        const id = req.params.id;
        const doc = await Diretor.findOne({
            $or: [{ _id: id }, { id: id }]
        });

        if (!doc) {
            return res.status(404).json({ success: false, error: 'Diretor não encontrado' });
        }

        res.json({ success: true, data: doc });
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
                console.warn('Falha ao converter imagem do diretor para WebP:', imgError);
            }
        }

        const doc = new Diretor(req.body);
        await doc.save();
        res.status(201).json({ success: true, data: doc });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.update = async (req, res) => {
    try {
        const id = req.params.id;
        delete req.body._id; // Proteção MongoDB contra alteração de campo imutável

        // Conversão automática de imagem para WebP
        if (req.body.foto && ImageProcessor.isBase64Image(req.body.foto)) {
            try {
                if (!req.body.foto.startsWith('data:image/webp')) {
                    req.body.foto = await ImageProcessor.convertToWebPBase64(req.body.foto);
                }
            } catch (imgError) {
                console.warn('Falha ao converter imagem do diretor para WebP:', imgError);
            }
        }

        const doc = await Diretor.findOneAndUpdate(
            { $or: [{ _id: id }, { id: id }] },
            req.body,
            { new: true, runValidators: true }
        );

        if (!doc) {
            return res.status(404).json({ success: false, error: 'Diretor não encontrado' });
        }

        res.json({ success: true, data: doc });
    } catch (error) {
        console.error('Erro ao atualizar diretor:', error);
        res.status(400).json({ success: false, error: error.message });
    }
};

exports.delete = async (req, res) => {
    try {
        const id = req.params.id;
        const doc = await Diretor.findOneAndDelete({
            $or: [{ _id: id }, { id: id }]
        });

        if (!doc) {
            return res.status(404).json({ success: false, error: 'Diretor não encontrado' });
        }

        res.json({ success: true, message: 'Diretor removido com sucesso' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
