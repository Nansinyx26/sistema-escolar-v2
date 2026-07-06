const express = require('express');
const router = express.Router();
const SecretariaController = require('../controllers/SecretariaController');
const authorize = require('../middleware/authorize');
const filtrarPorEscola = require('../middleware/filtrarPorEscola');

// Todas as rotas requerem perfil secretaria, diretor ou admin
const auth = authorize('secretaria', 'diretor', 'admin');

// ─── Dashboard ──────────────────────────────────────────────────────────────
router.get('/dashboard/resumo', auth, SecretariaController.dashboardResumo);

// ─── T3: Alunos & Matrículas ────────────────────────────────────────────────
router.post('/alunos', auth, filtrarPorEscola, SecretariaController.criarAluno);
router.post('/alunos/importar', auth, filtrarPorEscola, SecretariaController.importarAlunos);
router.post('/alunos/importar/estruturar', auth, SecretariaController.estruturarTextoAlunos);
router.put('/alunos/:id', auth, SecretariaController.editarAluno);
router.post('/matriculas', auth, SecretariaController.criarMatricula);
router.put('/matriculas/:id/transferir', auth, SecretariaController.transferirMatricula);
router.put('/matriculas/:id/status', auth, SecretariaController.atualizarStatusMatricula);
router.post('/responsaveis', auth, SecretariaController.criarResponsavel);
router.get('/turmas', auth, SecretariaController.listarTurmas);

// ─── T4: Documentos ─────────────────────────────────────────────────────────
router.post('/documentos/declaracao-matricula/:alunoId', auth, SecretariaController.gerarDeclaracaoMatricula);
router.post('/documentos/declaracao-frequencia/:alunoId', auth, SecretariaController.gerarDeclaracaoFrequencia);
router.post('/documentos/historico-escolar/:alunoId', auth, SecretariaController.gerarHistoricoEscolar);
router.get('/documentos/historico/:alunoId', auth, SecretariaController.listarDocumentosAluno);
router.post('/alunos/:id/documentos-upload', auth, SecretariaController.uploadDocumentoAluno);

// ─── T5: Frequência, Calendário, Justificativas ─────────────────────────────
router.get('/frequencia/consolidada', auth, SecretariaController.frequenciaConsolidada);
router.get('/calendario', auth, SecretariaController.listarCalendario);
router.post('/calendario', auth, SecretariaController.criarEventoCalendario);
router.get('/justificativas', auth, SecretariaController.listarJustificativas);
router.put('/justificativas/:id', auth, SecretariaController.analisarJustificativa);

// ─── T6: Comunicados & Relatórios ───────────────────────────────────────────
router.post('/comunicados', auth, SecretariaController.criarComunicado);
router.get('/comunicados', auth, SecretariaController.listarComunicados);
router.get('/relatorios/alunos-por-turma', auth, SecretariaController.relatorioAlunosPorTurma);
router.get('/relatorios/matriculas', auth, SecretariaController.relatorioMatriculas);
router.get('/relatorios/exportar', auth, SecretariaController.exportarRelatorio);

module.exports = router;
