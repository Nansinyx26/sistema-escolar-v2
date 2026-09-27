/**
 * mongoMemoria.test.js — subida do MongoDB em memória tolerante a carga.
 *
 * A biblioteca é substituída por um dublê: o que se testa é a política
 * (prazo repassado, nova tentativa, limpeza da instância que falhou), não o
 * `mongod` em si.
 */
const mockInstancias = [];
let mockFalhasRestantes = 0;

function mockDubleDe(tipo) {
    return jest.fn().mockImplementation((opts) => {
        const instancia = {
            tipo,
            opts,
            start: jest.fn(async () => {
                if (mockFalhasRestantes > 0) {
                    mockFalhasRestantes--;
                    throw new Error('Instance failed to start within 60000ms');
                }
            }),
            stop: jest.fn(async () => true),
        };
        mockInstancias.push(instancia);
        return instancia;
    });
}

jest.mock('mongodb-memory-server', () => ({
    MongoMemoryServer: mockDubleDe('server'),
    MongoMemoryReplSet: mockDubleDe('replset'),
}));

const { criarServidor, criarReplicaSet, PRAZO_SUBIDA_MS } = require('./mongoMemoria');

let avisos;
beforeEach(() => {
    mockInstancias.length = 0;
    mockFalhasRestantes = 0;
    avisos = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => avisos.mockRestore());

describe('mongoMemoria', () => {
    it('repassa o prazo de lançamento maior que os 10 s padrão', async () => {
        await criarServidor();
        expect(mockInstancias[0].opts.instance.launchTimeout).toBe(60000);
    });

    it('aplica o prazo a cada membro do replica set', async () => {
        await criarReplicaSet(2);
        const { opts } = mockInstancias[0];
        expect(opts.replSet.count).toBe(2);
        expect(opts.instanceOpts).toEqual([{ launchTimeout: 60000 }, { launchTimeout: 60000 }]);
    });

    it('tenta de novo e derruba a instância que falhou', async () => {
        mockFalhasRestantes = 2;
        const servidor = await criarReplicaSet();
        expect(mockInstancias).toHaveLength(3);
        expect(servidor).toBe(mockInstancias[2]);
        expect(mockInstancias[0].stop).toHaveBeenCalledWith({ doCleanup: true, force: true });
        expect(mockInstancias[1].stop).toHaveBeenCalledWith({ doCleanup: true, force: true });
        expect(mockInstancias[2].stop).not.toHaveBeenCalled();
    });

    it('esgotadas as tentativas, o erro original sobe', async () => {
        mockFalhasRestantes = 99;
        await expect(criarServidor()).rejects.toThrow('Instance failed to start within 60000ms');
        expect(mockInstancias).toHaveLength(3);
    });

    it('limpeza que falha não mascara a nova tentativa', async () => {
        mockFalhasRestantes = 1;
        const { MongoMemoryServer } = require('mongodb-memory-server');
        MongoMemoryServer.mockImplementationOnce((opts) => {
            const instancia = {
                opts,
                start: jest.fn(async () => {
                    mockFalhasRestantes--;
                    throw new Error('ECONNREFUSED');
                }),
                stop: jest.fn(async () => {
                    throw new Error('já parada');
                }),
            };
            mockInstancias.push(instancia);
            return instancia;
        });
        const servidor = await criarServidor();
        expect(mockInstancias).toHaveLength(2);
        expect(servidor).toBe(mockInstancias[1]);
    });

    it('o prazo total cobre todas as tentativas', () => {
        expect(PRAZO_SUBIDA_MS).toBeGreaterThanOrEqual(3 * 60000);
    });
});
