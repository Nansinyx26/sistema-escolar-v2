const { getFileStream } = require('../utils/gridfs');
const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

/**
 * Localiza os metadados do arquivo no bucket 'uploads' por ObjectId ou filename.
 * Retorna null se não existir.
 */
async function findFileDoc(fileId) {
    const bucket = new GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
    let query;
    if (mongoose.Types.ObjectId.isValid(fileId)) {
        query = { $or: [{ _id: new mongoose.Types.ObjectId(fileId) }, { filename: fileId }] };
    } else {
        query = { filename: fileId };
    }
    const docs = await bucket.find(query).limit(1).toArray();
    return docs[0] || null;
}

function streamFile(res, fileDoc) {
    res.set('Content-Type', fileDoc.contentType || 'image/webp');
    res.set('Cache-Control', 'public, max-age=3600');
    const stream = getFileStream(String(fileDoc._id));
    stream.on('error', () => {
        if (!res.headersSent) res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
        else res.end();
    });
    stream.pipe(res);
}

/**
 * Serve um arquivo do GridFS (rotas autenticadas — fotos e documentos).
 */
exports.serveFile = async (req, res) => {
    try {
        const fileDoc = await findFileDoc(req.params.id);
        if (!fileDoc) return res.status(404).json({ success: false, error: 'Arquivo não encontrado' });
        streamFile(res, fileDoc);
    } catch (error) {
        console.error('Erro no serveFile:', error);
        res.status(500).json({ success: false, error: 'Erro ao servir arquivo' });
    }
};

/**
 * Serve APENAS imagens (rota pública /api/files/:id, usada por <img> de avatar).
 * O bucket 'uploads' também guarda documentos de alunos (PDF etc.) — esses
 * exigem autenticação e só saem pelas rotas com authJWT.
 */
exports.servePublicImage = async (req, res) => {
    try {
        const fileDoc = await findFileDoc(req.params.id);
        if (!fileDoc) return res.status(404).json({ success: false, error: 'Arquivo não encontrado' });

        const contentType = fileDoc.contentType || '';
        if (!contentType.startsWith('image/')) {
            return res.status(403).json({ success: false, error: 'Este arquivo requer autenticação.' });
        }
        streamFile(res, fileDoc);
    } catch (error) {
        console.error('Erro no servePublicImage:', error);
        res.status(500).json({ success: false, error: 'Erro ao servir arquivo' });
    }
};
