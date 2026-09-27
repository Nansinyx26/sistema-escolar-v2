/**
 * realtimeInterseccao.test.js — Issue #455.
 *
 * `io.to(escola).to(perfil)` no Socket.IO é UNIÃO. O `emitirParaPerfis`
 * encadeava as duas salas achando que era interseção, e o `new-registration`
 * (nome do responsável e da criança) chegava à escola inteira e à direção de
 * todas as escolas.
 */
const { emitirParaPerfis } = require('../utils/realtime');

/**
 * Socket.IO de mentira com a semântica real das duas operações usadas:
 *  - `to(a).to(b)` acumula salas e entrega a quem está em QUALQUER uma;
 *  - `in(sala).fetchSockets()` devolve os sockets daquela sala.
 */
function fakeIo(conectados) {
    const recebidos = new Map();
    const sockets = conectados.map(({ nome, rooms }) => ({
        nome,
        rooms: new Set(rooms),
        emit(evento, payload) {
            if (!recebidos.has(nome)) recebidos.set(nome, []);
            recebidos.get(nome).push({ evento, payload });
        },
    }));
    const encadear = (salas) => ({
        to: (sala) => encadear([...salas, sala]),
        emit: (evento, payload) => {
            for (const s of sockets) {
                if (salas.some((r) => s.rooms.has(r))) s.emit(evento, payload);
            }
        },
    });
    return {
        recebidos,
        io: {
            to: (sala) => encadear([sala]),
            in: (sala) => ({ fetchSockets: async () => sockets.filter((s) => s.rooms.has(sala)) }),
        },
    };
}

const REDE = [
    { nome: 'diretor-A', rooms: ['escola:A', 'role:diretor', 'user:d1'] },
    { nome: 'secretaria-A', rooms: ['escola:A', 'role:secretaria', 'user:s1'] },
    { nome: 'professor-A', rooms: ['escola:A', 'role:professor', 'user:p1'] },
    { nome: 'responsavel-A', rooms: ['escola:A', 'role:responsavel', 'user:r1'] },
    { nome: 'diretor-B', rooms: ['escola:B', 'role:diretor', 'user:d2'] },
];

afterEach(() => {
    delete global.io;
});

describe('emitirParaPerfis — interseção escola × perfil', () => {
    it('entrega só a quem está na escola E tem um dos perfis', async () => {
        const { io, recebidos } = fakeIo(REDE);
        global.io = io;

        const entregues = await emitirParaPerfis(
            'A',
            ['diretor', 'secretaria'],
            'new-registration',
            { nome: 'Responsável', alunoVinculado: 'Criança' }
        );

        expect(entregues).toBe(2);
        expect([...recebidos.keys()].sort()).toEqual(['diretor-A', 'secretaria-A']);
    });

    it('não entrega a responsável nem a professor da mesma escola', async () => {
        const { io, recebidos } = fakeIo(REDE);
        global.io = io;

        await emitirParaPerfis('A', ['diretor'], 'documento_responsavel:novo', { id: 1 });

        expect(recebidos.has('responsavel-A')).toBe(false);
        expect(recebidos.has('professor-A')).toBe(false);
    });

    it('não entrega ao mesmo perfil de outra escola', async () => {
        const { io, recebidos } = fakeIo(REDE);
        global.io = io;

        await emitirParaPerfis('A', ['diretor'], 'new-registration', { nome: 'x' });

        expect(recebidos.has('diretor-B')).toBe(false);
    });

    it('sem escola resolvida o evento é descartado, não vira broadcast', async () => {
        const { io, recebidos } = fakeIo(REDE);
        global.io = io;
        const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const entregues = await emitirParaPerfis(null, ['diretor'], 'new-registration', {});

        expect(entregues).toBe(0);
        expect(recebidos.size).toBe(0);
        aviso.mockRestore();
    });

    it('falha ao consultar as salas não rejeita — quem chama não aguarda', async () => {
        global.io = {
            in: () => ({
                fetchSockets: async () => {
                    throw new Error('timeout do adapter');
                },
            }),
        };
        const aviso = jest.spyOn(console, 'warn').mockImplementation(() => {});

        await expect(emitirParaPerfis('A', ['diretor'], 'x', {})).resolves.toBe(0);
        expect(aviso).toHaveBeenCalled();
        aviso.mockRestore();
    });

    it('o encadeamento antigo seria união — a regressão que este teste trava', () => {
        const { io, recebidos } = fakeIo(REDE);
        io.to('escola:A').to('role:diretor').emit('x', {});
        // Com `to().to()` o responsável da escola A e o diretor da B recebem.
        expect(recebidos.has('responsavel-A')).toBe(true);
        expect(recebidos.has('diretor-B')).toBe(true);
    });
});
