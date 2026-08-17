const express = require('express');
const router = express.Router();
const SecretariaController = require('../controllers/SecretariaController');
const TurmaAlunosController = require('../controllers/SecretariaTurmaAlunosController');
const authorize = require('../middleware/authorize');
const filtrarPorEscola = require('../middleware/filtrarPorEscola');
const { uploadImportacao, tratarErroUpload } = require('../middleware/uploadImportacao');
const { importacaoPreviewLimiter, importacaoIpLimiter } = require('../middleware/rateLimiters');

// Todas as rotas requerem perfil secretaria, diretor ou admin
const auth = authorize('secretaria', 'diretor', 'admin');

// SEGURANÇA (multi-tenant): o contexto de escola é resolvido para TODAS as
// rotas do módulo. Antes só criarAluno/importarAlunos tinham o middleware —
// relatórios, documentos e dashboards varriam a rede inteira.
router.use(filtrarPorEscola);

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

// ─── T3b: Alunos DENTRO de uma turma ────────────────────────────────────────
// Todo handler destas rotas confere que a `:turmaId` pertence à escola da
// sessão antes de qualquer leitura ou escrita. Sem essa checagem, trocar o ID
// na URL lista — e permite importar para — a turma de outra escola da rede.

// Autocomplete do modal "adicionar aluno". Declarada ANTES de qualquer
// `/alunos/:algo` para não ser capturada por um parâmetro de rota.
router.get('/alunos/buscar', auth, TurmaAlunosController.buscarAlunos);

router.get('/turmas/:turmaId/alunos', auth, TurmaAlunosController.listarAlunosDaTurma);
router.post('/turmas/:turmaId/alunos', auth, TurmaAlunosController.adicionarAluno);
router.delete('/turmas/:turmaId/alunos/:alunoId', auth, TurmaAlunosController.removerAlunoDaTurma);

// Importação em lote — 3 passos: preview → confirmar (ou cancelar) → desfazer.
router.get(
    '/turmas/:turmaId/alunos/importar/historico',
    auth,
    TurmaAlunosController.historicoImportacoes
);
router.post(
    '/turmas/:turmaId/alunos/importar/preview',
    auth,
    importacaoIpLimiter,
    importacaoPreviewLimiter,
    uploadImportacao.single('arquivo'),
    tratarErroUpload,
    TurmaAlunosController.previewImportacao
);
router.post(
    '/turmas/:turmaId/alunos/importar/:importacaoId/confirmar',
    auth,
    TurmaAlunosController.confirmarImportacao
);
router.post(
    '/turmas/:turmaId/alunos/importar/:importacaoId/cancelar',
    auth,
    TurmaAlunosController.cancelarImportacao
);
router.post(
    '/turmas/:turmaId/alunos/importar/:importacaoId/desfazer',
    auth,
    TurmaAlunosController.desfazerImportacao
);

// ─── T4: Documentos ─────────────────────────────────────────────────────────
router.post(
    '/documentos/declaracao-matricula/:alunoId',
    auth,
    SecretariaController.gerarDeclaracaoMatricula
);
router.post(
    '/documentos/declaracao-frequencia/:alunoId',
    auth,
    SecretariaController.gerarDeclaracaoFrequencia
);
router.post(
    '/documentos/historico-escolar/:alunoId',
    auth,
    SecretariaController.gerarHistoricoEscolar
);
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
