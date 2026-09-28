/**
 * SystemUpdateJob.js
 * Executa no dia 1 de cada mês, às 7h (horário de Brasília), e envia UM resumo
 * com as novidades, melhorias e correções do mês anterior (config/changelog.js)
 * para todos os usuários de todas as escolas ativas via NotificationService.
 *
 * Só entram os itens que mudam algo para o usuário (itens `interno` ficam de
 * fora). Mês sem nada relevante não gera envio. Cada resumo sai UMA única vez
 * por escola — a checagem de duplicata e a trava mensal garantem isso.
 */

const cron = require('node-cron');
const Escola = require('../models/Escola');
const Notificacao = require('../models/Notificacao');
const NotificationService = require('../services/NotificationService');
const { mesAnterior, montarResumoMensal } = require('../config/changelog');
const logger = require('../utils/logger');
const { executarComTravaJanela, formatarJanelaMes } = require('../utils/travaDistribuida');

const TIPO = 'atualizacao_sistema';

/**
 * Já foi anunciada esta versão para esta escola?
 * Dedup por tipo + título (o título carrega o mês) + escola.
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
        escolaId: escolaId || null,
    });
    return true;
}

/**
 * Rotina principal: envia o resumo do mês anterior, se houver o que contar.
 */
async function anunciarAtualizacao(opcoesTrava = {}) {
    const janela = formatarJanelaMes();
    return executarComTravaJanela(
        'aviso-atualizacao-mensal',
        janela,
        async () => {
            try {
                const notif = montarResumoMensal(mesAnterior(janela));
                if (!notif) {
                    logger.info('[SystemUpdate] Nada relevante no mês anterior. Nenhum e-mail.');
                    return;
                }

                logger.info(`[SystemUpdate] Enviando resumo de ${notif.mesNome}...`);

                const escolas = await Escola.find({ ativo: true }).select('_id').lean();

                // Sem escolas cadastradas (pré-migração/testes): envia uma vez sem escola.
                if (escolas.length === 0) {
                    const enviado = await anunciarParaEscola(notif, null);
                    logger.info(
                        `[SystemUpdate] Sem escolas ativas. ${enviado ? 'Anúncio enviado.' : 'Já anunciado antes.'}`
                    );
                    return;
                }

                let enviados = 0;
                for (const escola of escolas) {
                    if (await anunciarParaEscola(notif, String(escola._id))) {
                        enviados += 1;
                    }
                }

                if (enviados > 0) {
                    logger.info(
                        `[SystemUpdate] Resumo de ${notif.mesNome} enviado para ${enviados} escola(s).`
                    );
                } else {
                    logger.info(`[SystemUpdate] Resumo de ${notif.mesNome} já havia sido enviado.`);
                }
            } catch (err) {
                logger.error(`[SystemUpdate] Erro ao anunciar atualização: ${err.message}`);
            }
        },
        opcoesTrava
    );
}

/**
 * Inicializa o job: dia 1 de cada mês, às 07:00 (horário de Brasília).
 */
function iniciarSystemUpdateJob() {
    cron.schedule(
        '0 7 1 * *',
        () => {
            anunciarAtualizacao();
        },
        {
            timezone: 'America/Sao_Paulo',
        }
    );

    logger.info('[SystemUpdate] Job agendado: resumo mensal de novidades no dia 1, às 7h (BRT).');
}

module.exports = { iniciarSystemUpdateJob, anunciarAtualizacao };
