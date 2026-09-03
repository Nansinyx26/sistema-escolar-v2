/**
 * conformidade.js — rotas dos deveres legais (LDB, INEP e LAI).
 *
 * Montada em `/api/conformidade` com `authJWT`, `horizontalFilter` e
 * `filtrarPorEscola` — nesta ordem, porque o filtro de turmas do professor
 * depende do usuário autenticado e o recorte por escola depende dos dois.
 *
 * A matriz de perfis abaixo não é estilística; é a segregação de funções que a
 * administração pública exige (ver `docs/CONFORMIDADE-LEGAL.md`):
 *
 *   • frequência    — professor (suas turmas), secretaria, diretor, admin;
 *   • ficha ao Conselho — secretaria, diretor, admin. O professor identifica a
 *     infrequência, mas quem COMUNICA a autoridade é a gestão da unidade;
 *   • Censo Escolar — secretaria, diretor, admin. É declaração da unidade;
 *   • dados abertos — secretaria, diretor, admin. Sem dado pessoal na resposta,
 *     mas a extração continua sendo ato administrativo com log.
 */

const express = require('express');
const router = express.Router();
const authorize = require('../middleware/authorize');
const ConformidadeController = require('../controllers/ConformidadeController');

const gestao = authorize(['diretor', 'secretaria', 'admin']);
const pedagogico = authorize(['diretor', 'secretaria', 'professor', 'admin']);

// Rota fixa antes da paramétrica: `/alertas` não pode ser lido como `:alunoId`.
router.get('/frequencia/alertas', pedagogico, ConformidadeController.alertasEvasao);
router.get(
    '/frequencia/:alunoId/ficha-conselho',
    gestao,
    ConformidadeController.fichaConselhoTutelar
);
router.get('/frequencia/:alunoId', pedagogico, ConformidadeController.frequenciaDoAluno);

router.get('/educacenso', gestao, ConformidadeController.exportarEducacenso);
router.get('/dados-abertos', gestao, ConformidadeController.dadosAbertos);

module.exports = router;
