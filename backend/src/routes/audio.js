const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const crypto = require('crypto');
const audioUpload = require('../middleware/audioUpload');
const authJWT = require('../middleware/authJWT');
const filtrarPorEscola = require('../middleware/filtrarPorEscola');
const { autorizarArquivo, findFileDoc } = require('../controllers/FileController');

// POST /api/audio/upload
router.post('/upload', authJWT, filtrarPorEscola, audioUpload.single('audio'), async (req, res) => {
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
            // `usuarioId`/`escolaId` com os MESMOS nomes usados pelos outros
            // uploads: é esse metadata que o FileController lê para autorizar o
            // download. Antes gravava-se `userId`, que nada lia — o arquivo
            // ficava sem dono e sem escola do ponto de vista da autorização.
            metadata: {
                originalName: req.file.originalname,
                usuarioId: String(req.user.id || req.user._id || ''),
                escolaId: req.escolaId ? String(req.escolaId) : undefined,
                type: 'voice_message',
            },
        });

        uploadStream.end(req.file.buffer);

        uploadStream.on('finish', () => {
            res.status(201).json({
                success: true,
                data: {
                    id: uploadStream.id,
                    filename: filename,
                    url: `/api/audio/${uploadStream.id}`,
                },
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
// ============================================
// SEGURANÇA: esta rota lê do bucket 'uploads' — o MESMO que guarda RG, CPF,
// comprovantes e fotos de alunos. Antes bastava estar autenticado: ela abria o
// download stream direto pelo ObjectId, sem passar pela autorização do
// FileController. Qualquer conta (inclusive um responsável) enumerava ids e
// baixava o documento de identidade de qualquer criança, de qualquer escola —
// contornando por completo a defesa escrita em FileController.autorizarArquivo.
//
// Duas travas agora, nesta ordem:
//   1. contentType precisa ser audio/* — um endpoint de áudio não tem por que
//      entregar PDF/imagem, e só isto já fecha a exfiltração de documentos;
//   2. autorizarArquivo() — mesma decisão das demais rotas (fronteira de
//      escola, vínculo com o aluno, dono do arquivo).
// ============================================
router.get('/:id', authJWT, filtrarPorEscola, async (req, res) => {
    try {
        const { id } = req.params;

        // Valida o ObjectId antes de consultar o banco
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, error: 'ID de áudio inválido.' });
        }

        const file = await findFileDoc(id);
        if (!file) {
            return res
                .status(404)
                .json({ success: false, error: 'Arquivo de áudio não encontrado.' });
        }

        // 1. Só áudio sai por aqui. Responde 404 (e não 403) de propósito: um
        //    403 confirmaria a existência daquele id no bucket.
        if (!String(file.contentType || '').startsWith('audio/')) {
            return res
                .status(404)
                .json({ success: false, error: 'Arquivo de áudio não encontrado.' });
        }

        // 2. Mesma autorização das rotas de arquivo/documento.
        const permissao = await autorizarArquivo(req, file);
        if (!permissao.ok) {
            return res.status(permissao.status).json({ success: false, error: permissao.error });
        }

        const db = mongoose.connection.db;
        const bucket = new mongoose.mongo.GridFSBucket(db, { bucketName: 'uploads' });
        const objectId = file._id;

        // Headers de streaming com suporte a range (para player HTML5)
        res.set('Content-Type', file.contentType || 'audio/mpeg');
        res.set('Content-Length', file.length);
        res.set('Accept-Ranges', 'bytes');
        // 'private': resposta autenticada não pode ficar em cache de proxy
        // compartilhado e ser servida a outro usuário.
        res.set('Cache-Control', 'private, max-age=3600');

        const downloadStream = bucket.openDownloadStream(objectId);
        downloadStream.pipe(res);

        downloadStream.on('error', (err) => {
            // Evita enviar headers duplos se a resposta já começou
            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    error: 'Erro ao transmitir o arquivo de áudio.',
                });
            }
        });
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: 'Erro interno ao buscar áudio.' });
        }
    }
});

module.exports = router;
