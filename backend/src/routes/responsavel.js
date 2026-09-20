const express = require('express');
const router = express.Router();
const ResponsavelController = require('../controllers/ResponsavelController');
const authorize = require('../middleware/authorize');
const filtrarPorEscola = require('../middleware/filtrarPorEscola');

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
// `filtrarPorEscola` só aqui: esta é a única rota deste arquivo usada pela
// GESTÃO, e é o req.escolaId que faz a guarda do aluno recusar ficha de outra
// escola (Issue #397). As demais rotas são do responsável, cujo acesso é
// decidido pelo vínculo com o próprio filho.
router.put(
    '/aluno/:alunoId/documento-status',
    filtrarPorEscola,
    ResponsavelController.updateDocumentoStatus
);

module.exports = router;
