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
 * DESLIGAMENTO GRACIOSO (Issue #335)
 * ----------------------------------
 * O mesmo encerrador serve ao `SIGTERM` do deploy, com código 0. A diferença
 * para a saída por exceção está em dois ganchos:
 *
 * - `aoIniciar`: roda ANTES de fechar qualquer coisa. É onde a instância passa
 *   a responder 503 no /ready, para o balanceador parar de mandar requisição
 *   nova enquanto as que já chegaram terminam.
 * - `antesDeSair`: roda DEPOIS de o servidor drenar. É onde a conexão com o
 *   Mongo fecha — fechar antes derrubaria justamente as requisições que se
 *   estava esperando terminar.
 *
 * O prazo continua valendo sobre tudo, ganchos inclusive: um `close()` do
 * banco que trave não segura o processo.
 */

/**
 * @param {object} deps
 * @param {import('http').Server} deps.server  servidor HTTP que está escutando
 * @param {{ close?: Function }} [deps.io]     instância do Socket.IO, se houver
 * @param {{ warn: Function, info?: Function }} deps.logger
 * @param {number} [deps.prazoMs]
 * @param {(codigo: number) => void} [deps.sair]  injetável em teste
 * @param {(codigo: number) => void} [deps.aoIniciar]
 * @param {(codigo: number) => Promise<void>|void} [deps.antesDeSair]
 * @returns {(codigo: number, opcoes?: { prazoMs?: number }) => void}
 */
function criarEncerrador({ server, io, logger, prazoMs, sair, aoIniciar, antesDeSair }) {
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

    return function encerrarComPrazo(codigo, opcoes = {}) {
        if (encerrando) return;
        encerrando = true;
        const prazoDesta = Number(opcoes.prazoMs) || prazo;
        let drenou = false;

        if (typeof aoIniciar === 'function') {
            try {
                aoIniciar(codigo);
            } catch (e) {
                logger.warn(`[Encerramento] Falha no início do encerramento: ${e.message}`);
            }
        }

        if (io && typeof io.close === 'function') {
            try {
                io.close();
            } catch (e) {
                logger.warn(`[Encerramento] Falha ao fechar o Socket.IO: ${e.message}`);
            }
        }

        const prazoId = setTimeout(() => {
            logger.warn(
                drenou
                    ? `[Encerramento] Recursos não liberaram em ${prazoDesta}ms — saindo assim mesmo`
                    : `[Encerramento] Conexões não drenaram em ${prazoDesta}ms — saindo assim mesmo`
            );
            sairUmaVez(codigo);
        }, prazoDesta);

        // `unref()` é o que impede o prazo de virar custo: sem ele, uma saída
        // sem conexão pendente esperaria os ${prazo}ms inteiros.
        prazoId.unref();

        // O callback vem no evento 'close' do servidor, isto é, depois que a
        // última conexão terminou — também quando o `io.close()` acima já tiver
        // fechado o socket de escuta (aí ele chega com ERR_SERVER_NOT_RUNNING,
        // que aqui não muda nada).
        server.close(async () => {
            drenou = true;
            if (typeof antesDeSair === 'function') {
                try {
                    await antesDeSair(codigo);
                } catch (e) {
                    logger.warn(`[Encerramento] Falha ao liberar recursos: ${e.message}`);
                }
            }
            clearTimeout(prazoId);
            sairUmaVez(codigo);
        });
    };
}

module.exports = { criarEncerrador, PRAZO_PADRAO_MS };
