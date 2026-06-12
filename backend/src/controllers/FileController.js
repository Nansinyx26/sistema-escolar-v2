const { getFileStream } = require('../utils/gridfs');
const mongoose = require('mongoose');

/**
 * Serve um arquivo do GridFS diretamente como resposta HTTP
 */
exports.serveFile = async (req, res) => {
    try {
        const fileId = req.params.id;
        
        if (!mongoose.Types.ObjectId.isValid(fileId)) {
            return res.status(400).json({ success: false, error: 'ID de arquivo inválido' });
        }

        const stream = getFileStream(fileId);

        stream.on('file', (file) => {
            res.set('Content-Type', file.contentType);
            // Cache por 1 hora para performance
            res.set('Cache-Control', 'public, max-age=3600');
        });

        stream.on('error', (err) => {
            console.error('Erro ao buscar arquivo no GridFS:', err);
            res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
        });

        stream.pipe(res);
    } catch (error) {
        console.error('Erro no serveFile:', error);
        res.status(500).json({ success: false, error: 'Erro ao servir arquivo' });
    }
};
