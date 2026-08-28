/**
 * moderacaoQueue.js — fila de análise: enfileirar, consumir, desistir direito.
 *
 * REGRA QUE GOVERNA ESTE ARQUIVO
 * ==============================
 * Job que esgota as tentativas NÃO é descartado — vira `em_revisao` na fila
 * humana. Descarte silencioso numa fila de moderação significa conteúdo que
 * ninguém analisou e ninguém sabe que não foi analisado; é o pior desfecho
 * possível, pior que reter um anexo legítimo por engano.
 *
 * O worker é in-process (`setInterval`), concorrência 2, backoff exponencial de
 * 1 s a 60 s, máximo 5 tentativas — §8.5.
 *
 * KILL-SWITCH: `MODERACAO_WORKER_ATIVO=false` desliga o laço. Sem isso o worker
 * gira durante a suíte do Jest, contra o banco in-memory de cada worker de
 * teste, e vira ruído que ninguém consegue depurar. Em `NODE_ENV=test` ele
 * nasce desligado mesmo sem a variável.
 */

const crypto = require('node:crypto');
const ModeracaoJob = require('../../../models/ModeracaoJob');
const logger = require('../../../utils/logger');

const MAX_TENTATIVAS = 5;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_TETO_MS = 60_000;
const CONCORRENCIA = 2;
const INTERVALO_MS = 5000;

// Identifica ESTA instância. Com mais de um processo consumindo a coleção, é o
// que permite saber quem travou o quê.
const INSTANCIA = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

/** tipo → handler. Um tipo sem handler registrado nunca é consumido. */
const handlers = new Map();

let timer = null;
let rodando = false;

function registrarHandler(tipo, fn) {
    if (typeof fn !== 'function') throw new TypeError(`Handler de "${tipo}" precisa ser função.`);
    handlers.set(tipo, fn);
}

function limparHandlers() {
    handlers.clear();
}

/**
 * Coloca um job na fila.
 *
 * @param {string} tipo
 * @param {Object} payload  Só referências — nunca o conteúdo analisado.
 * @param {Object} [opcoes]
 * @param {string} [opcoes.escolaId]
 * @param {Date}   [opcoes.agendarPara]
 */
async function enfileirar(tipo, payload = {}, opcoes = {}) {
    return ModeracaoJob.create({
        tipo,
        payload,
        escolaId: opcoes.escolaId ? String(opcoes.escolaId) : undefined,
        proximaTentativaEm: opcoes.agendarPara || new Date(),
    });
}

/** 1 s, 2 s, 4 s, 8 s… com teto de 60 s. */
function atrasoDaTentativa(tentativas) {
    return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, tentativas - 1), BACKOFF_TETO_MS);
}

/**
 * Pega UM job pendente e o trava, atomicamente.
 *
 * `findOneAndUpdate` numa operação só é o que impede duas instâncias (ou dois
 * ticks sobrepostos do mesmo processo) de processarem o mesmo job. Fazer
 * `findOne` e depois `save()` abriria exatamente essa janela.
 */
async function reservarJob(agora = new Date()) {
    const tipos = [...handlers.keys()];
    if (tipos.length === 0) return null;

    return ModeracaoJob.findOneAndUpdate(
        {
            status: 'pendente',
            tipo: { $in: tipos },
            proximaTentativaEm: { $lte: agora },
        },
        {
            $set: { status: 'processando', travadoPor: INSTANCIA, travadoEm: agora },
            $inc: { tentativas: 1 },
        },
        { sort: { proximaTentativaEm: 1 }, new: true }
    );
}

/**
 * Executa um job já reservado, tratando sucesso, retentativa e desistência.
 *
 * @returns {Promise<'concluido'|'reagendado'|'falhou'>}
 */
