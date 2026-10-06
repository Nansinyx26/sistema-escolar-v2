/**
 * DailyDigestJob.js
 * Executa todos os dias às 16h (horário de Brasília).
 * Cria, para cada escola ativa, uma Notificacao de resumo do dia via NotificationService
 * (Socket.IO para o sininho e Web Push para celulares), só para quem é da escola.
 */

const cron = require('node-cron');
const Comunicado = require('../models/Comunicado');
const Escola = require('../models/Escola');
const Notificacao = require('../models/Notificacao');
const NotificationService = require('../services/NotificationService');
const logger = require('../utils/logger');
const { executarComTravaJanela, formatarJanelaDia } = require('../utils/travaDistribuida');

/**
 * Início e fim do dia corrente (horário do servidor).
 */
function limitesDoDia(hoje = new Date()) {
    return {
        inicioDia: new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 0, 0, 0),
        fimDia: new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59),
    };
}

/**
 * Gera o texto do resumo diário de UMA escola (Issue #685).
 *
 * Entram só os comunicados da escola endereçados a `todos` e já publicados. O
 * resumo vai para a escola inteira, famílias incluídas: um comunicado interno,
 * de turma ou de família tem público próprio e já foi avisado a ele quando
 * saiu. Antes o resumo juntava os títulos de TODAS as escolas e de todos os
 * públicos e mandava para a rede inteira; e o agendado aparecia antes da hora.
 */
async function gerarResumo(escolaId) {
    const hoje = new Date();
    const { inicioDia, fimDia } = limitesDoDia(hoje);

    const dataFormatada = hoje.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
    });

    const comunicados = await Comunicado.find({
        escolaId: String(escolaId),
        ativo: true,
        destinatarios: 'todos',
        dataCriacao: { $gte: inicioDia, $lte: fimDia },
        $or: [{ dataAgendada: null }, { dataAgendada: { $lte: hoje } }],
    })
        .select('titulo categoria')
        .lean();

    if (comunicados.length === 0) {
        return {
            titulo: `Resumo do dia — ${dataFormatada}`,
            mensagem: `Olá! Não houve novos comunicados cadastrados hoje. Seu painel escolar permanece atualizado.`,
            total: 0,
        };
    }

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
 * Cria a notificação de resumo de cada escola ativa e dispara no sininho e no
 * celular de quem é daquela escola.
 */
async function enviarDigest(opcoesTrava = {}) {
    const janela = formatarJanelaDia();
    return executarComTravaJanela(
        'resumo-diario',
        janela,
        async () => {
            try {
                logger.info('[DailyDigest] Iniciando resumo diário das 16h...');

                const { inicioDia } = limitesDoDia();
                const escolas = await Escola.find({ ativo: true }).select('_id').lean();

                for (const escola of escolas) {
                    const escolaId = String(escola._id);

                    // Evita duplicata: um resumo por escola por dia.
                    const jaExiste = await Notificacao.findOne({
                        tipo: 'resumo_diario',
                        escolaId,
                        dataCriacao: { $gte: inicioDia },
                    });
                    if (jaExiste) continue;

                    const resumo = await gerarResumo(escolaId);
                    await NotificationService.notify({
                        tipo: 'resumo_diario',
                        categoria: 'direcao',
                        prioridade: 'normal',
                        titulo: resumo.titulo,
                        mensagem: resumo.mensagem,
                        destinatarios: 'todos',
                        paraResponsavel: true,
                        criadoPor: 'Sistema',
                        escolaId,
                    });

                    logger.info('[DailyDigest] Resumo diário enviado', {
                        escolaId,
                        comunicados: resumo.total,
                    });
                }
            } catch (err) {
                logger.error(`[DailyDigest] Erro ao enviar resumo diário: ${err.message}`);
            }
        },
        opcoesTrava
    );
}

/**
 * Inicializa o job.
 * Horário: 16:00 BRT (America/Sao_Paulo)
 */
function iniciarDailyDigest() {
    cron.schedule(
        '0 16 * * *',
        () => {
            enviarDigest();
        },
        {
            timezone: 'America/Sao_Paulo',
        }
    );

    logger.info('[DailyDigest] Job agendado: resumo diário às 16h (BRT).');
}

module.exports = { iniciarDailyDigest, enviarDigest, gerarResumo };
