const express = require('express');
const router = express.Router();
const ResponsavelController = require('../controllers/ResponsavelController');
const authorize = require('../middleware/authorize');
const filtrarPorEscola = require('../middleware/filtrarPorEscola');

// SEGURANÇA: estas rotas decidem o acesso ao aluno pelo E-MAIL da conta,
// comparado com a ficha. Só o perfil responsável passa por elas: a busca por
// código e o vínculo, abertos a qualquer conta, viravam o oráculo do código
// secreto dos alunos; e as demais, abertas à equipe, entregavam a ficha
// inteira a uma conta de professor criada pela direção de OUTRA escola com o
// e-mail de uma família — a confirmação da #412 só vale para o responsável
// (Issue #747). Nenhuma tela da equipe usa estas rotas.
const soResponsavel = authorize('responsavel');

// Issue #412: conta de responsável criada a partir do marco só passa daqui
// depois de confirmar o e-mail — é ele que a ficha do aluno usa como chave.
// Conta anterior segue como estava; `/reenviar-verificacao` fica de fora, ou a
// pessoa não teria como pedir o link de novo.
router.use(require('../middleware/exigirEmailVerificado'));

router.get('/alunos', soResponsavel, ResponsavelController.getAlunos);
router.get('/buscar-aluno', soResponsavel, ResponsavelController.buscarAluno);
router.get('/buscar-aluno/:codigo', soResponsavel, ResponsavelController.buscarAluno);
router.post('/vincular', soResponsavel, ResponsavelController.vincularAluno);
router.get('/notas/:alunoId', soResponsavel, ResponsavelController.getNotas);
router.get('/frequencia/:alunoId', soResponsavel, ResponsavelController.getFrequencia);
router.get('/notificacoes/:alunoId', soResponsavel, ResponsavelController.getNotificacoes);
router.put('/notificacoes/:id/ler', soResponsavel, ResponsavelController.marcarComoLida);
router.put('/notificacoes/:id/ocultar', soResponsavel, ResponsavelController.ocultarNotificacao);
router.put('/aluno/:alunoId/dados', soResponsavel, ResponsavelController.updateAlunoDados);
router.post('/aluno/:alunoId/documentos', soResponsavel, ResponsavelController.uploadDocumentos);
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
