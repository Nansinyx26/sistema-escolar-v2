'use strict';

/**
 * DailyDigestJob.js
 * Executa todos os dias às 16h (horário de Brasília = UTC-3 → 19:00 UTC).
 * Cria uma Notificacao de resumo do dia para todos os usuários.
 */

const cron = require('node-cron');
const Comunicado  = require('../models/Comunicado');
const Notificacao = require('../models/Notificacao');
const logger      = require('../utils/logger');

/**
 * Gera o texto do resumo diário com base nos comunicados publicados hoje.
 */
async function gerarResumo() {
    const hoje = new Date();
    const inicioDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0);
    const fimDia    = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59);

    // Comunicados publicados hoje
    const comunicados = await Comunicado.find({
        ativo: true,
        dataCriacao: { $gte: inicioDia, $lte: fimDia },
    }).select('titulo categoria').lean();

    if (comunicados.length === 0) {
        return null; // Nada novo hoje, não envia notificação
    }

    const dataFormatada = hoje.toLocaleDateString('pt-BR', {
        day: '2-digit', month: 'long', year: 'numeric',
    });

    const listaTexto = comunicados
        .map((c, i) => `${i + 1}. ${c.titulo}${c.categoria ? ` (${c.categoria})` : ''}`)
        .join('\n');

    return {
        titulo: `Resumo do dia — ${dataFormatada}`,
        mensagem: `Olá! Confira as novidades de hoje:\n\n${listaTexto}\n\nAcesse o mural para mais detalhes.`,
        total: comunicados.length,
    };
}

/**
 * Cria a notificação de resumo no banco.
 */
async function enviarDigest() {
    try {
        logger.info('[DailyDigest] Iniciando resumo diário das 16h...');

        const resumo = await gerarResumo();
        if (!resumo) {
            logger.info('[DailyDigest] Nenhum comunicado novo hoje. Resumo não enviado.');
            return;
        }

        // Evita duplicata: verifica se já foi enviado hoje
        const hoje = new Date();
        const inicioDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0);
        const jaExiste = await Notificacao.findOne({
            tipo: 'resumo_diario',
            dataCriacao: { $gte: inicioDia },
        });

        if (jaExiste) {
            logger.info('[DailyDigest] Resumo diário já enviado hoje. Ignorando.');
            return;
        }

        await Notificacao.create({
            id:           `digest_${Date.now()}`,
            tipo:         'resumo_diario',
            categoria:    'direcao',
            prioridade:   'normal',
            titulo:       resumo.titulo,
            mensagem:     resumo.mensagem,
            destinatarios: 'todos',   // Todos os usuários
            paraResponsavel: true,    // Visível também para responsáveis
            criadoPor:    'Sistema',
            escolaId:     'default',
            status:       'enviado',
        });

        logger.info(`[DailyDigest] Resumo diário enviado com ${resumo.total} comunicado(s).`);
    } catch (err) {
        logger.error(`[DailyDigest] Erro ao enviar resumo diário: ${err.message}`);
    }
}

/**
 * Inicializa o job.
 * Horário: 19:00 UTC = 16:00 BRT (UTC-3)
 */
function iniciarDailyDigest() {
    // '0 19 * * *' = todo dia às 19:00 UTC (16:00 Brasília)
    cron.schedule('0 19 * * *', () => {
        enviarDigest();
    }, {
        timezone: 'UTC',
    });

    logger.info('[DailyDigest] Job agendado: resumo diário às 16h (BRT).');
}

module.exports = { iniciarDailyDigest, enviarDigest };