async function executarJob(job) {
    const handler = handlers.get(job.tipo);
    if (!handler) {
        // Tipo sem handler não deveria ter sido reservado; se chegou aqui, é
        // porque o handler foi removido no meio do caminho. Devolve à fila.
        await ModeracaoJob.updateOne(
            { _id: job._id },
            { $set: { status: 'pendente', travadoPor: null } }
        );
        return 'reagendado';
    }

    try {
        await handler(job.payload, job);
        await ModeracaoJob.updateOne(
            { _id: job._id },
            {
                $set: {
                    status: 'concluido',
                    concluidoEm: new Date(),
                    travadoPor: null,
                    ultimoErro: null,
                },
            }
        );
        return 'concluido';
    } catch (erro) {
        const esgotou = job.tentativas >= MAX_TENTATIVAS;

        if (!esgotou) {
            await ModeracaoJob.updateOne(
                { _id: job._id },
                {
                    $set: {
                        status: 'pendente',
                        travadoPor: null,
                        ultimoErro: erro.message,
                        proximaTentativaEm: new Date(
                            Date.now() + atrasoDaTentativa(job.tentativas)
                        ),
                    },
                }
            );
            return 'reagendado';
        }

        await ModeracaoJob.updateOne(
            { _id: job._id },
            {
                $set: {
                    status: 'falhou',
                    travadoPor: null,
                    ultimoErro: erro.message,
                    concluidoEm: new Date(),
                },
            }
        );

        // O fail-safe: o conteúdo vai para a revisão humana em vez de sumir.
        // Feito aqui e não no handler porque vale para QUALQUER tipo de job —
        // um handler novo não precisa lembrar de implementar isso.
        await encaminharParaRevisaoHumana(job, erro);
        return 'falhou';
    }
}

/**
 * Job esgotado ⇒ a ocorrência (se houver) entra na fila humana.
 *
 * `require` tardio de propósito: `ModeracaoService` importa esta fila para
 * enfileirar, e importá-lo no topo daqui fecharia um ciclo — que a regra
 * `sem-ciclos` do dependency-cruiser reprova, com razão.
 */
async function encaminharParaRevisaoHumana(job, erro) {
    try {
        const ocorrenciaId = job.payload?.ocorrenciaId;
        if (!ocorrenciaId) return;

        const ModeracaoOcorrencia = require('../../../models/ModeracaoOcorrencia');
        await ModeracaoOcorrencia.updateOne(
            { _id: ocorrenciaId },
            { $set: { decisaoAutomatica: 'em_revisao', statusAtual: 'pendente' } }
        );

        logger.warn(
            `[Moderacao] Job ${job.tipo} esgotou ${MAX_TENTATIVAS} tentativas — ocorrência enviada à revisão humana.`,
            { jobId: String(job._id), erro: erro.message }
        );
    } catch (e) {
        logger.error('[Moderacao] Falha ao encaminhar job esgotado para revisão humana', {
            erro: e.message,
        });
    }
}

/**
 * Processa até `CONCORRENCIA` jobs. Exportado para os testes chamarem
 * diretamente — testar uma fila esperando `setInterval` é receita de teste
 * lento e intermitente.
 *
 * @returns {Promise<{processados:number, resultados:string[]}>}
 */
async function processarUmLote(agora = new Date()) {
    const resultados = [];

    for (let i = 0; i < CONCORRENCIA; i++) {
        const job = await reservarJob(agora);
        if (!job) break;
        resultados.push(await executarJob(job));
    }

    return { processados: resultados.length, resultados };
}

function workerHabilitado() {
    if (String(process.env.MODERACAO_WORKER_ATIVO || '').toLowerCase() === 'false') return false;
    if (process.env.NODE_ENV === 'test') return false;
    return true;
}

function iniciarWorker() {
    if (timer || !workerHabilitado()) return false;

    timer = setInterval(async () => {
        if (rodando) return; // tick anterior ainda em execução
        rodando = true;
        try {
            await processarUmLote();
        } catch (erro) {
            logger.error('[Moderacao] Falha no laço do worker', { erro: erro.message });
        } finally {
            rodando = false;
        }
    }, INTERVALO_MS);

    // Sem `unref`, este timer segura o processo vivo e o Jest reclama de handle
    // aberto mesmo com o worker desligado por engano.
    if (typeof timer.unref === 'function') timer.unref();

    logger.info('[Moderacao] Worker de fila iniciado.');
    return true;
}

function pararWorker() {
    if (!timer) return false;
    clearInterval(timer);
    timer = null;
    return true;
}

module.exports = {
    enfileirar,
    registrarHandler,
    limparHandlers,
    processarUmLote,
    reservarJob,
    executarJob,
    iniciarWorker,
    pararWorker,
    workerHabilitado,
    atrasoDaTentativa,
    MAX_TENTATIVAS,
    CONCORRENCIA,
    INSTANCIA,
};
