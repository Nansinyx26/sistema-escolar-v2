const express = require('express');
const router = express.Router();
const RelatorioController = require('../controllers/RelatorioController');
const ReportController = require('../controllers/ReportController');
const authorize = require('../middleware/authorize');

// Rota para gerar boletim (Apenas Diretor, Professor, Responsável, Secretaria ou Admin)
router.get(
    '/boletim/:alunoId',
    authorize(['diretor', 'professor', 'responsavel', 'admin', 'secretaria']),
    RelatorioController.gerarBoletim
);

// ============================================
// RELATÓRIOS DIÁRIOS DA TURMA (Issue #132)
// ============================================
// Estas duas rotas NÃO EXISTIAM. A aba "Relatórios Diários" de `html/turma.html`
// chamava `/api/relatorios` desde sempre e caía no 404 global — e como o
// `db.getByIndex` do front engole o erro e devolve `[]`, a tela parecia
// funcionar: os textos eram digitados, o auto-save dizia ter salvado, e nada
// chegava ao banco.
//
// `PUT /diario` em vez de `POST`: a gravação é idempotente por (turma, matéria,
// dia), então repetir a chamada não cria registro novo. Era o front que tentava
// resolver isso, baixando a lista inteira antes de cada gravação para decidir
// entre criar e atualizar — e duas gravações rápidas do mesmo dia liam "não
// existe" as duas.
//
// Responsável fica de fora: relatório de turma é registro pedagógico interno.
const PODEM_ESCREVER = ['diretor', 'professor', 'secretaria', 'admin'];

router.get('/', authorize(PODEM_ESCREVER), ReportController.listar);
router.put('/diario', authorize(PODEM_ESCREVER), ReportController.salvarDiario);

module.exports = router;
