const express = require('express');
const router = express.Router();
const DocumentoResponsavelController = require('../controllers/DocumentoResponsavelController');
const uploadDocument = require('../middleware/uploadDocument');

function tratarUpload(req, res, next) {
    uploadDocument.single('arquivo')(req, res, (err) => {
        if (err) {
            return res.status(400).json({
                success: false,
                error: err.message || 'Erro no upload do arquivo.',
            });
        }
        next();
    });
}

// 1. Upload e substituição (Responsável e Gestão)
router.post('/', tratarUpload, DocumentoResponsavelController.uploadDocumento);
router.post('/upload', tratarUpload, DocumentoResponsavelController.uploadDocumento);
router.put('/:id/substituir', tratarUpload, DocumentoResponsavelController.substituirDocumento);

// 2. Consultas
router.get('/meus', DocumentoResponsavelController.listarMeusDocumentos);
router.get('/aluno/:alunoId', DocumentoResponsavelController.listarPorAluno);
router.get('/', DocumentoResponsavelController.listarTodos);

// 3. Streaming (Visualização inline e Download)
router.get('/:id/visualizar', DocumentoResponsavelController.visualizarArquivo);
router.get('/:id/preview', DocumentoResponsavelController.visualizarArquivo);
router.get('/:id/download', DocumentoResponsavelController.baixarArquivo);

// 4. Status (Secretaria / Direção)
router.patch('/:id/status', DocumentoResponsavelController.atualizarStatus);
router.put('/:id/status', DocumentoResponsavelController.atualizarStatus);

module.exports = router;
