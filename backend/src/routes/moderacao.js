/**
 * routes/moderacao.js — §8.4 da ESPEC-MODERACAO-CHAT.md.
 *
 * `authJWT` e `filtrarPorEscola` são aplicados no MONTE (routes/api.js), não
 * aqui: assim uma rota nova neste arquivo nasce autenticada e com tenant
 * resolvido sem depender de alguém lembrar de repetir os middlewares. Mesmo
 * padrão já usado em `/admin`.
 *
 * POR QUE `authorize.estrito` E NÃO `authorize` (R4, tratado como bloqueante)
 * ==========================================================================
 * O `authorize` normal libera `admin` antes de qualquer verificação. Numa rota
 * de relatório isso é conveniência; aqui é acesso silencioso a conteúdo
 * sinalizado de menores de QUALQUER escola da base, sem ninguém ter escolhido
 * um tenant. A variante estrita não impede o admin de entrar — ele pode
 * informar qualquer `escolaId` —, mas exige que ele DIGA qual, e é esse ato
 * deliberado que o AuditLog registra. Sem isso o acesso cross-tenant é efeito
 * colateral do perfil, e ninguém consegue responder "quem viu o quê" depois.
 *
 * `coordenacao` aparece nas listas de perfil embora o enum de `models/Usuario`
 * ainda não tenha esse valor. É de propósito: a matriz de §7.1 prevê o papel, e
 * deixá-lo escrito faz a permissão passar a valer no dia em que o perfil for
 * criado, em vez de virar um bug silencioso de "coordenador não vê a fila".
 */

const express = require('express');

const router = express.Router();

const ModeracaoController = require('../controllers/ModeracaoController');
const authorize = require('../middleware/authorize');
const { moderacaoAbusoLimiter } = require('../middleware/rateLimiters');

const MODERADORES = ['diretor', 'coordenacao'];

// ── Fila e revisão (equipe) ──────────────────────────────────────────────────
router.get('/fila', authorize.estrito(MODERADORES), ModeracaoController.listarFila);
router.get('/metricas', authorize.estrito(MODERADORES), ModeracaoController.metricas);
router.get('/ocorrencia/:id', authorize.estrito(MODERADORES), ModeracaoController.obterOcorrencia);
router.post('/ocorrencia/:id/decidir', authorize.estrito(MODERADORES), ModeracaoController.decidir);
router.post(
    '/contestacao/:id/responder',
    authorize.estrito(MODERADORES),
    ModeracaoController.responderContestacao
);

// ── Canais do usuário (qualquer autenticado) ─────────────────────────────────
router.post('/denunciar', moderacaoAbusoLimiter, ModeracaoController.denunciar);
router.post('/contestar', moderacaoAbusoLimiter, ModeracaoController.contestar);
router.get('/minhas-contestacoes', ModeracaoController.minhasContestacoes);

// ── Aceite do Termo (cláusula 2) ─────────────────────────────────────────────
router.get('/aceite-termo', ModeracaoController.consultarAceite);
router.post('/aceite-termo', ModeracaoController.registrarAceite);

module.exports = router;
