const express = require('express');
const router = express.Router();
const ResponsavelController = require('../controllers/ResponsavelController');
const authorize = require('../middleware/authorize');

// SEGURANÇA: a busca por código e o vínculo só fazem sentido para o perfil
// responsável. Abertas a qualquer conta autenticada, viravam o oráculo de
// enumeração do código secreto dos alunos.
const soResponsavel = authorize('responsavel');

router.get('/alunos', ResponsavelController.getAlunos);
router.get('/buscar-aluno', soResponsavel, ResponsavelController.buscarAluno);
router.get('/buscar-aluno/:codigo', soResponsavel, ResponsavelController.buscarAluno);
router.post('/vincular', soResponsavel, ResponsavelController.vincularAluno);
router.get('/notas/:alunoId', ResponsavelController.getNotas);
router.get('/frequencia/:alunoId', ResponsavelController.getFrequencia);
router.get('/notificacoes/:alunoId', ResponsavelController.getNotificacoes);
router.put('/notificacoes/:id/ler', ResponsavelController.marcarComoLida);
router.put('/notificacoes/:id/ocultar', ResponsavelController.ocultarNotificacao);
router.put('/aluno/:alunoId/dados', ResponsavelController.updateAlunoDados);
router.post('/aluno/:alunoId/documentos', ResponsavelController.uploadDocumentos);
router.put('/aluno/:alunoId/documento-status', ResponsavelController.updateDocumentoStatus);

module.exports = router;
