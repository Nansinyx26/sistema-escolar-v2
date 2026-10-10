/**
 * pushEThreadSoDoPublico.test.js — Issue #745
 *
 * 1. Push: os públicos amplos incluíam toda conta sem `escolaId` como
 *    "legado". A do login Google (qualquer e-mail) e a do primeiro acesso
 *    nascem assim, e recebiam os avisos de todas as escolas. Agora a família
 *    é da escola por filho matriculado nela, e a equipe pelo vínculo.
 * 2. Thread de notificação: só a escola era conferida, e nem isso sem escola
 *    na sessão. Agora vale a regra do sino, e o corpo com comunicado e
 *    notificação juntos é recusado.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Usuario = require('../models/Usuario');
const Professor = require('../models/Professor');
const Notificacao = require('../models/Notificacao');
const WebPushService = require('../services/WebPushService');
const NotificationService = require('../services/NotificationService');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

const cookieDe = (conta) => [`escola_jwt=${assinarTokenSessao(conta)}`];
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

let A;
let B;
let pushes;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    A = String((await Escola.create({ nome: 'EMEF A 745', tipo: 'EMEF', ativo: true }))._id);
    B = String((await Escola.create({ nome: 'EMEF B 745', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();
    pushes = [];
    jest.spyOn(WebPushService, 'sendPushNotification').mockImplementation(async (sub) => {
        pushes.push(sub.endpoint);
        return true;
    });
});
afterEach(() => jest.restoreAllMocks());

async function comPush(conta, endpoint) {
    await Usuario.updateOne(
        { _id: conta._id },
        { $push: { pushSubscriptions: { endpoint, keys: { p256dh: 'p', auth: 'a' } } } }
    );
}

async function publicarEmA(destinatarios) {
    const diretorA = await criarUsuario({ perfil: 'diretor', escolaId: A });
    await request(app)
        .post('/api/comunicados')
        .set('Cookie', cookieDe(diretorA))
        .send({ titulo: 'Aviso da A', conteudo: 'Só para a escola A.', destinatarios })
        .expect(201);
    await esperar(300); // a entrega roda depois da resposta
}

describe('push dos públicos amplos', () => {
    it('conta sem escola e sem filho (login Google) não recebe; a família da escola recebe', async () => {
        const curioso = await criarUsuario({
            perfil: 'responsavel',
            email: 'curioso.745@gmail.test',
        });
        await comPush(curioso, 'https://push.test/curioso');

        // Família de A com a conta sem escolaId (também criada pelo Google).
        const mae = await criarUsuario({ perfil: 'responsavel', email: 'mae.745@escola.test' });
        await Aluno.create({ nome: 'Filho A', turma: '1A', escolaId: A, responsavel: mae.email });
        await comPush(mae, 'https://push.test/mae');

        await publicarEmA(['responsaveis']);

        expect(pushes).toContain('https://push.test/mae');
        expect(pushes).not.toContain('https://push.test/curioso');
    });

    it('responsável com filho só na escola B não recebe o aviso da A', async () => {
        const paiB = await criarUsuario({ perfil: 'responsavel', email: 'pai.b.745@escola.test' });
        await Aluno.create({ nome: 'Filho B', turma: '2B', escolaId: B, responsavel: paiB.email });
        await comPush(paiB, 'https://push.test/paiB');

        await publicarEmA(['todos']);

        expect(pushes).not.toContain('https://push.test/paiB');
    });

    it('professor sem escolaId na conta recebe só os avisos da escola do vínculo', async () => {
        const profA = await criarUsuario({ perfil: 'professor', email: 'prof.a.745@escola.test' });
        await Professor.create({
            idUsuario: String(profA._id),
            nome: profA.nome,
            email: profA.email,
            vinculos: [{ escolaId: A, cargo: 'professor' }],
        });
        await comPush(profA, 'https://push.test/profA');

        const profB = await criarUsuario({ perfil: 'professor', email: 'prof.b.745@escola.test' });
        await Professor.create({
            idUsuario: String(profB._id),
            nome: profB.nome,
            email: profB.email,
            vinculos: [{ escolaId: B, cargo: 'professor' }],
        });
        await comPush(profB, 'https://push.test/profB');

        await publicarEmA(['professores']);

        expect(pushes).toContain('https://push.test/profA');
        expect(pushes).not.toContain('https://push.test/profB');
    });

    it('getTargetUsers: conta da escola e legado com vínculo entram; legado sem vínculo não', async () => {
        const daEscola = await criarUsuario({
            perfil: 'responsavel',
            email: 'a.745@t.test',
            escolaId: A,
        });
        await Aluno.create({ nome: 'X', turma: '1A', escolaId: A, responsavel: daEscola.email });
        const legado = await criarUsuario({ perfil: 'responsavel', email: 'c.745@t.test' });
        await Aluno.create({ nome: 'Y', turma: '1B', escolaId: A, responsavel: legado.email });
        await criarUsuario({ perfil: 'responsavel', email: 'sem.filho.745@t.test' });
        await criarUsuario({ perfil: 'responsavel', email: 'b.745@t.test', escolaId: B });

        const alvos = await NotificationService.getTargetUsers(['responsaveis'], A);

        expect(alvos.map((u) => u.email).sort()).toEqual(['a.745@t.test', 'c.745@t.test']);
    });
});

describe('thread de notificação', () => {
    it('conta sem escola não lê nem escreve na thread das famílias de uma escola', async () => {
        const curioso = await criarUsuario({
            perfil: 'responsavel',
            email: 'curioso2.745@gmail.test',
        });
        const notif = await Notificacao.create({
            tipo: 'informativo',
            titulo: 'Reunião',
            mensagem: 'Famílias da A',
            destinatarios: ['responsaveis'],
            paraResponsavel: true,
            escolaId: A,
        });

        const leitura = await request(app)
            .get(`/api/comentarios/notificacao/${notif._id}`)
            .set('Cookie', cookieDe(curioso));
        const escrita = await request(app)
            .post('/api/comentarios')
            .set('Cookie', cookieDe(curioso))
            .send({ notificacaoId: String(notif._id), texto: 'oi' });

        expect(leitura.status).toBe(404);
        expect(escrita.status).toBe(404);
    });

    it('o responsável da escola não lê a thread de aviso interno da equipe', async () => {
        const mae = await criarUsuario({
            perfil: 'responsavel',
            email: 'ana.745@escola.test',
            escolaId: A,
        });
        await Aluno.create({ nome: 'Lia', turma: '1A', escolaId: A, responsavel: mae.email });
        const interna = await Notificacao.create({
            tipo: 'informativo',
            titulo: 'Conselho de classe',
            mensagem: 'Interno',
            destinatarios: ['professores'],
            paraResponsavel: false,
            escolaId: A,
        });

        const thread = await request(app)
            .get(`/api/comentarios/notificacao/${interna._id}`)
            .set('Cookie', cookieDe(mae));

        expect(thread.status).toBe(404);
    });

    it('a família vê a thread do aviso dela (controle)', async () => {
        const mae = await criarUsuario({
            perfil: 'responsavel',
            email: 'bia.745@escola.test',
            escolaId: A,
        });
        await Aluno.create({ nome: 'Rui', turma: '2A', escolaId: A, responsavel: mae.email });
        const aviso = await Notificacao.create({
            tipo: 'informativo',
            titulo: 'Festa',
            mensagem: 'Para as famílias',
            destinatarios: ['responsaveis'],
            paraResponsavel: true,
            escolaId: A,
        });

        const thread = await request(app)
            .get(`/api/comentarios/notificacao/${aviso._id}`)
            .set('Cookie', cookieDe(mae));

        expect(thread.status).toBe(200);
    });

    it('comunicado e notificação no mesmo corpo: 400', async () => {
        const mae = await criarUsuario({
            perfil: 'responsavel',
            email: 'cid.745@escola.test',
            escolaId: A,
        });
        await Aluno.create({ nome: 'Cid', turma: '3A', escolaId: A, responsavel: mae.email });
        const notifB = await Notificacao.create({
            tipo: 'informativo',
            titulo: 'Interno B',
            mensagem: 'x',
            destinatarios: ['diretores'],
            escolaId: B,
        });

        const res = await request(app).post('/api/comentarios').set('Cookie', cookieDe(mae)).send({
            comunicadoId: '507f1f77bcf86cd799439011',
            notificacaoId: notifB.id,
            texto: 'x',
        });

        expect(res.status).toBe(400);
    });
});
