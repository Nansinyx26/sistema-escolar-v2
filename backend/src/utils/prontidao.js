/**
 * prontidao.js — a instância pode receber tráfego agora?
 *
 * DUAS PERGUNTAS DIFERENTES (Issue #335)
 * --------------------------------------
 * Um balanceador faz duas perguntas a cada instância, e elas não podem ter a
 * mesma resposta:
 *
 *   - "o processo está vivo?"  → GET /health. Não consulta nada: se respondeu,
 *     está vivo. É o que decide REINICIAR a instância.
 *   - "posso mandar requisição?" → GET /ready. Confere o banco e o encerramento.
 *     É o que decide TIRAR a instância da rotação, sem reiniciá-la.
 *
 * Misturar as duas é o erro clássico. O `/api/health` antigo devolve 503
 * quando o Mongo oscila: um balanceador que o use como liveness reinicia uma
 * instância que só precisava esperar o Atlas voltar — e, como todas oscilam
 * juntas, reinicia todas ao mesmo tempo.
 *
 * O ESTADO "ENCERRANDO"
 * ---------------------
 * No `SIGTERM` a instância passa a responder 503 no /ready antes de fechar
 * qualquer coisa, para o balanceador parar de mandar requisição nova enquanto
 * as que já chegaram terminam. Ver utils/encerramento.js.
 *
 * O `ping` ao banco tem prazo curto e resultado reaproveitado por um instante:
 * a rota é pública, e sem isso qualquer um transformaria o /ready num gerador
 * de consultas ao Atlas.
 */
const mongoose = require('mongoose');

const PRAZO_PING_MS = 2000;
const VALIDADE_RESULTADO_MS = 1000;

let encerrando = false;
let ultimo = null; // { resultado, em }
let emAndamento = null;

/** Marca a instância como encerrando. Não tem volta: o processo vai sair. */
function marcarEncerrando() {
    encerrando = true;
}

function estaEncerrando() {
    return encerrando;
}

/** Rejeita se a promessa não resolver dentro do prazo. */
function comPrazo(promessa, prazoMs) {
    let temporizador;
    const limite = new Promise((_, rejeitar) => {
        temporizador = setTimeout(() => rejeitar(new Error('prazo esgotado')), prazoMs);
        temporizador.unref();
    });
    return Promise.race([promessa, limite]).finally(() => clearTimeout(temporizador));
}

async function consultarBanco(prazoMs) {
    const conexao = mongoose.connection;
    if (conexao.readyState !== 1 || !conexao.db) return false;
    try {
        await comPrazo(conexao.db.admin().ping(), prazoMs);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {object} [opcoes]
 * @param {number} [opcoes.prazoMs]  prazo do ping ao banco
 * @param {boolean} [opcoes.semCache] ignora o resultado recente (testes)
 * @returns {Promise<{ pronto: boolean, checks: Record<string, string> }>}
 */
async function verificarProntidao({ prazoMs = PRAZO_PING_MS, semCache = false } = {}) {
    // O encerramento vale na hora, sem esperar o cache vencer: é justamente o
    // sinal que o balanceador precisa ver primeiro.
    if (encerrando) {
        return { pronto: false, checks: { instancia: 'shutting_down' } };
    }

    if (!semCache && ultimo && Date.now() - ultimo.em < VALIDADE_RESULTADO_MS) {
        return ultimo.resultado;
    }

    // Várias sondas simultâneas dividem o mesmo ping.
    if (!emAndamento) {
        emAndamento = consultarBanco(prazoMs)
            .then((ok) => {
                const resultado = {
                    pronto: ok,
                    checks: { mongodb: ok ? 'ok' : 'unavailable' },
                };
                ultimo = { resultado, em: Date.now() };
                return resultado;
            })
            .finally(() => {
                emAndamento = null;
            });
    }
    return emAndamento;
}

/** Só para testes: volta ao estado de processo recém-iniciado. */
function _reiniciarParaTeste() {
    encerrando = false;
    ultimo = null;
    emAndamento = null;
}

module.exports = {
    verificarProntidao,
    marcarEncerrando,
    estaEncerrando,
    _reiniciarParaTeste,
};
