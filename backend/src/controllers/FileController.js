const { getFileStream } = require('../utils/gridfs');
const mongoose = require('mongoose');

/**
 * Serve um arquivo do GridFS diretamente como resposta HTTP
 */
exports.serveFile = async (req, res) => {
    try {
        const fileId = req.params.id;
        let stream;

        // Tenta buscar por ID se for válido, senão por nome
        if (mongoose.Types.ObjectId.isValid(fileId)) {
            stream = getFileStream(fileId);
        } else {
            stream = getFileStreamByFilename(fileId);
        }

        stream.on('file', (file) => {
            res.set('Content-Type', file.contentType || 'image/webp');
            // Cache por 1 hora para performance
            res.set('Cache-Control', 'public, max-age=3600');
        });

        stream.on('error', (err) => {
            // Se falhou por ID, talvez seja um nome que parece ID
            if (mongoose.Types.ObjectId.isValid(fileId)) {
                try {
                    const gridfsUtils = require('../utils/gridfs');
                    const backupStream = gridfsUtils.getFileStreamByFilename(fileId);
                    
                    backupStream.on('file', (file) => {
                        res.set('Content-Type', file.contentType || 'image/webp');
                        res.set('Cache-Control', 'public, max-age=3600');
                    });
                    
                    backupStream.on('error', () => {
                        res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
                    });

                    return backupStream.pipe(res);
                } catch (e) {
                    return res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
                }
            }
            res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
        });

        stream.pipe(res);
    } catch (error) {
        console.error('Erro no serveFile:', error);
        res.status(500).json({ success: false, error: 'Erro ao servir arquivo' });
    }
};
