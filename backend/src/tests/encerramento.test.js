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

// ─────────────────────────────────────────────────────────────────────────────
// Desligamento gracioso (Issue #335): o mesmo encerrador atende o SIGTERM do
// deploy. A ordem é o que importa — sair da rotação, drenar, liberar, sair.
// ─────────────────────────────────────────────────────────────────────────────
describe('desligamento gracioso (Issue #335)', () => {
    let server;

    afterEach(async () => {
        if (server?.listening) await new Promise((r) => server.close(r));
        server = null;
    });

    test('ordem: aoIniciar → io → drenagem → antesDeSair → saída com código 0', async () => {
        ({ server } = await subirServidor());
        const ordem = [];

        criarEncerrador({
            server,
            io: { close: () => ordem.push('io') },
            logger: loggerFalso(),
            prazoMs: 1000,
            sair: (codigo) => ordem.push(`exit:${codigo}`),
            aoIniciar: () => ordem.push('naoPronto'),
            antesDeSair: async () => {
                await new Promise((r) => setTimeout(r, 20));
                ordem.push('banco');
            },
        })(0);

        await new Promise((r) => setTimeout(r, 200));
        expect(ordem).toEqual(['naoPronto', 'io', 'banco', 'exit:0']);
    });

    test('requisição em andamento termina antes de a conexão com o banco fechar', async () => {
        const eventos = [];
        server = http.createServer((_req, res) => {
            setTimeout(() => {
                eventos.push('respondeu');
                res.end('ok');
            }, 150);
        });
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        const porta = server.address().port;

        const resposta = new Promise((resolve) => {
            // agent:false = conexão fechada ao fim da resposta, como a de um
            // navegador que saiu da página; o keep-alive é coberto pelo prazo.
            http.get({ host: '127.0.0.1', port: porta, path: '/', agent: false }, (res) => {
                res.resume();
                res.on('end', () => resolve(res.statusCode));
            });
        });
        await new Promise((r) => setTimeout(r, 30)); // a requisição já chegou

        const sair = jest.fn(() => eventos.push('saiu'));
        criarEncerrador({
            server,
            logger: loggerFalso(),
            prazoMs: 2000,
            sair,
            antesDeSair: () => eventos.push('banco'),
        })(0);

        expect(await resposta).toBe(200);
        await new Promise((r) => setTimeout(r, 50));
        expect(eventos).toEqual(['respondeu', 'banco', 'saiu']);
        expect(sair).toHaveBeenCalledWith(0);
    });

    test('antesDeSair que falha não impede a saída', async () => {
        ({ server } = await subirServidor());
        const sair = jest.fn();
        const logger = loggerFalso();

        criarEncerrador({
            server,
            logger,
            prazoMs: 500,
            sair,
            antesDeSair: async () => {
                throw new Error('banco já fechado');
            },
        })(0);

        await new Promise((r) => setTimeout(r, 150));
        expect(sair).toHaveBeenCalledWith(0);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('liberar recursos'));
    });

    test('antesDeSair que trava é cortado pelo prazo', async () => {
        ({ server } = await subirServidor());
        const sair = jest.fn();
        const logger = loggerFalso();

        criarEncerrador({
            server,
            logger,
            prazoMs: 150,
            sair,
            antesDeSair: () => new Promise(() => {}), // nunca termina
        })(0);

        await new Promise((r) => setTimeout(r, 300));
        expect(sair).toHaveBeenCalledWith(0);
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('não liberaram'));
    });

    test('prazo por chamada sobrepõe o do encerrador (SIGTERM espera mais que a exceção)', async () => {
        ({ server } = await subirServidor());
        const socketPreso = await prenderConexao(server.address().port);
        const sair = jest.fn();

        criarEncerrador({ server, logger: loggerFalso(), prazoMs: 100, sair })(0, {
            prazoMs: 400,
        });

        await new Promise((r) => setTimeout(r, 200));
        expect(sair).not.toHaveBeenCalled(); // o prazo de 100 ms foi substituído
        await new Promise((r) => setTimeout(r, 350));
        expect(sair).toHaveBeenCalledWith(0);
        socketPreso.destroy();
    });

    test('aoIniciar que lança não impede o encerramento', async () => {
        ({ server } = await subirServidor());
        const sair = jest.fn();

        criarEncerrador({
            server,
            logger: loggerFalso(),
            prazoMs: 300,
            sair,
            aoIniciar: () => {
                throw new Error('falhou');
            },
        })(0);

        await new Promise((r) => setTimeout(r, 150));
        expect(sair).toHaveBeenCalledWith(0);
    });
});
