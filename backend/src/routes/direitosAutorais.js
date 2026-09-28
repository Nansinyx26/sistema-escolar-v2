/**
 * routes/direitosAutorais.js — Issue #509.
 *
 * `authJWT`, `filtrarPorEscola` e `authorize('diretor')` são aplicados no MONTE
 * (routes/api.js): rota nova neste arquivo nasce restrita à direção (e ao
 * admin) sem depender de alguém repetir os middlewares.
 */
const express = require('express');
const multer = require('multer');

const DireitosAutoraisController = require('../controllers/DireitosAutoraisController');

const router = express.Router();

// Arquivo de referência da obra: só imagem ou áudio, em memória — o catálogo
// guarda a impressão digital, nunca os bytes.
const receberReferencia = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
        const mime = String(file.mimetype).toLowerCase();
        if (mime.startsWith('image/') || mime.startsWith('audio/')) return cb(null, true);
        return cb(new Error('Só imagem ou áudio podem ser cadastrados.'), false);
    },
}).single('arquivo');

function tratarUpload(req, res, next) {
    receberReferencia(req, res, (err) => {
        if (!err) return next();
        const grande = err.code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({
            success: false,
            error: grande ? 'Arquivo acima do limite de 10 MB.' : err.message,
        });
    });
}

router.get('/obras', DireitosAutoraisController.listar);
router.post('/obras', tratarUpload, DireitosAutoraisController.cadastrar);
router.delete('/obras/:id', DireitosAutoraisController.remover);
router.post('/arquivos/:id/bloquear', DireitosAutoraisController.bloquearArquivo);

module.exports = router;
