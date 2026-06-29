const express = require('express');
const router = express.Router();
const ResponsavelController = require('../controllers/ResponsavelController');

router.get('/alunos', ResponsavelController.getAlunos);
router.get('/buscar-aluno', ResponsavelController.buscarAluno);
router.post('/vincular', ResponsavelController.vincularAluno);
router.get('/notas/:alunoId', ResponsavelController.getNotas);
router.get('/frequencia/:alunoId', ResponsavelController.getFrequencia);
router.get('/notificacoes/:alunoId', ResponsavelController.getNotificacoes);
router.put('/notificacoes/:id/ler', ResponsavelController.marcarComoLida);
router.put('/notificacoes/:id/ocultar', ResponsavelController.ocultarNotificacao);
router.put('/aluno/:alunoId/dados', ResponsavelController.updateAlunoDados);
router.post('/aluno/:alunoId/documentos', ResponsavelController.uploadDocumentos);
router.put('/aluno/:alunoId/documento-status', ResponsavelController.updateDocumentoStatus);

module.exports = router;
