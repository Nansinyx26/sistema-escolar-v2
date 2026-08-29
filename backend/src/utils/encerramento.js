/**
 * encerramento.js — saída do processo com PRAZO MÁXIMO.
 *
 * POR QUE ESTE ARQUIVO EXISTE (Issue #125)
 * ----------------------------------------
 * Os handlers de última linha do processo faziam:
 *
 *     server.close(() => process.exit(1));
 *
 * `server.close()` fecha o socket de escuta, mas só chama o callback quando
 * TODAS as conexões abertas terminam. As do Socket.IO são persistentes por
 * natureza: enquanto houver uma aba do sistema aberta, elas não terminam
 * sozinhas — e `io.close()` nunca era chamado.
 *
 * O resultado era pior que o crash que o código tentava produzir:
 *
 *   1. o socket de escuta fechava   -> conexão nova passava a ser recusada;
 *   2. o callback não disparava     -> `process.exit(1)` nunca rodava;
 *   3. o processo continuava vivo   -> o Render não reiniciava o serviço.
 *
 * Um crash reinicia sozinho em segundos. Isso ficava fora do ar até alguém
 * perceber e reiniciar à mão — e acontecia justamente no horário de uso, que
 * é quando há aba aberta.
 *
 * O `keepAliveTimeout` padrão do Node (5s) drena as conexões HTTP comuns, então
 * o problema é específico do WebSocket — que este sistema usa em chat, presença
 * e notificações.
 *
 * O QUE ESTA FUNÇÃO GARANTE
 * -------------------------
 * - `io.close()` primeiro: derruba os WebSockets, que é a causa comum.
 * - `server.close()` depois: caminho normal, sai assim que drenar.
 * - Um prazo com `unref()`: sai de qualquer jeito, inclusive nos cenários que
 *   ninguém previu. O `unref()` é o que impede o prazo de virar custo no
 *   caminho normal — sem ele, uma saída sem conexão pendente passaria a
 *   esperar os 5s inteiros.
 *
 * O código de saída é sempre repassado, para o Render continuar tratando 1
 * como falha e reiniciar.
 */

const PRAZO_PADRAO_MS = 5000;

/**
 * @param {object} deps
 * @param {import('http').Server} deps.server  servidor HTTP que está escutando
 * @param {{ close?: Function }} [deps.io]     instância do Socket.IO, se houver
 * @param {{ warn: Function }} deps.logger
 * @param {number} [deps.prazoMs]
 * @param {(codigo: number) => void} [deps.sair]  injetável em teste
 * @returns {(codigo: number) => void}
 */
function criarEncerrador({ server, io, logger, prazoMs, sair }) {
    const prazo = Number(prazoMs) || PRAZO_PADRAO_MS;
    const encerrar = typeof sair === 'function' ? sair : (codigo) => process.exit(codigo);

    // Duas saídas podem ser disparadas quase juntas (uma exceção que gera uma
    // rejeição, por exemplo). A primeira que chegar vale; as demais não podem
    // reagendar prazo nem re-fechar o servidor. `saiu` é separado porque o
    // prazo e o callback do close() são caminhos concorrentes: quem chegar
    // primeiro sai, e o outro não pode sair de novo nem logar um aviso de
    // drenagem que não aconteceu.
    let encerrando = false;
    let saiu = false;

    const sairUmaVez = (codigo) => {
        if (saiu) return;
        saiu = true;
        encerrar(codigo);
    };

    return function encerrarComPrazo(codigo) {
        if (encerrando) return;
        encerrando = true;

        if (io && typeof io.close === 'function') {
            try {
                io.close();
            } catch (e) {
                logger.warn(`[Encerramento] Falha ao fechar o Socket.IO: ${e.message}`);
            }
        }

        const prazoId = setTimeout(() => {
            logger.warn(`[Encerramento] Conexões não drenaram em ${prazo}ms — saindo assim mesmo`);
            sairUmaVez(codigo);
        }, prazo);

        // `unref()` é o que impede o prazo de virar custo: sem ele, uma saída
        // sem conexão pendente esperaria os ${prazo}ms inteiros.
        prazoId.unref();

        server.close(() => {
            clearTimeout(prazoId);
            sairUmaVez(codigo);
        });
    };
}

module.exports = { criarEncerrador, PRAZO_PADRAO_MS };
