/**
 * presencaEntreInstancias.test.js — presença online com mais de uma instância
 * do backend (Issue #339).
 *
 * Duas partes:
 *   1. `consultar()` / `estaOnline()` contra um `io` falso: agregação por
 *      usuário, filtro por escola, cache do "digitando" e queda para o mapa
 *      local quando o adapter não responde.
 *   2. Dois servidores Socket.IO de verdade, ligados pelo adapter do Mongo
 *      (o mesmo de `realtime/adapter.js`) num replica set em memória. Os
 *      clientes falam o protocolo do Socket.IO direto pelo `ws`, porque o
 *      backend não depende de `socket.io-client`.
 */
const http = require('http');
const WebSocket = require('ws');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/mongo-adapter');

const presence = require('../realtime/presence');
const { apagarCredenciaisDoHandshake } = require('../realtime/adapter');

let seq = 0;
const novoId = (prefixo) => `${prefixo}_${Date.now()}_${++seq}`;

/** Socket falso com o `data.presenca` que o index.js grava na conexão. */
function socketFalso(escolaId, userId) {
    const socket = { data: {} };
    presence.marcarSocket(socket, escolaId, userId);
    return socket;
}

/** `io` falso: cada sala devolve os sockets cadastrados, "de todas as instâncias". */
function ioFalso(salas) {
    const chamadas = [];
    return {
        chamadas,
        in(sala) {
            return {
                fetchSockets: async () => {
                    chamadas.push(sala);
                    return salas[sala] || [];
                },
            };
        },
    };
}

afterEach(() => presence.usarAdapter(null));

describe('presence.consultar — sem adapter', () => {
    it('lê o mapa deste processo, sem consultar ninguém', async () => {
        const escola = novoId('ESC');
        const u = novoId('user');
        presence.addUser(escola, u, 'sock1');

        const retrato = await presence.consultar(escola);
        expect(retrato.isOnline(u)).toBe(true);
        expect(retrato.statusDe(u)).toBe('online');
        expect(retrato.onlineUserIds()).toContain(u);

        presence.removeUser(escola, u, 'sock1');
        expect((await presence.consultar(escola)).isOnline(u)).toBe(false);
    });

    it('estaOnline responde pelo mapa local', async () => {
        const escola = novoId('ESC');
        const u = novoId('user');
        expect(await presence.estaOnline(escola, u)).toBe(false);
        presence.addUser(escola, u, 'sock1');
        expect(await presence.estaOnline(escola, u)).toBe(true);
        presence.removeUser(escola, u, 'sock1');
    });
});

describe('presence.consultar — com adapter', () => {
    it('vê online quem está conectado só em outra instância', async () => {
        const escola = novoId('ESC');
        const u = novoId('user');
        presence.usarAdapter(ioFalso({ [`escola:${escola}`]: [socketFalso(escola, u)] }));

        // O mapa deste processo não conhece o usuário…
        expect(presence.isOnline(escola, u)).toBe(false);
        // …mas a consulta pelo adapter conhece.
        const info = (await presence.consultar(escola)).infoDe(u);
        expect(info.status).toBe('online');
        expect(info.online).toBe(true);
        expect(info.onlineDesde).toBeInstanceOf(Date);
        expect(info.ultimoAcesso).toBeInstanceOf(Date);
    });

    it('só fica ausente quando todas as abas, em todas as instâncias, estão ociosas', async () => {
        const escola = novoId('ESC');
        const u = novoId('user');
        const abaA = socketFalso(escola, u);
        const abaB = socketFalso(escola, u);
        presence.usarAdapter(ioFalso({ [`escola:${escola}`]: [abaA, abaB] }));

        presence.marcarAusenteNoSocket(abaA, true);
        expect((await presence.consultar(escola)).statusDe(u)).toBe('online');

        presence.marcarAusenteNoSocket(abaB, true);
        expect((await presence.consultar(escola)).statusDe(u)).toBe('ausente');
    });

    it('com userId consulta só a sala do usuário e ignora conexão em outra escola', async () => {
        const escolaA = novoId('ESC');
        const escolaB = novoId('ESC');
        const u = novoId('user');
        const io = ioFalso({ [`user:${u}`]: [socketFalso(escolaB, u)] });
        presence.usarAdapter(io);

        const retrato = await presence.consultar(escolaA, u);
        expect(io.chamadas).toEqual([`user:${u}`]);
        expect(retrato.statusDe(u)).toBe('offline');
        expect(retrato.infoDe(u).onlineDesde).toBeNull();
    });

    it('cai no mapa local, sem lançar, quando o adapter não responde', async () => {
        const escola = novoId('ESC');
        const u = novoId('user');
        presence.addUser(escola, u, 'sock1');
        presence.usarAdapter({
            in: () => ({
                fetchSockets: async () => {
                    throw new Error('timeout reached: only 0 responses received out of 1');
                },
            }),
        });

        expect((await presence.consultar(escola)).statusDe(u)).toBe('online');
        presence.removeUser(escola, u, 'sock1');
    });

    it('estaOnline guarda a resposta e não consulta o adapter a cada tecla', async () => {
        const escola = novoId('ESC');
        const u = novoId('user');
        const io = ioFalso({ [`user:${u}`]: [socketFalso(escola, u)] });
        presence.usarAdapter(io);

        expect(await presence.estaOnline(escola, u)).toBe(true);
        expect(await presence.estaOnline(escola, u)).toBe(true);
        expect(await presence.estaOnline(escola, u)).toBe(true);
        expect(io.chamadas).toHaveLength(1);
    });

    it('estaOnline recusa destinatário de outra escola', async () => {
        const escolaA = novoId('ESC');
        const escolaB = novoId('ESC');
        const u = novoId('user');
        presence.usarAdapter(ioFalso({ [`user:${u}`]: [socketFalso(escolaB, u)] }));

        expect(await presence.estaOnline(escolaA, u)).toBe(false);
    });
});

