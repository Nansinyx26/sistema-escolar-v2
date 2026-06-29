const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');
const audioUpload = require('../middleware/audioUpload');
const authJWT = require('../middleware/authJWT');

// POST /api/audio/upload
router.post('/upload', authJWT, audioUpload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'Nenhum arquivo de áudio enviado.' });
    }

    try {
        const db = mongoose.connection.db;
        const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
        
        // Determinar extensão
        let ext = '.webm';
        if (req.file.mimetype === 'audio/mpeg') ext = '.mp3';
        else if (req.file.mimetype === 'audio/wav') ext = '.wav';
        else if (req.file.mimetype === 'audio/ogg') ext = '.ogg';
        
        const filename = crypto.randomBytes(16).toString('hex') + ext;
        const uploadStream = bucket.openUploadStream(filename, { 
            contentType: req.file.mimetype,
            metadata: { 
                originalName: req.file.originalname,
                userId: req.user.id || req.user._id,
                type: 'voice_message'
            }
        });

        uploadStream.end(req.file.buffer);

        uploadStream.on('finish', () => {
            res.status(201).json({ 
                success: true, 
                data: { 
                    id: uploadStream.id, 
                    filename: filename,
                    url: `/api/audio/${uploadStream.id}`
                } 
            });
        });

        uploadStream.on('error', (err) => {
            res.status(500).json({ success: false, error: err.message });
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/audio/:id
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Valida o ObjectId antes de consultar o banco
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID de áudio inválido.' });
        }

        const db     = mongoose.connection.db;
        const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });

        const objectId = new mongoose.Types.ObjectId(id);
        const files    = await bucket.find({ _id: objectId }).toArray();

        if (!files || files.length === 0) {
            return res.status(404).json({ success: false, error: 'Arquivo de áudio não encontrado.' });
        }

        const file = files[0];

        // Headers de streaming com suporte a range (para player HTML5)
        res.set('Content-Type',   file.contentType || 'audio/mpeg');
        res.set('Content-Length', file.length);
        res.set('Accept-Ranges',  'bytes');
        res.set('Cache-Control',  'public, max-age=3600');

        const downloadStream = bucket.openDownloadStream(objectId);
        downloadStream.pipe(res);

        downloadStream.on('error', (err) => {
            // Evita enviar headers duplos se a resposta já começou
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: 'Erro ao transmitir o arquivo de áudio.' });
            }
        });

    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Erro interno ao buscar áudio.' });
        }
    }
});

module.exports = router;
