/**
 * notificacoesPontaAPonta.test.js — Issue #447.
 *
 * O sistema de notificações quebrava em vários pontos ao mesmo tempo: só a
 * primeira notificação do serviço era gravada (índice único em `id` sem
 * valor), marcar como lida com `notif_...` virava 500, endereçamento
 * `usuario:`/`turma:`/`diretor` não aparecia para ninguém, aviso interno
 * chegava a responsável e o aviso de comentário ia para a rede inteira.
 */
jest.mock('../services/WebPushService', () => ({
    getPublicKey: () => 'chave-fake',
    sendPushNotification: jest.fn(async () => true),
}));
jest.mock('../services/EmailService', () => ({
    sendNotificationEmail: jest.fn(async () => true),
}));

const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const NotificationService = require('../services/NotificationService');
const WebPushService = require('../services/WebPushService');
const EmailService = require('../services/EmailService');
const NotificacaoController = require('../controllers/NotificacaoController');
const RealtimeNotificationController = require('../controllers/RealtimeNotificationController');
const ComentarioController = require('../controllers/ComentarioController');
const Notificacao = require('../models/Notificacao');
const Professor = require('../models/Professor');
const Aluno = require('../models/Aluno');
const Comunicado = require('../models/Comunicado');
const Usuario = require('../models/Usuario');

const ESCOLA = 'ESC_A';

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    delete global.io;
    WebPushService.sendPushNotification.mockClear();
    EmailService.sendNotificationEmail.mockClear();
});