describe('apagarCredenciaisDoHandshake', () => {
    it('tira token, cookie e authorization do handshake', () => {
        const socket = {
            handshake: {
                auth: { token: 'jwt' },
                query: { token: 'jwt', EIO: '4' },
                headers: { cookie: 'escola_jwt=jwt', authorization: 'Bearer jwt', host: 'x' },
            },
        };
        apagarCredenciaisDoHandshake(socket);
        expect(socket.handshake.auth).toEqual({});
        expect(socket.handshake.query).toEqual({ EIO: '4' });
        expect(socket.handshake.headers).toEqual({ host: 'x' });
    });
});

// ── Duas instâncias de verdade ──────────────────────────────────────────────

/**
 * Cliente mínimo do protocolo do Socket.IO (Engine.IO v4) sobre `ws`.
 * Resolve quando o namespace "/" aceita a conexão.
 */
function conectarCliente(porta, auth) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${porta}/socket.io/?EIO=4&transport=websocket`);
        const eventos = [];
        const esperando = [];
        const cliente = {
            ws,
            emitir: (evento, dados) => ws.send(`42${JSON.stringify([evento, dados])}`),
            /** Promessa do próximo evento com esse nome (ou de um já recebido). */
            proximo: (evento) => {
                const i = eventos.findIndex(([nome]) => nome === evento);
                if (i >= 0) return Promise.resolve(eventos.splice(i, 1)[0][1]);
                return new Promise((ok) => esperando.push({ evento, ok }));
            },
            fechar: () =>
                new Promise((ok) => {
                    if (ws.readyState === WebSocket.CLOSED) return ok();
                    ws.once('close', ok);
                    ws.close();
                }),
        };
        ws.on('message', (buf) => {
            const msg = buf.toString();
            if (msg.startsWith('0')) ws.send(`40${JSON.stringify(auth)}`);
            else if (msg === '2') ws.send('3');
            else if (msg.startsWith('40')) resolve(cliente);
            else if (msg.startsWith('44')) reject(new Error(msg));
            else if (msg.startsWith('42')) {
                const [evento, dados] = JSON.parse(msg.slice(2));
                const i = esperando.findIndex((e) => e.evento === evento);
                if (i >= 0) esperando.splice(i, 1)[0].ok(dados);
                else eventos.push([evento, dados]);
            }
        });
        ws.on('error', reject);
    });
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function ate(condicao, prazoMs = 15000) {
    const limite = Date.now() + prazoMs;
    while (Date.now() < limite) {
        if (await condicao()) return;
        await esperar(50);
    }
    throw new Error('condição não atingida no prazo');
}

describe('presença entre duas instâncias com o adapter do Mongo', () => {
    let replSet;
    let mongo;
    let colecao;
    let A;
    let B;
    const instancias = [];
    const clientes = [];

    /**
     * Sobe uma instância com o mesmo tratamento de presença e "digitando" do
     * index.js. Não chama `presence.addUser`: as duas instâncias rodam no mesmo
     * processo de teste e dividiriam o mapa em memória, o que esconderia o
     * problema. Tudo o que aparecer online aqui veio do adapter.
     */
    async function subirInstancia() {
        const servidor = http.createServer();
        const io = new Server(servidor, { adapter: createAdapter(colecao) });
        io.on('connection', (socket) => {
            const { userId, escolaId } = socket.handshake.auth;
            socket.join(`user:${userId}`);
            socket.join(`escola:${escolaId}`);
            presence.marcarSocket(socket, escolaId, userId);

            socket.on('presence:idle', (dados) =>
                presence.marcarAusenteNoSocket(socket, dados.ausente)
            );
            socket.on('chat:typing', async (dados) => {
                if (!(await presence.estaOnline(escolaId, dados.destinatarioId))) return;
                io.to(`user:${dados.destinatarioId}`).emit('chat:typing', {
                    remetenteId: String(userId),
                    isTyping: !!dados.isTyping,
                });
            });
        });
        await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
        const instancia = { io, servidor, porta: servidor.address().port };
        instancias.push(instancia);
        return instancia;
    }

    async function conectar(instancia, auth) {
        const cliente = await conectarCliente(instancia.porta, auth);
        clientes.push(cliente);
        return cliente;
    }

    beforeAll(async () => {
        replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
        mongo = new MongoClient(replSet.getUri());
        await mongo.connect();
        const db = mongo.db('adapter_presenca');
        await db.createCollection('socket_io_adapter_events', { capped: true, size: 1024 * 1024 });
        colecao = db.collection('socket_io_adapter_events');

        A = await subirInstancia();
        B = await subirInstancia();
        // As instâncias se descobrem pelo heartbeat do adapter.
        await ate(
            async () =>
                (await A.io.of('/').adapter.serverCount()) === 2 &&
                (await B.io.of('/').adapter.serverCount()) === 2
        );
    }, 120000);

    afterAll(async () => {
        await Promise.all(clientes.map((c) => c.fechar()));
        for (const { io, servidor } of instancias) {
            io.close();
            await new Promise((ok) => servidor.close(() => ok()));
        }
        if (mongo) await mongo.close();
        if (replSet) await replSet.stop();
    }, 60000);

    const escola = novoId('ESC');
    const outraEscola = novoId('ESC');
    const professora = novoId('prof');
    const diretor = novoId('dir');

    // O afterEach do topo desliga o adapter entre os testes.
    beforeEach(() => presence.usarAdapter(B.io));

    it('quem está conectado em A aparece online para quem consulta por B', async () => {
        await conectar(A, { userId: professora, escolaId: escola });

        await ate(async () => (await presence.consultar(escola)).isOnline(professora));
        const info = (await presence.consultar(escola)).infoDe(professora);
        expect(info.status).toBe('online');
        expect(info.onlineDesde).toBeInstanceOf(Date);

        // Consulta de um usuário só (cabeçalho da conversa) também enxerga A.
        expect((await presence.consultar(escola, professora)).statusDe(professora)).toBe('online');
        // E não vaza para outra escola.
        expect((await presence.consultar(outraEscola)).isOnline(professora)).toBe(false);
    });

    it('a aba ociosa em A vira "ausente" para quem consulta por B', async () => {
        const cliente = clientes[0];
        cliente.emitir('presence:idle', { ausente: true });
        await ate(
            async () => (await presence.consultar(escola)).statusDe(professora) === 'ausente'
        );

        cliente.emitir('presence:idle', { ausente: false });
        await ate(async () => (await presence.consultar(escola)).statusDe(professora) === 'online');
    });

    it('"digitando" enviado por B chega ao destinatário conectado em A', async () => {
        const noB = await conectar(B, { userId: diretor, escolaId: escola });
        const noA = clientes[0];

        noB.emitir('chat:typing', { destinatarioId: professora, isTyping: true });
        await expect(noA.proximo('chat:typing')).resolves.toEqual({
            remetenteId: diretor,
            isTyping: true,
        });
    });

    it('fica offline quando a conexão em A cai', async () => {
        await clientes[0].fechar();
        await ate(async () => !(await presence.consultar(escola)).isOnline(professora));
        expect((await presence.consultar(escola)).statusDe(professora)).toBe('offline');
    });
});
