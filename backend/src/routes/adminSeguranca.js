/**
 * adminSeguranca.js — operação do rate limit e do bloqueio de IP (Issue #333)
 * ============================================================================
 * Montado em /api/admin/seguranca com authJWT + authorize('admin') no api.js.
 * Guia de uso em docs/RATE-LIMIT.md.
 * ============================================================================
 */
const express = require('express');
const BloqueioIpService = require('../services/protecaoAbuso/BloqueioIpService');
const { diagnosticoIp } = require('../utils/ipCliente');
const { logAction } = require('../utils/auditHelper');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * GET /api/admin/seguranca/diag-ip
 *
 * Responde "o servidor está enxergando o IP certo?". Mostra, para a própria
 * requisição do administrador, o endereço da conexão, a cadeia do
 * X-Forwarded-For e o IP que o rate limit usou. Se `ipResolvido` for o IP do
 * balanceador (e não o seu IP público), TRUST_PROXY não bate com a
 * infraestrutura e todo mundo estaria dividindo o mesmo contador.
 *
 * Só devolve dados desta requisição: nenhum IP de outra pessoa sai daqui.
 */
router.get('/diag-ip', (req, res) => {
    res.json({ ok: true, ...diagnosticoIp(req) });
});

/**
 * GET /api/admin/seguranca/bloqueios-ip
 *
 * IPs bloqueados agora por excesso de tentativas de login, com o tempo que
 * falta e o nível de reincidência.
 */
router.get('/bloqueios-ip', async (_req, res) => {
    try {
        const bloqueios = await BloqueioIpService.listarAtivos();
        return res.json({ ok: true, total: bloqueios.length, bloqueios });
    } catch (e) {
        logger.error('[rate-limit] Falha ao listar bloqueios de IP', { err: e });
        return res.status(500).json({ ok: false, erro: 'Erro ao listar os bloqueios.' });
    }
});

/**
 * DELETE /api/admin/seguranca/bloqueios-ip/:id
 *
 * Remove o bloqueio e zera a reincidência do IP. É a saída para o falso
 * positivo mais provável: a escola inteira sai por um IP só, alguns erros de
 * senha somados bloqueiam todo mundo, e esperar o prazo não é opção.
 * O bloqueio por CONTA (lockUntil) não é afetado.
 */
router.delete('/bloqueios-ip/:id', async (req, res) => {
    try {
        const removido = await BloqueioIpService.remover(req.params.id);
        if (!removido) return res.status(404).json({ ok: false, erro: 'Bloqueio não encontrado.' });

        await logAction(req, 'LOGIN_IP_DESBLOQUEADO', 'Segurança', {
            descricao: `Bloqueio de IP removido manualmente (${req.params.id}).`,
        });
        logger.info('[rate-limit] Bloqueio de IP removido pelo administrador', {
            action: 'auth.ipDesbloqueado',
        });
        return res.json({ ok: true });
    } catch (e) {
        logger.error('[rate-limit] Falha ao remover bloqueio de IP', { err: e });
        return res.status(500).json({ ok: false, erro: 'Erro ao remover o bloqueio.' });
    }
});

module.exports = router;