/** res de mentira que guarda status e corpo. */
function fakeRes() {
    return {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

async function chamar(handler, req) {
    const res = fakeRes();
    await handler({ params: {}, query: {}, body: {}, escolaId: ESCOLA, ...req }, res);
    return res;
}

function sessao(user) {
    return {
        _id: user._id,
        id: String(user._id),
        perfil: user.perfil,
        email: user.email,
        nome: user.nome,
    };
}

async function titulosVistosPor(user) {
    const res = await chamar(NotificacaoController.getAll, { user: sessao(user) });
    expect(res.statusCode).toBe(200);
    return res.body.data.map((n) => n.titulo).sort();
}

function aviso(extra) {
    return NotificationService.notify({
        mensagem: 'corpo',
        criadoPor: 'Sistema',
        escolaId: ESCOLA,
        ...extra,
    });
}

/**
 * Grava sem passar pelo `notify`: nos testes de entrega a chamada é explícita,
 * e a entrega em segundo plano do `notify` consumiria os mocks no meio.
 */
function gravada(extra) {
    return Notificacao.create({
        tipo: 'informativo',
        mensagem: 'corpo',
        criadoPor: 'Sistema',
        escolaId: ESCOLA,
        ...extra,
    });
}

describe('NotificationService.notify — gravação', () => {
    it('grava N notificações seguidas sem colidir no índice único de `id`', async () => {
        for (let i = 0; i < 5; i++) {
            await aviso({ titulo: `Aviso ${i}`, destinatarios: 'todos' });
        }
        const salvas = await Notificacao.find({}).lean();
        expect(salvas).toHaveLength(5);
        const ids = salvas.map((n) => n.id);
        expect(new Set(ids).size).toBe(5);
        for (const id of ids) expect(id).toMatch(/^notif_[a-f0-9]{24}$/);
    });
});

describe('marcar como lida e apagar — ids nos dois formatos', () => {
    it('marca como lida por `notif_...` e por ObjectId', async () => {
        const diretor = await criarUsuario({ perfil: 'diretor', escolaId: ESCOLA });
        const a = await aviso({ titulo: 'A', destinatarios: 'diretor' });
        const b = await aviso({ titulo: 'B', destinatarios: 'diretor' });

        const porId = await chamar(NotificacaoController.marcarComoLida, {
            user: sessao(diretor),
            params: { id: a.id },
        });
        const porObjectId = await chamar(NotificacaoController.marcarComoLida, {
            user: sessao(diretor),
            params: { id: String(b._id) },
        });

        expect(porId.statusCode).toBe(200);
        expect(porObjectId.statusCode).toBe(200);
        const lidas = await Notificacao.find({ lido: String(diretor._id) }).lean();
        expect(lidas).toHaveLength(2);
    });

    it('id inexistente dá 404, nunca 500 — nos dois formatos', async () => {
        const diretor = await criarUsuario({ perfil: 'diretor', escolaId: ESCOLA });
        for (const id of ['notif_inexistente', '0123456789abcdef01234567']) {
            const lida = await chamar(NotificacaoController.marcarComoLida, {
                user: sessao(diretor),
                params: { id },
            });
            const apagada = await chamar(NotificacaoController.delete, {
                user: sessao(diretor),
                params: { id },
            });
            expect(lida.statusCode).toBe(404);
            expect(apagada.statusCode).toBe(404);
        }
    });

    it('apaga por `notif_...`', async () => {
        const diretor = await criarUsuario({ perfil: 'diretor', escolaId: ESCOLA });
        const n = await aviso({ titulo: 'Apagar', destinatarios: 'todos' });
        const res = await chamar(NotificacaoController.delete, {
            user: sessao(diretor),
            params: { id: n.id },
        });
        expect(res.statusCode).toBe(200);
        expect(await Notificacao.countDocuments({})).toBe(0);
    });

    it('não marca como lida o que a pessoa não enxerga', async () => {
        const professor = await criarUsuario({ perfil: 'professor', escolaId: ESCOLA });
        const soDiretor = await aviso({
            titulo: 'Interno da direção',
            destinatarios: 'diretor',
            paraResponsavel: false,
        });
        const res = await chamar(NotificacaoController.marcarComoLida, {
            user: sessao(professor),
            params: { id: soDiretor.id },
        });
        expect(res.statusCode).toBe(404);
    });
});

describe('GET /api/notificacoes — cada endereçamento para o perfil certo', () => {
    let profTurma;
    let profOutra;
    let diretor;
    let responsavel;

    beforeEach(async () => {
        profTurma = await criarUsuario({ perfil: 'professor', escolaId: ESCOLA });
        profOutra = await criarUsuario({ perfil: 'professor', escolaId: ESCOLA });
        diretor = await criarUsuario({ perfil: 'diretor', escolaId: ESCOLA });
        responsavel = await criarUsuario({ perfil: 'responsavel', escolaId: ESCOLA });

        await Professor.create({
            idUsuario: String(profTurma._id),
            nome: 'Prof 1A',
            email: profTurma.email,
            salaPrincipal: '1A',
            ativo: true,
        });
        await Professor.create({
            idUsuario: String(profOutra._id),
            nome: 'Prof 2B',
            email: profOutra.email,
            salaPrincipal: '2B',
            ativo: true,
        });
        await Aluno.create({
            nome: 'Filho',
            turma: '1A',
            responsavel: responsavel.email,
            escolaId: ESCOLA,
        });

        await aviso({ titulo: 'Resposta ao prof', destinatarios: `usuario:${profTurma._id}` });
        await aviso({ titulo: 'Resposta ao pai', destinatarios: `usuario:${responsavel._id}` });
        await aviso({
            titulo: 'Turma 1A interno',
            destinatarios: 'turma:1A',
            paraResponsavel: false,
        });
        await aviso({ titulo: 'Turma 1A familias', destinatarios: 'turma:1A' });
        await aviso({ titulo: 'Para responsaveis', destinatarios: 'responsaveis' });
        await aviso({ titulo: 'Para direcao', destinatarios: 'diretor' });
        await aviso({ titulo: 'Interno geral', destinatarios: 'todos', paraResponsavel: false });
    });

    it('professor da turma', async () => {
        expect(await titulosVistosPor(profTurma)).toEqual(
            [
                'Interno geral',
                'Para responsaveis',
                'Resposta ao prof',
                'Turma 1A familias',
                'Turma 1A interno',
            ].sort()
        );
    });

    it('professor de outra turma não vê o interno da 1A nem a resposta endereçada ao colega', async () => {
        const vistos = await titulosVistosPor(profOutra);
        expect(vistos).not.toContain('Turma 1A interno');
        expect(vistos).not.toContain('Resposta ao prof');
        expect(vistos).not.toContain('Resposta ao pai');
        expect(vistos).not.toContain('Para direcao');
    });

    it('diretor vê o que é da direção, mas não o endereçado a outra pessoa', async () => {
        const vistos = await titulosVistosPor(diretor);
        expect(vistos).toContain('Para direcao');
        expect(vistos).toContain('Interno geral');
        expect(vistos).not.toContain('Resposta ao prof');
        expect(vistos).not.toContain('Resposta ao pai');
        expect(vistos).not.toContain('Turma 1A interno');
    });

    it('responsável vê o público da família e o endereçado a ele — nunca aviso interno', async () => {
        expect(await titulosVistosPor(responsavel)).toEqual(
            ['Para responsaveis', 'Resposta ao pai', 'Turma 1A familias'].sort()
        );
    });
});

describe('aviso interno não alcança responsável', () => {
    function fakeIo(conectados) {
        const recebidos = new Map();
        const sockets = conectados.map(({ nome, rooms }) => ({
            rooms: new Set(rooms),
            emit(ev, payload) {
                if (!recebidos.has(nome)) recebidos.set(nome, []);
                recebidos.get(nome).push({ ev, payload });
            },
        }));
        return {
            recebidos,
            io: {
                to() {
                    return this;
                },
                emit() {},
                in(room) {
                    return { fetchSockets: async () => sockets.filter((s) => s.rooms.has(room)) };
                },
            },
        };
    }

    it('`todos` com paraResponsavel:false não é emitido ao socket do responsável', async () => {
        const { io, recebidos } = fakeIo([
            { nome: 'prof', rooms: [`escola:${ESCOLA}`, 'role:professor'] },
            { nome: 'pai', rooms: [`escola:${ESCOLA}`, 'role:responsavel'] },
        ]);
        global.io = io;

        await aviso({
            titulo: 'Reunião pedagógica',
            destinatarios: 'todos',
            paraResponsavel: false,
        });

        expect(recebidos.get('prof')).toHaveLength(1);
        expect(recebidos.get('prof')[0].payload.notification.titulo).toBe('Reunião pedagógica');
        expect(recebidos.has('pai')).toBe(false);
    });

    it('nem por e-mail, nem por push', async () => {
        const inscricao = { endpoint: 'https://push.exemplo/x', keys: { p256dh: 'p', auth: 'a' } };
        const prof = await criarUsuario({
            perfil: 'professor',
            escolaId: ESCOLA,
            pushSubscriptions: [inscricao],
        });
        const pai = await criarUsuario({
            perfil: 'responsavel',
            escolaId: ESCOLA,
            pushSubscriptions: [{ ...inscricao, endpoint: 'https://push.exemplo/y' }],
        });

        const n = await gravada({
            titulo: 'Interno',
            destinatarios: ['todos'],
            paraResponsavel: false,
        });
        await NotificationService.entregarForaDoPortal(n, {
            destList: ['todos'],
            escolaId: ESCOLA,
            alcancaResponsavel: false,
            titulo: 'Interno',
            mensagem: 'corpo',
            link: null,
        });

        const emails = EmailService.sendNotificationEmail.mock.calls.map((c) => c[0]);
        expect(emails).toContain(prof.email);
        expect(emails).not.toContain(pai.email);

        const endpoints = WebPushService.sendPushNotification.mock.calls.map((c) => c[0].endpoint);
        expect(endpoints).toContain('https://push.exemplo/x');
        expect(endpoints).not.toContain('https://push.exemplo/y');
    });

    it('link padrão aponta para página que existe, por perfil', async () => {
        const inscricao = { endpoint: 'https://push.exemplo/z', keys: { p256dh: 'p', auth: 'a' } };
        await criarUsuario({
            perfil: 'responsavel',
            escolaId: ESCOLA,
            pushSubscriptions: [inscricao],
        });

        const n = await gravada({
            titulo: 'Às famílias',
            destinatarios: ['responsaveis'],
            paraResponsavel: true,
        });
        await NotificationService.entregarForaDoPortal(n, {
            destList: ['responsaveis'],
            escolaId: ESCOLA,
            alcancaResponsavel: true,
            titulo: 'Às famílias',
            mensagem: 'corpo',
            link: null,
        });

        const [, payload] = WebPushService.sendPushNotification.mock.calls[0];
        expect(payload.data.url).toBe('/portal-responsavel/dist/index.html');
        expect(payload.data.id).toBe(String(n._id));
    });

    it('uma entrega que falha não derruba as outras nem vira rejeição solta', async () => {
        await criarUsuario({ perfil: 'professor', escolaId: ESCOLA });
        await criarUsuario({ perfil: 'professor', escolaId: ESCOLA });
        EmailService.sendNotificationEmail
            .mockRejectedValueOnce(new Error('SMTP fora'))
            .mockResolvedValueOnce(true);

        const n = await gravada({ titulo: 'Geral', destinatarios: ['professores'] });
        const resultado = await NotificationService.entregarForaDoPortal(n, {
            destList: ['professores'],
            escolaId: ESCOLA,
            alcancaResponsavel: false,
            titulo: 'Geral',
            mensagem: 'corpo',
            link: null,
        });

        expect(resultado).toEqual({ entregues: 1, falhas: 1 });
    });
});

describe('aviso de comentário fica na escola do comunicado', () => {
    it('grava o escolaId do comunicado', async () => {
        const autor = await criarUsuario({ perfil: 'professor', escolaId: ESCOLA });
        const comunicado = await Comunicado.create({
            escolaId: ESCOLA,
            titulo: 'Festa junina',
            conteudo: 'Sábado',
            destinatarios: ['todos'],
            ativo: true,
        });

        const res = await chamar(ComentarioController.add, {
            user: sessao(autor),
            body: { comunicadoId: String(comunicado._id), texto: 'Vou levar pipoca' },
        });
        expect(res.statusCode).toBe(201);

        const avisoDiretor = await Notificacao.findOne({
            titulo: 'Novo comentário em comunicado',
        }).lean();
        expect(avisoDiretor).toBeTruthy();
        expect(avisoDiretor.escolaId).toBe(ESCOLA);
    });
});

describe('POST /api/notifications/realtime/subscribe — inscrição de push', () => {
    const valida = {
        endpoint: 'https://push.exemplo/aparelho',
        keys: { p256dh: 'chave-publica', auth: 'segredo-auth' },
    };

    it.each([
        ['corpo vazio', {}],
        ['endpoint não é URL', { ...valida, endpoint: 'nao-e-url' }],
        ['endpoint sem https', { ...valida, endpoint: 'http://push.exemplo/a' }],
        ['sem chaves', { endpoint: valida.endpoint }],
        ['chave não é texto', { ...valida, keys: { p256dh: 1, auth: 'a' } }],
    ])('recusa com 400: %s', async (_nome, corpo) => {
        const user = await criarUsuario({ escolaId: ESCOLA });
        const res = await chamar(RealtimeNotificationController.subscribe, {
            user: sessao(user),
            body: corpo,
        });
        expect(res.statusCode).toBe(400);
        const salvo = await Usuario.findById(user._id).lean();
        expect(salvo.pushSubscriptions || []).toHaveLength(0);
    });

    it('o mesmo endpoint não duplica, mesmo com as chaves em outra ordem', async () => {
        const user = await criarUsuario({ escolaId: ESCOLA });
        await chamar(RealtimeNotificationController.subscribe, {
            user: sessao(user),
            body: valida,
        });
        const res = await chamar(RealtimeNotificationController.subscribe, {
            user: sessao(user),
            body: {
                keys: { auth: valida.keys.auth, p256dh: valida.keys.p256dh },
                expirationTime: null,
                endpoint: valida.endpoint,
            },
        });
        expect(res.statusCode).toBe(201);
        const salvo = await Usuario.findById(user._id).lean();
        expect(salvo.pushSubscriptions).toHaveLength(1);
        expect(salvo.pushSubscriptions[0].endpoint).toBe(valida.endpoint);
    });
});
