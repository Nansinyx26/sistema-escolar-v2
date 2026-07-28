/**
 * presence.test.js — presença em memória do chat interno.
 *
 * Cobre o que o card de usuários online e o cabeçalho da conversa dependem:
 * refCount de múltiplas abas, status agregado online/ausente/offline e
 * isolamento entre escolas (um usuário online na escola A não vaza para a B).
 *
 * Sem banco e sem socket — é lógica pura de `realtime/presence.js`.
 */
const presence = require('../realtime/presence');

const ESCOLA_A = 'escola-a';
const ESCOLA_B = 'escola-b';

// O módulo guarda estado em memória: cada teste usa ids próprios para não
// depender da ordem de execução.
let seq = 0;
const novoUser = () => `user-${++seq}`;

describe('presence — conexões e refCount', () => {
    test('primeira conexão marca online; a segunda aba não repete o evento', () => {
        const u = novoUser();
        expect(presence.addUser(ESCOLA_A, u, 'sock1')).toBe(true);
        expect(presence.addUser(ESCOLA_A, u, 'sock2')).toBe(false);
        expect(presence.isOnline(ESCOLA_A, u)).toBe(true);
    });

    test('só fica offline quando a última aba cai', () => {
        const u = novoUser();
        presence.addUser(ESCOLA_A, u, 'sock1');
        presence.addUser(ESCOLA_A, u, 'sock2');

        expect(presence.removeUser(ESCOLA_A, u, 'sock1')).toBe(false);
        expect(presence.isOnline(ESCOLA_A, u)).toBe(true);

        expect(presence.removeUser(ESCOLA_A, u, 'sock2')).toBe(true);
        expect(presence.isOnline(ESCOLA_A, u)).toBe(false);
    });

    test('remover usuário que nunca conectou não quebra nem inventa evento', () => {
        expect(presence.removeUser(ESCOLA_A, novoUser(), 'sock')).toBe(false);
    });

    test('escolaId ou userId ausente é ignorado', () => {
        expect(presence.addUser(null, 'x', 's')).toBe(false);
        expect(presence.addUser(ESCOLA_A, null, 's')).toBe(false);
    });
});

describe('presence — status ausente', () => {
    test('aba ociosa deixa o usuário ausente e a volta restaura online', () => {
        const u = novoUser();
        presence.addUser(ESCOLA_A, u, 'sock1');

        expect(presence.statusDe(ESCOLA_A, u)).toBe('online');

        expect(presence.setAusente(ESCOLA_A, u, 'sock1', true)).toBe(true);
        expect(presence.statusDe(ESCOLA_A, u)).toBe('ausente');

        expect(presence.setAusente(ESCOLA_A, u, 'sock1', false)).toBe(true);
        expect(presence.statusDe(ESCOLA_A, u)).toBe('online');
    });

    test('com duas abas, uma ociosa não basta para marcar ausente', () => {
        const u = novoUser();
        presence.addUser(ESCOLA_A, u, 'sock1');
        presence.addUser(ESCOLA_A, u, 'sock2');

        // A aba ativa no outro monitor mantém a pessoa como online.
        expect(presence.setAusente(ESCOLA_A, u, 'sock1', true)).toBe(false);
        expect(presence.statusDe(ESCOLA_A, u)).toBe('online');

        expect(presence.setAusente(ESCOLA_A, u, 'sock2', true)).toBe(true);
        expect(presence.statusDe(ESCOLA_A, u)).toBe('ausente');
    });

    test('aba nova nasce ativa e tira o usuário de ausente', () => {
        const u = novoUser();
        presence.addUser(ESCOLA_A, u, 'sock1');
        presence.setAusente(ESCOLA_A, u, 'sock1', true);
        expect(presence.statusDe(ESCOLA_A, u)).toBe('ausente');

        presence.addUser(ESCOLA_A, u, 'sock2');
        expect(presence.statusDe(ESCOLA_A, u)).toBe('online');
    });

    test('usuário offline reporta status offline', () => {
        expect(presence.statusDe(ESCOLA_A, novoUser())).toBe('offline');
    });
});

describe('presence — isolamento multi-escola', () => {
    test('online na escola A não aparece online na escola B', () => {
        const u = novoUser();
        presence.addUser(ESCOLA_A, u, 'sock1');

        expect(presence.isOnline(ESCOLA_A, u)).toBe(true);
        expect(presence.isOnline(ESCOLA_B, u)).toBe(false);
        expect(presence.onlineUserIds(ESCOLA_B)).not.toContain(u);
    });

    test('onlineUserIds lista apenas os conectados da própria escola', () => {
        const a = novoUser();
        const b = novoUser();
        presence.addUser(ESCOLA_A, a, 'sockA');
        presence.addUser(ESCOLA_B, b, 'sockB');

        expect(presence.onlineUserIds(ESCOLA_A)).toContain(a);
        expect(presence.onlineUserIds(ESCOLA_A)).not.toContain(b);
    });
});

describe('presence — tempo online e último acesso', () => {
    test('onlineDesde é preenchido ao conectar e some ao desconectar', () => {
        const u = novoUser();
        presence.addUser(ESCOLA_A, u, 'sock1');

        const desde = presence.onlineDesde(ESCOLA_A, u);
        expect(desde).toBeInstanceOf(Date);
        expect(Date.now() - desde.getTime()).toBeLessThan(5000);

        presence.removeUser(ESCOLA_A, u, 'sock1');
        expect(presence.onlineDesde(ESCOLA_A, u)).toBeNull();
    });

    test('ultimoAcesso sobrevive ao disconnect (alimenta o "visto por último")', () => {
        const u = novoUser();
        presence.addUser(ESCOLA_A, u, 'sock1');
        presence.removeUser(ESCOLA_A, u, 'sock1');

        const visto = presence.ultimoAcesso(u);
        expect(visto).toBeInstanceOf(Date);
        expect(Date.now() - visto.getTime()).toBeLessThan(5000);
    });

    test('infoDe devolve o resumo usado pelo card e pelo cabeçalho', () => {
        const u = novoUser();
        presence.addUser(ESCOLA_A, u, 'sock1');

        const info = presence.infoDe(ESCOLA_A, u);
        expect(info.status).toBe('online');
        expect(info.online).toBe(true);
        expect(info.onlineDesde).toBeInstanceOf(Date);

        presence.removeUser(ESCOLA_A, u, 'sock1');
        const depois = presence.infoDe(ESCOLA_A, u);
        expect(depois.status).toBe('offline');
        expect(depois.online).toBe(false);
        expect(depois.onlineDesde).toBeNull();
        expect(depois.ultimoAcesso).toBeInstanceOf(Date);
    });
});
