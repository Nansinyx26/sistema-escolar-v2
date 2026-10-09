/**
 * ferramentasSolicitacoes.regressao.test.js — Issue #733 (Etapa 3 da #720)
 *
 * Professor pede → direção da escola recebe notificação → direção autoriza ou
 * recusa → banco → professor recebe notificação → ferramenta liberada (ou não)
 * na próxima requisição. Tudo isolado por escola e auditado.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const AuditLog = require('../models/AuditLog');
const RealtimeNotification = require('../models/RealtimeNotification');
const PermissaoFerramenta = require('../models/PermissaoFerramenta');
const SolicitacaoFerramenta = require('../models/SolicitacaoFerramenta');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

let escolaA;
let escolaB;
let diretorA;
let diretorB;
let prof;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    escolaA = await Escola.create({ nome: 'EMEF Pedidos A', tipo: 'EMEF', ativo: true });
    escolaB = await Escola.create({ nome: 'EMEF Pedidos B', tipo: 'EMEF', ativo: true });
    invalidarCacheEscolas();

    diretorA = await criarUsuario({
        nome: 'Diretora A',
        email: 'dir.a.pedidos@escola.test',
        perfil: 'diretor',
        escolaId: String(escolaA._id),
    });
    diretorB = await criarUsuario({
        nome: 'Diretor B',
        email: 'dir.b.pedidos@escola.test',
        perfil: 'diretor',
        escolaId: String(escolaB._id),
    });
    prof = await criarUsuario({
        nome: 'João Silva',
        email: 'joao.pedidos@escola.test',
        perfil: 'professor',
        escolaId: String(escolaA._id),
    });
});

function pedir(quem, ferramentaId, mensagem) {
    return request(app)
        .post(`/api/ferramentas/${ferramentaId}/solicitar`)
        .set('Cookie', cookieDe(quem))
        .send(mensagem ? { mensagem } : {});
}

function decidir(quem, id, decisao, motivo) {
    return request(app)
        .post(`/api/ferramentas/solicitacoes/${id}/decidir`)
        .set('Cookie', cookieDe(quem))
        .send({ decisao, motivo });
}

function notificacoesDe(usuario) {
    return RealtimeNotification.find({ receiverId: String(usuario._id) }).lean();
}

async function statusDe(usuario, ferramentaId) {
    const res = await request(app).get('/api/ferramentas/minhas').set('Cookie', cookieDe(usuario));
    return res.body.data.find((f) => f.id === ferramentaId).status;
}

describe('o professor pede', () => {
    it('registra o pedido, audita e avisa só a direção da própria escola', async () => {
        const res = await pedir(prof, 'ia.assistente', 'Quero preparar aulas.');
        expect(res.status).toBe(201);
        expect(res.body.data.nova).toBe(true);

        const pedido = await SolicitacaoFerramenta.findById(res.body.data.id).lean();
        expect(pedido).toMatchObject({
            escolaId: String(escolaA._id),
            professorId: String(prof._id),
            ferramentaId: 'ia.assistente',
            status: 'pendente',
            mensagem: 'Quero preparar aulas.',
        });
        expect(pedido.createdAt).toBeInstanceOf(Date);

        const [aviso] = await notificacoesDe(diretorA);
        expect(aviso.message).toBe(
            'O professor João Silva solicitou autorização para utilizar a ferramenta "Assistente de IA".'
        );
        expect(aviso.linkUrl).toContain(`solicitacao=${pedido._id}`);
        expect(await notificacoesDe(diretorB)).toHaveLength(0);

        const log = await AuditLog.findOne({ acao: 'FERRAMENTA_SOLICITADA' }).lean();
        expect(log.escolaId).toBe(String(escolaA._id));
        expect(log.detalhes.valorNovo).toMatchObject({
            professorId: String(prof._id),
            ferramentaId: 'ia.assistente',
        });
        expect(log.detalhes.descricao).not.toContain('João Silva');

        expect(await statusDe(prof, 'ia.assistente')).toBe('pendente');
    });

    it('pedir de novo não duplica nem avisa outra vez', async () => {
        await pedir(prof, 'ia.assistente');
        const res = await pedir(prof, 'ia.assistente');
        expect(res.status).toBe(200);
        expect(res.body.data.nova).toBe(false);
        expect(await SolicitacaoFerramenta.countDocuments()).toBe(1);
        expect(await notificacoesDe(diretorA)).toHaveLength(1);
    });

    it('ferramenta já autorizada ou fora do catálogo não gera pedido', async () => {
        await PermissaoFerramenta.create({
            escolaId: String(escolaA._id),
            professorId: String(prof._id),
            ferramentaId: 'ia.plano-aula',
            autorizado: true,
        });
        const ja = await pedir(prof, 'ia.plano-aula');
        expect(ja.status).toBe(409);
        expect(ja.body.codigo).toBe('JA_AUTORIZADO');

        expect((await pedir(prof, 'ia.inventada')).status).toBe(404);
        expect(await SolicitacaoFerramenta.countDocuments()).toBe(0);
    });

    it('só professor pede', async () => {
        expect((await pedir(diretorA, 'ia.assistente')).status).toBe(403);
    });

    it('a barreira avisa a tela se ainda dá para pedir', async () => {
        const antes = await request(app)
            .post('/api/ia/plano-aula')
            .set('Cookie', cookieDe(prof))
            .send({ tema: 'Frações' });
        expect(antes.status).toBe(403);
        expect(antes.body.podeSolicitar).toBe(true);

        await pedir(prof, 'ia.plano-aula');
        const depois = await request(app)
            .post('/api/ia/plano-aula')
            .set('Cookie', cookieDe(prof))
            .send({ tema: 'Frações' });
        expect(depois.body.solicitacaoPendente).toBe(true);
        expect(depois.body.podeSolicitar).toBe(false);
    });
});

describe('a direção decide', () => {
    let pedidoId;
    beforeEach(async () => {
        pedidoId = (await pedir(prof, 'ia.assistente')).body.data.id;
    });

    it('lista os pedidos só da própria escola', async () => {
        const daA = await request(app)
            .get('/api/ferramentas/solicitacoes')
            .set('Cookie', cookieDe(diretorA));
        expect(daA.status).toBe(200);
        expect(daA.body.data).toHaveLength(1);
        expect(daA.body.data[0]).toMatchObject({
            id: pedidoId,
            professor: { id: String(prof._id), nome: 'João Silva' },
            ferramenta: { id: 'ia.assistente', nome: 'Assistente de IA' },
            status: 'pendente',
        });

        const daB = await request(app)
            .get('/api/ferramentas/solicitacoes')
            .set('Cookie', cookieDe(diretorB));
        expect(daB.body.data).toHaveLength(0);
    });

    it('autoriza: grava, encerra o pedido, avisa o professor e libera na hora', async () => {
        const res = await decidir(diretorA, pedidoId, 'autorizar');
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('autorizada');

        const pedido = await SolicitacaoFerramenta.findById(pedidoId).lean();
        expect(pedido.decididaPor).toBe(String(diretorA._id));

        const permissao = await PermissaoFerramenta.findOne({
            professorId: String(prof._id),
        }).lean();
        expect(permissao).toMatchObject({
            autorizado: true,
            autorizadoPor: String(diretorA._id),
        });

        const [aviso] = await notificacoesDe(prof);
        expect(aviso.message).toBe(
            'A direção autorizou você a utilizar a ferramenta "Assistente de IA".'
        );
        expect(await statusDe(prof, 'ia.assistente')).toBe('autorizado');
        expect(await AuditLog.countDocuments({ acao: 'FERRAMENTA_AUTORIZADA' })).toBe(1);
    });

    it('recusa: guarda o motivo, audita, avisa o professor e não libera', async () => {
        const res = await decidir(diretorA, pedidoId, 'recusar', 'Ainda sem formação.');
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe('recusada');

        const pedido = await SolicitacaoFerramenta.findById(pedidoId).lean();
        expect(pedido.motivoDecisao).toBe('Ainda sem formação.');

        const [aviso] = await notificacoesDe(prof);
        expect(aviso.message).toBe(
            'A direção não autorizou o uso da ferramenta "Assistente de IA".'
        );
        expect(await PermissaoFerramenta.countDocuments()).toBe(0);
        expect(await statusDe(prof, 'ia.assistente')).toBe('bloqueado');
        expect(await AuditLog.countDocuments({ acao: 'FERRAMENTA_SOLICITACAO_RECUSADA' })).toBe(1);

        // Recusado, o professor pode pedir de novo.
        expect((await pedir(prof, 'ia.assistente')).status).toBe(201);
    });

    it('pedido decidido não se decide de novo', async () => {
        await decidir(diretorA, pedidoId, 'recusar');
        const res = await decidir(diretorA, pedidoId, 'autorizar');
        expect(res.status).toBe(409);
        expect(await PermissaoFerramenta.countDocuments()).toBe(0);
    });

    it('direção de outra escola não decide; professor não decide', async () => {
        expect((await decidir(diretorB, pedidoId, 'autorizar')).status).toBe(404);
        expect((await decidir(prof, pedidoId, 'autorizar')).status).toBe(403);
        expect((await SolicitacaoFerramenta.findById(pedidoId).lean()).status).toBe('pendente');
        expect(await PermissaoFerramenta.countDocuments()).toBe(0);
    });

    it('decisão inválida e id inexistente são recusados', async () => {
        expect((await decidir(diretorA, pedidoId, 'talvez')).status).toBe(400);
        expect((await decidir(diretorA, 'nao-e-id', 'autorizar')).status).toBe(404);
    });
});

describe('aviso no "Salvar autorizações"', () => {
    it('revogar sem pedido avisa que a autorização foi retirada', async () => {
        const par = { professorId: String(prof._id), ferramentaId: 'ia.assistente' };
        const salvar = (autorizado) =>
            request(app)
                .put('/api/ferramentas/autorizacoes')
                .set('Cookie', cookieDe(diretorA))
                .send({ alteracoes: [{ ...par, autorizado }] });

        await salvar(true);
        await salvar(false);
        const mensagens = (await notificacoesDe(prof)).map((n) => n.message);
        expect(mensagens).toEqual(
            expect.arrayContaining([
                'A direção autorizou você a utilizar a ferramenta "Assistente de IA".',
                'A direção retirou a sua autorização para a ferramenta "Assistente de IA".',
            ])
        );
    });
});
