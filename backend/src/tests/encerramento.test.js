/**
 * encerramento.test.js — Issue #125
 *
 * O defeito não era o servidor não fechar: era o processo NÃO SAIR. Com uma
 * conexão persistente aberta, o callback de `server.close()` nunca dispara, e
 * o `process.exit()` que morava dentro dele nunca rodava — o servidor virava
 * zumbi (recusa conexão nova, mas continua vivo, então o Render não reinicia).
 *
 * Por isso o teste sobe um servidor HTTP DE VERDADE e prende uma conexão nele.
 * A conexão é um socket TCP com requisição pela metade (headers sem a linha em
 * branco final): o Node a considera ativa, não ociosa, então `close()` espera —
 * exatamente a condição que o WebSocket do Socket.IO cria em produção.
 *
 * `sair` é injetado no lugar de `process.exit` porque o teste precisa observar
 * a saída, não sofrê-la.
 */
const http = require('node:http');
const net = require('node:net');

const { criarEncerrador, PRAZO_PADRAO_MS } = require('../utils/encerramento');

const loggerFalso = () => ({ warn: jest.fn() });

/** Sobe um servidor real numa porta livre. */
function subirServidor() {
    return new Promise((resolve) => {
        const server = http.createServer((_req, res) => res.end('ok'));
        server.listen(0, '127.0.0.1', () => resolve({ server, porta: server.address().port }));
    });
}

/** Abre um socket e deixa a requisição pela metade, para o servidor não a considerar ociosa. */
function prenderConexao(porta) {
    return new Promise((resolve) => {
        const socket = net.connect(porta, '127.0.0.1', () => {
            socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n'); // sem o \r\n final
            resolve(socket);
        });
        socket.on('error', () => {});
    });
}

describe('encerramento do processo (Issue #125)', () => {
    let server;
    let socketPreso;

    afterEach(async () => {
        if (socketPreso) socketPreso.destroy();
        socketPreso = null;
        if (server?.listening) await new Promise((r) => server.close(r));
        server = null;
    });

    test('sai dentro do prazo mesmo com conexão presa — sem o prazo, ficaria zumbi', async () => {
        ({ server } = await subirServidor());
        socketPreso = await prenderConexao(server.address().port);

        const sair = jest.fn();
        const logger = loggerFalso();
        const encerrar = criarEncerrador({ server, logger, prazoMs: 300, sair });

        // Prova do defeito: com a conexão presa, o callback do close() não vem.
        const closeCompletou = jest.fn();
        encerrar(1);
        server.on('close', closeCompletou);

        await new Promise((r) => setTimeout(r, 100));
        expect(sair).not.toHaveBeenCalled(); // ainda dentro do prazo

        await new Promise((r) => setTimeout(r, 350));
        expect(sair).toHaveBeenCalledWith(1); // o prazo salvou a saída
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('não drenaram'));
    });

    test('sem conexão pendente a saída é imediata — o prazo não entra no caminho normal', async () => {
        ({ server } = await subirServidor());

        const sair = jest.fn();
        const logger = loggerFalso();
        const encerrar = criarEncerrador({ server, logger, prazoMs: 5000, sair });

        const t0 = Date.now();
        encerrar(1);
        await new Promise((r) => setTimeout(r, 150));

        expect(sair).toHaveBeenCalledWith(1);
        expect(Date.now() - t0).toBeLessThan(1000); // muito abaixo dos 5000 do prazo
        expect(logger.warn).not.toHaveBeenCalled(); // saiu pelo close(), não pelo prazo
    });

    test('preserva o código de saída — o Render precisa ver 1 para reiniciar', async () => {
        ({ server } = await subirServidor());

        const sair = jest.fn();
        criarEncerrador({ server, logger: loggerFalso(), prazoMs: 200, sair })(1);
        await new Promise((r) => setTimeout(r, 150));

        expect(sair).toHaveBeenCalledWith(1);
    });

    test('fecha o Socket.IO antes do servidor — é ele que segura as conexões', async () => {
        ({ server } = await subirServidor());

        const ordem = [];
        const io = { close: () => ordem.push('io') };
        const sair = jest.fn(() => ordem.push('exit'));

        criarEncerrador({ server, io, logger: loggerFalso(), prazoMs: 200, sair })(1);
        await new Promise((r) => setTimeout(r, 150));

        expect(ordem).toEqual(['io', 'exit']);
    });

    test('io.close() que estoura não impede a saída', async () => {
        ({ server } = await subirServidor());

        const io = {
            close: () => {
                throw new Error('io ja fechado');
            },
        };
        const sair = jest.fn();
        const logger = loggerFalso();

        criarEncerrador({ server, io, logger, prazoMs: 200, sair })(1);
        await new Promise((r) => setTimeout(r, 150));

        expect(sair).toHaveBeenCalledWith(1);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Socket.IO'));
    });

    test('duas chamadas seguidas não reagendam nem saem duas vezes', async () => {
        ({ server } = await subirServidor());

        const sair = jest.fn();
        const encerrar = criarEncerrador({ server, logger: loggerFalso(), prazoMs: 200, sair });

        encerrar(1);
        encerrar(1);
        await new Promise((r) => setTimeout(r, 300));

        expect(sair).toHaveBeenCalledTimes(1);
    });

    test('o prazo padrão é 5s — documentado e usado quando nada é passado', () => {
        expect(PRAZO_PADRAO_MS).toBe(5000);
    });
});
