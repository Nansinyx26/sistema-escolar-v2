/**
 * sondas.js — GET /health e GET /ready para balanceador e orquestrador.
 *
 * Montado no TOPO do app.js, antes de compressão, log de acesso, sessão, CSRF
 * e rate limit. Sonda é tráfego de infraestrutura: chega a cada poucos
 * segundos em cada instância, e passar pela cadeia inteira encheria o log de
 * ruído e gastaria o teto de requisições do próprio balanceador.
 *
 * As respostas não dizem nada além do necessário — nem versão, nem memória,
 * nem nome de banco. O diagnóstico detalhado continua em /api/health e
 * /api/monitoring/health. Ver utils/prontidao.js (Issue #335).
 */
const express = require('express');
const { verificarProntidao } = require('../utils/prontidao');

const router = express.Router();

function semCache(res) {
    res.set('Cache-Control', 'no-store');
}

// Liveness: se o processo respondeu, está vivo. Não consulta o banco de
// propósito — uma oscilação do Atlas não é motivo para reiniciar a instância.
router.get('/health', (_req, res) => {
    semCache(res);
    res.status(200).json({ status: 'ok' });
});

// Readiness: banco respondendo e instância fora de encerramento.
router.get('/ready', async (_req, res) => {
    semCache(res);
    const { pronto, checks } = await verificarProntidao();
    res.status(pronto ? 200 : 503).json({ status: pronto ? 'ready' : 'unavailable', checks });
});

module.exports = router;
