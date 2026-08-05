'use strict';

/**
 * SystemUpdateJob.js
 * Executa todos os dias às 16h (horário de Brasília) e, sempre que houver uma
 * atualização no sistema (nova versão no topo de config/changelog.js que ainda
 * não foi anunciada), envia uma notificação automática para todos os usuários
 * de todas as escolas ativas via NotificationService.
 *
 * Cada versão é anunciada UMA única vez por escola — a checagem de duplicata
 * garante que rodar o job em dias seguintes não reenvia a mesma novidade.
 */

const cron = require('node-cron');
const Escola = require('../models/Escola');
const Notificacao = require('../models/Notificacao');
const NotificationService = require('../services/NotificationService');
const { releaseAtual, montarNotificacao } = require('../config/changelog');
const logger = require('../utils/logger');

const TIPO = 'atualizacao_sistema';

/**
 * Já foi anunciada esta versão para esta escola?
 * Dedup por tipo + título (o título carrega a versão) + escola.
 */
async function jaAnunciada(titulo, escolaId) {
    const filtro = { tipo: TIPO, titulo };
    filtro.escolaId = escolaId || { $in: [null, undefined, 'default'] };
    const existente = await Notificacao.findOne(filtro).lean();
    return Boolean(existente);
}

/**
 * Envia a notificação de atualização para uma escola (ou sem escola, no caso
 * de sistema pré-migração/testes sem escolas cadastradas).
 */
async function anunciarParaEscola(notif, escolaId) {
    if (await jaAnunciada(notif.titulo, escolaId)) {
        return false;
    }
    await NotificationService.notify({
        tipo: TIPO,
        categoria: 'sistema',
        prioridade: 'alta',
        titulo: notif.titulo,
        mensagem: notif.mensagem,
        destinatarios: 'todos',
        paraResponsavel: true, // visível também para responsáveis
        criadoPor: 'Sistema',
        link: '/dashboard',
        escolaId: escolaId || null,
    });
    return true;
}

/**
 * Rotina principal: anuncia a versão atual do changelog, se ainda não anunciada.
 */
async function anunciarAtualizacao() {
    try {
        const notif = montarNotificacao(releaseAtual());
        if (!notif) {
            logger.info('[SystemUpdate] Nenhuma release no changelog. Nada a anunciar.');
            return;
        }

        logger.info(`[SystemUpdate] Verificando atualização v${notif.versao} às 16h...`);

        const escolas = await Escola.find({ ativo: true }).select('_id').lean();

        // Sem escolas cadastradas (pré-migração/testes): envia uma vez sem escola.
        if (escolas.length === 0) {
            const enviado = await anunciarParaEscola(notif, null);
            logger.info(`[SystemUpdate] Sem escolas ativas. ${enviado ? 'Anúncio enviado.' : 'Já anunciado antes.'}`);
            return;
        }

        let enviados = 0;
        for (const escola of escolas) {
            if (await anunciarParaEscola(notif, String(escola._id))) {
                enviados += 1;
            }
        }

        if (enviados > 0) {
            logger.info(`[SystemUpdate] Atualização v${notif.versao} anunciada para ${enviados} escola(s).`);
        } else {
            logger.info(`[SystemUpdate] Atualização v${notif.versao} já havia sido anunciada. Nada enviado.`);
        }
    } catch (err) {
        logger.error(`[SystemUpdate] Erro ao anunciar atualização: ${err.message}`);
    }
}

/**
 * Inicializa o job: todo dia às 16:00 (horário de Brasília).
 */
function iniciarSystemUpdateJob() {
    cron.schedule('0 16 * * *', () => {
        anunciarAtualizacao();
    }, {
        timezone: 'America/Sao_Paulo',
    });

    logger.info('[SystemUpdate] Job agendado: aviso de atualizações às 16h (BRT).');
}

module.exports = { iniciarSystemUpdateJob, anunciarAtualizacao };
