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

beforeAll(async () => { await conectarBanco(); });
afterAll(async () => { await desconectarBanco(); });
beforeEach(async () => {
    await limparBanco();
    delete global.io;
});

function fakeIo() {
    const emitted = [];
    const io = {
        _rooms: [],
        to(room) { this._rooms.push(room); return this; },
        emit(ev, payload) { emitted.push({ ev, rooms: [...this._rooms], payload }); this._rooms = []; }
    };
    return { io, emitted };
}

describe('NotificationService.notify — realtime direcionado + multi-tenant', () => {
    it('persiste a notificação com escolaId e paraResponsavel', async () => {
        const { io } = fakeIo();
        global.io = io;
        await NotificationService.notify({
            titulo: 'Reunião', mensagem: 'Amanhã',
            destinatarios: ['responsaveis'], criadoPor: null, escolaId: 'ESC_A'
        });
        const notif = await Notificacao.findOne({ titulo: 'Reunião' }).lean();
        expect(notif.escolaId).toBe('ESC_A');
        expect(notif.paraResponsavel).toBe(true);
    });

    it('emite para a sala do perfil destinatário (não broadcast global)', async () => {
        const { io, emitted } = fakeIo();
        global.io = io;
        await NotificationService.notify({
            titulo: 'Só profs', mensagem: 'x',
            destinatarios: ['professores'], criadoPor: null, escolaId: 'ESC_A'
        });
        const ev = emitted.find(e => e.ev === 'notification:new');
        expect(ev).toBeTruthy();
        expect(ev.rooms).toContain('role:professor');
        expect(ev.rooms).not.toContain('role:responsavel');
        expect(ev.payload.escolaId).toBe('ESC_A');
    });

    it('"todos" atinge todas as salas de perfil', async () => {
        const { io, emitted } = fakeIo();
        global.io = io;
        await NotificationService.notify({
            titulo: 'Geral', mensagem: 'x', destinatarios: ['todos'], criadoPor: null
        });
        const ev = emitted.find(e => e.ev === 'notification:new');
        expect(ev.rooms).toEqual(expect.arrayContaining(['role:professor', 'role:responsavel', 'role:diretor']));
    });

    it('getTargetUsers escopa por escola e inclui legados sem escolaId', async () => {
        await Usuario.create({ nome: 'Pai A', email: 'a@t.com', senha: 'x', perfil: 'responsavel', ativo: true, escolaId: 'ESC_A', cpf: '1', telefone: 't' });
        await Usuario.create({ nome: 'Pai B', email: 'b@t.com', senha: 'x', perfil: 'responsavel', ativo: true, escolaId: 'ESC_B', cpf: '2', telefone: 't' });
        await Usuario.create({ nome: 'Pai Legado', email: 'c@t.com', senha: 'x', perfil: 'responsavel', ativo: true, cpf: '3', telefone: 't' });

        const alvos = await NotificationService.getTargetUsers(['responsaveis'], 'ESC_A');
        const nomes = alvos.map(u => u.nome).sort();
        expect(nomes).toEqual(['Pai A', 'Pai Legado']);
        expect(nomes).not.toContain('Pai B');
    });
});
