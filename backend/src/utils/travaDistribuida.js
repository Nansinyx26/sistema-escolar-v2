/**
 * travaDistribuida.js — utilitário de travas distribuídas baseadas no MongoDB Atlas.
 *
 * Garante que rotinas agendadas (cron) e tarefas de inicialização executem
 * uma única vez quando o sistema rodar com múltiplas instâncias atrás de
 * balanceador de carga (Issue #336 / Épico #334).
 */

const os = require('node:os');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const TravaDistribuida = require('../models/TravaDistribuida');
const logger = require('./logger');

const ID_INSTANCIA =
    process.env.RENDER_INSTANCE_ID ||
    `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

function obterIdInstancia() {
    return ID_INSTANCIA;
}

/**
 * Retorna a data no formato YYYY-MM-DD no fuso de Brasília (America/Sao_Paulo).
 */
function formatarJanelaDia(data = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date(data));
}

/**
 * Retorna o mês no formato YYYY-MM no fuso de Brasília (America/Sao_Paulo).
 */
function formatarJanelaMes(data = new Date()) {
    return formatarJanelaDia(data).slice(0, 7);
}

function bancoConectado(model = TravaDistribuida) {
    const estado = model?.db?.readyState ?? mongoose.connection.readyState;
    return estado === 1;
}

/**
 * Executa uma rotina com trava atômica por janela de tempo.
 *
 * A chave `janela:<nomeRotina>:<janela>` é inserida com _id exclusivo.
 * Se colidir (E11000), significa que outra instância já executou nesta janela,
 * e a ação é ignorada.
 * A chave NÃO é deletada ao término (é limpa pelo índice TTL).
 */
async function executarComTravaJanela(nomeRotina, janela, acao, opcoes = {}) {
    const {
        ttlSegundos = 48 * 3600, // 48 horas padrão
        meta = {},
        model = TravaDistribuida,
        dono = ID_INSTANCIA,
    } = opcoes;

    const chave = `janela:${nomeRotina}:${janela}`;

    if (!bancoConectado(model)) {
        logger.warn('[trava-distribuida] Banco indisponível; pulando execução de rotina agendada', {
            rotina: nomeRotina,
            chave,
            action: 'trava.banco_indisponivel',
            ...meta,
        });
        return { executou: false, motivo: 'banco_indisponivel' };
    }

    const agora = new Date();
    const expiraEm = new Date(agora.getTime() + ttlSegundos * 1000);

    try {
        await model.create({
            _id: chave,
            tipo: 'janela',
            dono,
            adquiridaEm: agora,
            expiraEm,
        });
    } catch (err) {
        if (err?.code === 11000) {
            logger.info(
                '[trava-distribuida] Rotina pulada: já executada por outra instância nesta janela',
                {
                    rotina: nomeRotina,
                    chave,
                    action: 'trava.janela.pulada',
                    ...meta,
                }
            );
            return { executou: false, motivo: 'ja_executada' };
        }
        logger.error(
            '[trava-distribuida] Erro ao gravar trava de janela no banco; pulando rotina',
            {
                rotina: nomeRotina,
                chave,
                erro: err?.message,
                action: 'trava.erro_banco',
                ...meta,
            }
        );
        return { executou: false, motivo: 'erro_banco', erro: err };
    }

    try {
        const resultado = await acao();
        return { executou: true, resultado };
    } catch (err) {
        logger.error('[trava-distribuida] Erro na execução da rotina sob trava de janela', {
            rotina: nomeRotina,
            chave,
            erro: err?.message,
            action: 'trava.erro_execucao',
            ...meta,
        });
        throw err;
    }
}

/**
 * Executa uma rotina protegida por arrendamento (lease) com prazo determinado.
 *
 * Utilizado para seções críticas no boot ou operações de longa duração.
 * Se a instância morrer no meio, o arrendamento expira e outra instância
 * pode assumir após expiraEm.
 * Ao final do processamento com sucesso, o arrendamento é liberado.
 */
async function executarComArrendamento(nomeRotina, acao, opcoes = {}) {
    const {
        duracaoMs = 30000, // 30s padrão
        meta = {},
        model = TravaDistribuida,
        dono = ID_INSTANCIA,
    } = opcoes;

    const chave = `arrendamento:${nomeRotina}`;

    if (!bancoConectado(model)) {
        logger.warn(
            '[trava-distribuida] Banco indisponível; pulando execução de rotina com arrendamento',
            {
                rotina: nomeRotina,
                chave,
                action: 'trava.banco_indisponivel',
                ...meta,
            }
        );
        return { executou: false, motivo: 'banco_indisponivel' };
    }

    const agora = new Date();
    const expiraEm = new Date(agora.getTime() + duracaoMs);

    let adquiriu = false;

    try {
        await model.create({
            _id: chave,
            tipo: 'arrendamento',
            dono,
            adquiridaEm: agora,
            expiraEm,
        });
        adquiriu = true;
    } catch (err) {
        if (err?.code === 11000) {
            // Tenta assumir se o arrendamento anterior já expirou
            try {
                const renovado = await model.findOneAndUpdate(
                    {
                        _id: chave,
                        expiraEm: { $lte: agora },
                    },
                    {
                        $set: {
                            tipo: 'arrendamento',
                            dono,
                            adquiridaEm: agora,
                            expiraEm,
                        },
                    },
                    { new: true }
                );
                if (renovado) {
                    adquiriu = true;
                }
            } catch (subErr) {
                logger.error('[trava-distribuida] Erro ao tentar renovar arrendamento expirado', {
                    rotina: nomeRotina,
                    chave,
                    erro: subErr?.message,
                    action: 'trava.erro_banco',
                    ...meta,
                });
                return { executou: false, motivo: 'erro_banco', erro: subErr };
            }
        } else {
            logger.error(
                '[trava-distribuida] Erro ao gravar arrendamento no banco; pulando rotina',
                {
                    rotina: nomeRotina,
                    chave,
                    erro: err?.message,
                    action: 'trava.erro_banco',
                    ...meta,
                }
            );
            return { executou: false, motivo: 'erro_banco', erro: err };
        }
    }

    if (!adquiriu) {
        logger.info('[trava-distribuida] Rotina pulada: arrendamento ativo por outra instância', {
            rotina: nomeRotina,
            chave,
            action: 'trava.arrendamento.ocupado',
            ...meta,
        });
        return { executou: false, motivo: 'arrendamento_ocupado' };
    }

    try {
        const resultado = await acao();
        return { executou: true, resultado };
    } catch (err) {
        logger.error('[trava-distribuida] Erro na execução da rotina sob arrendamento', {
            rotina: nomeRotina,
            chave,
            erro: err?.message,
            action: 'trava.erro_execucao',
            ...meta,
        });
        throw err;
    } finally {
        try {
            await model.deleteOne({ _id: chave, dono });
        } catch (errDel) {
            logger.warn('[trava-distribuida] Falha ao liberar arrendamento após conclusão', {
                rotina: nomeRotina,
                chave,
                erro: errDel?.message,
                action: 'trava.liberar_falha',
                ...meta,
            });
        }
    }
}

module.exports = {
    obterIdInstancia,
    formatarJanelaDia,
    formatarJanelaMes,
    executarComTravaJanela,
    executarComArrendamento,
};
