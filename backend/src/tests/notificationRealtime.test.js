/**
 * notificationRealtime.test.js
 * Bloco 5: notificações persistem no banco, carregam escolaId (multi-tenant),
 * são emitidas por sala de perfil (não broadcast global) e os alvos de
 * e-mail/push são escopados por escola (incluindo legados sem escolaId).
 */
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const Usuario = require('../models/Usuario');
const Notificacao = require('../models/Notificacao');
const NotificationService = require('../services/NotificationService');

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    delete global.io;
});

/**
 * Socket.IO de mentira com a semântica que importa aqui:
 *  - `to(a).to(b)` acumula salas (no Socket.IO real é UNIÃO);
 *  - `in(sala).fetchSockets()` devolve os sockets conectados naquela sala,
 *    cada um com as suas `rooms` e o seu `emit`.
 */
function fakeIo(conectados = []) {
    const emitted = [];
    const recebidos = new Map(); // nome do socket → eventos
    const sockets = conectados.map(({ nome, rooms }) => ({
        rooms: new Set(rooms),
        emit(ev, payload) {
            if (!recebidos.has(nome)) recebidos.set(nome, []);
            recebidos.get(nome).push({ ev, payload });
        },
    }));
    const io = {
        _rooms: [],
        to(room) {
            this._rooms.push(...[].concat(room));
            return this;
        },
        emit(ev, payload) {
            emitted.push({ ev, rooms: [...this._rooms], payload });
            this._rooms = [];
        },
        in(room) {
            return { fetchSockets: async () => sockets.filter((s) => s.rooms.has(room)) };
        },
    };
    return { io, emitted, recebidos };
}

describe('NotificationService.notify — realtime direcionado + multi-tenant', () => {
    it('persiste a notificação com escolaId e paraResponsavel', async () => {
        const { io } = fakeIo();
        global.io = io;
        await NotificationService.notify({
            titulo: 'Reunião',
            mensagem: 'Amanhã',
            destinatarios: ['responsaveis'],
            criadoPor: null,
            escolaId: 'ESC_A',
        });
        const notif = await Notificacao.findOne({ titulo: 'Reunião' }).lean();
        expect(notif.escolaId).toBe('ESC_A');
        expect(notif.paraResponsavel).toBe(true);
    });

    it('entrega ao perfil destinatário DENTRO da escola — não à escola inteira nem ao perfil de outras escolas', async () => {
        const { io, emitted, recebidos } = fakeIo([
            { nome: 'prof-A', rooms: ['escola:ESC_A', 'role:professor', 'user:p1'] },
            { nome: 'pai-A', rooms: ['escola:ESC_A', 'role:responsavel', 'user:r1'] },
            { nome: 'prof-B', rooms: ['escola:ESC_B', 'role:professor', 'user:p2'] },
        ]);
        global.io = io;
        await NotificationService.notify({
            titulo: 'Só profs',
            mensagem: 'x',
            destinatarios: ['professores'],
            criadoPor: null,
            escolaId: 'ESC_A',
        });
        expect(emitted).toHaveLength(0); // nada de to(escola).to(perfil), que é união
        expect(recebidos.get('prof-A')).toHaveLength(1);
        expect(recebidos.has('pai-A')).toBe(false);
        expect(recebidos.has('prof-B')).toBe(false);

        const [{ ev, payload }] = recebidos.get('prof-A');
        expect(ev).toBe('notification:new');
        expect(payload.notification.titulo).toBe('Só profs');
        expect(payload.notification.escolaId).toBe('ESC_A');
    });

    it('"todos" sem escola atinge todas as salas de perfil', async () => {
        const { io, emitted } = fakeIo();
        global.io = io;
        await NotificationService.notify({
            titulo: 'Geral',
            mensagem: 'x',
            destinatarios: ['todos'],
            criadoPor: null,
        });
        const ev = emitted.find((e) => e.ev === 'notification:new');
        expect(ev.rooms).toEqual(
            expect.arrayContaining(['role:professor', 'role:responsavel', 'role:diretor'])
        );
        expect(ev.payload).toHaveProperty('notification');
    });

    it('getTargetUsers escopa por escola e inclui legados sem escolaId', async () => {
        await Usuario.create({
            nome: 'Pai A',
            email: 'a@t.com',
            senha: 'x',
            perfil: 'responsavel',
            ativo: true,
            escolaId: 'ESC_A',
            cpf: '1',
            telefone: 't',
        });
        await Usuario.create({
            nome: 'Pai B',
            email: 'b@t.com',
            senha: 'x',
            perfil: 'responsavel',
            ativo: true,
            escolaId: 'ESC_B',
            cpf: '2',
            telefone: 't',
        });
        await Usuario.create({
            nome: 'Pai Legado',
            email: 'c@t.com',
            senha: 'x',
            perfil: 'responsavel',
            ativo: true,
            cpf: '3',
            telefone: 't',
        });

        const alvos = await NotificationService.getTargetUsers(['responsaveis'], 'ESC_A');
        const nomes = alvos.map((u) => u.nome).sort();
        expect(nomes).toEqual(['Pai A', 'Pai Legado']);
        expect(nomes).not.toContain('Pai B');
    });
});
