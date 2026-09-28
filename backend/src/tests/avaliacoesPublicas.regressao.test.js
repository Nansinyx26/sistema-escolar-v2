/**
 * avaliacoesPublicas.regressao.test.js — Issue #489
 *
 * As avaliações do sistema chegavam à página inicial (rota pública) com nome
 * completo, foto, perfil e id da conta, sem escolha da pessoa e sem revisão.
 * O mesmo conjunto saía na listagem do painel e no evento em tempo real
 * enviado à rede inteira. Agora: iniciais, adesão opcional e moderação prévia.
 */
const request = require('supertest');
const app = require('../app');
const AvaliacaoSistema = require('../models/AvaliacaoSistema');
const SiteReview = require('../models/SiteReview');
const AuditLog = require('../models/AuditLog');
const { iniciaisDe, aderiu } = require('../utils/avaliacaoPublica');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

const CHAVES_PUBLICAS = ['_id', 'dataCriacao', 'estrelas', 'nome', 'perfil', 'texto'];

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

async function avaliar(usuario, corpo) {
    return request(app).post('/api/avaliacoes').set('Cookie', cookieDe(usuario)).send(corpo);
}

async function publicas() {
    const res = await request(app).get('/api/avaliacoes/public');
    expect(res.status).toBe(200);
    return res.body.data;
}

async function moderar(admin, colecao, id, decisao) {
    return request(app)
        .patch(`/api/avaliacoes/moderacao/${colecao}/${id}`)
        .set('Cookie', cookieDe(admin))
        .send({ decisao });
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    global.io = undefined;
});

describe('iniciais e adesão', () => {
    it('iniciaisDe usa a primeira e a última palavra', () => {
        expect(iniciaisDe('Maria da Silva Souza')).toBe('M. S.');
        expect(iniciaisDe('Ana')).toBe('A.');
        expect(iniciaisDe('')).toBe('Usuário');
    });

    it('só true literal conta como adesão', () => {
        expect(aderiu(true)).toBe(true);
        expect(aderiu('true')).toBe(false);
        expect(aderiu(1)).toBe(false);
        expect(aderiu(undefined)).toBe(false);
    });
});

describe('página inicial (rota pública)', () => {
    it('avaliação aderida e aprovada sai só com iniciais, papel, nota e texto', async () => {
        const mae = await criarUsuario({
            nome: 'Maria da Silva Souza',
            email: 'mae.aval@escola.test',
            perfil: 'responsavel',
        });
        const admin = await criarUsuario({ email: 'admin.aval@escola.test', perfil: 'admin' });

        await avaliar(mae, { estrelas: 5, texto: 'Muito bom', exibirPublicamente: true });
        const doc = await AvaliacaoSistema.findOne({ usuarioId: String(mae._id) });
        expect((await moderar(admin, 'sistema', doc._id, 'aprovada')).status).toBe(200);

        const data = await publicas();
        expect(data).toHaveLength(1);
        expect(Object.keys(data[0]).sort()).toEqual(CHAVES_PUBLICAS);
        expect(data[0].nome).toBe('M. S.');
        expect(data[0].perfil).toBe('Responsável');
        expect(JSON.stringify(data)).not.toContain('Maria');
        expect(JSON.stringify(data)).not.toContain(String(mae._id));
    });

    it('sem adesão, não aparece mesmo aprovada', async () => {
        const prof = await criarUsuario({ email: 'prof.aval@escola.test', perfil: 'professor' });
        const admin = await criarUsuario({ email: 'admin.aval2@escola.test', perfil: 'admin' });

        await avaliar(prof, { estrelas: 4, texto: 'Bom' });
        const doc = await AvaliacaoSistema.findOne({ usuarioId: String(prof._id) });
        expect(doc.exibirPublicamente).toBe(false);
        await moderar(admin, 'sistema', doc._id, 'aprovada');

        expect(await publicas()).toHaveLength(0);
    });

    it('com adesão, não aparece antes da moderação', async () => {
        const prof = await criarUsuario({ email: 'prof.aval2@escola.test', perfil: 'professor' });
        await avaliar(prof, { estrelas: 4, texto: 'Bom', exibirPublicamente: true });
        expect(await publicas()).toHaveLength(0);
    });

    it('editar o texto devolve a avaliação para revisão', async () => {
        const prof = await criarUsuario({ email: 'prof.aval3@escola.test', perfil: 'professor' });
        const admin = await criarUsuario({ email: 'admin.aval3@escola.test', perfil: 'admin' });

        await avaliar(prof, { estrelas: 4, texto: 'Bom', exibirPublicamente: true });
        const doc = await AvaliacaoSistema.findOne({ usuarioId: String(prof._id) });
        await moderar(admin, 'sistema', doc._id, 'aprovada');
        expect(await publicas()).toHaveLength(1);

        await avaliar(prof, {
            estrelas: 4,
            texto: 'Texto trocado depois da aprovação',
            exibirPublicamente: true,
        });
        expect((await AvaliacaoSistema.findById(doc._id)).moderacao).toBe('pendente');
        expect(await publicas()).toHaveLength(0);
    });

    it('avaliação antiga, sem adesão nem moderação registradas, fica fora', async () => {
        await AvaliacaoSistema.collection.insertOne({
            usuarioId: 'legado',
            nome: 'Pessoa Antiga',
            perfil: 'professor',
            estrelas: 5,
            texto: 'antiga',
            ativo: true,
            foto: 'https://exemplo.test/foto.png',
            dataCriacao: new Date(),
        });
        expect(await publicas()).toHaveLength(0);
    });

    it('nova avaliação não guarda foto', async () => {
        const prof = await criarUsuario({
            email: 'prof.foto@escola.test',
            perfil: 'professor',
            foto: 'https://exemplo.test/eu.png',
        });
        await avaliar(prof, { estrelas: 3, texto: 'ok' });
        const doc = await AvaliacaoSistema.findOne({ usuarioId: String(prof._id) }).lean();
        expect(doc.foto || '').toBe('');
    });
});

describe('moderação', () => {
    it('só o admin modera', async () => {
        const dir = await criarUsuario({ email: 'dir.aval@escola.test', perfil: 'diretor' });
        const prof = await criarUsuario({ email: 'prof.aval4@escola.test', perfil: 'professor' });
        await avaliar(prof, { estrelas: 4, texto: 'Bom', exibirPublicamente: true });
        const doc = await AvaliacaoSistema.findOne({ usuarioId: String(prof._id) });

        expect((await moderar(dir, 'sistema', doc._id, 'aprovada')).status).toBe(403);
        const fila = await request(app)
            .get('/api/avaliacoes/moderacao')
            .set('Cookie', cookieDe(dir));
        expect(fila.status).toBe(403);
    });

    it('a decisão vai para o AuditLog com antes e depois', async () => {
        const admin = await criarUsuario({ email: 'admin.aval5@escola.test', perfil: 'admin' });
        const prof = await criarUsuario({ email: 'prof.aval5@escola.test', perfil: 'professor' });
        await avaliar(prof, { estrelas: 4, texto: 'Bom', exibirPublicamente: true });
        const doc = await AvaliacaoSistema.findOne({ usuarioId: String(prof._id) });

        await moderar(admin, 'sistema', doc._id, 'recusada');

        const log = await AuditLog.findOne({ acao: 'AVALIACAO_MODERADA' }).lean();
        expect(log.detalhes.valorAnterior).toEqual({ moderacao: 'pendente' });
        expect(log.detalhes.valorNovo).toEqual({ moderacao: 'recusada' });
    });

    it('a fila da administração também sai só com iniciais', async () => {
        const admin = await criarUsuario({ email: 'admin.aval6@escola.test', perfil: 'admin' });
        const prof = await criarUsuario({
            nome: 'Carlos Pereira',
            email: 'prof.aval6@escola.test',
            perfil: 'professor',
        });
        await avaliar(prof, { estrelas: 4, texto: 'Bom', exibirPublicamente: true });

        const fila = await request(app)
            .get('/api/avaliacoes/moderacao')
            .set('Cookie', cookieDe(admin));
        expect(fila.status).toBe(200);
        expect(fila.body.data).toHaveLength(1);
        expect(fila.body.data[0].nome).toBe('C. P.');
        expect(JSON.stringify(fila.body.data)).not.toContain('Carlos');
    });
});

describe('painel (avaliações do dashboard)', () => {
    it('a listagem sai sem id da conta e sem avatar, com iniciais', async () => {
        const prof = await criarUsuario({
            nome: 'Beatriz Lima',
            email: 'prof.painel@escola.test',
            perfil: 'professor',
        });
        await request(app)
            .post('/api/reviews')
            .set('Cookie', cookieDe(prof))
            .send({ rating: 5, comment: 'Ótimo' });

        const res = await request(app).get('/api/reviews').set('Cookie', cookieDe(prof));
        expect(res.status).toBe(200);
        const item = res.body.data[0];
        expect(item.userName).toBe('B. L.');
        expect(item.userId).toBeUndefined();
        expect(item.userAvatar).toBeUndefined();
    });

    it('o evento em tempo real enviado à rede não leva id nem nome completo', async () => {
        const emitidos = [];
        global.io = { emit: (evento, dados) => emitidos.push({ evento, dados }) };
        const prof = await criarUsuario({
            nome: 'Beatriz Lima',
            email: 'prof.painel2@escola.test',
            perfil: 'professor',
        });

        await request(app)
            .post('/api/reviews')
            .set('Cookie', cookieDe(prof))
            .send({ rating: 5, comment: 'Ótimo' });

        expect(emitidos).toHaveLength(1);
        const texto = JSON.stringify(emitidos[0].dados);
        expect(texto).not.toContain(String(prof._id));
        expect(texto).not.toContain('Beatriz');
        expect(emitidos[0].dados.review).toBeUndefined();
    });

    it('avaliação do painel aparece na página inicial só com adesão e aprovação', async () => {
        const admin = await criarUsuario({ email: 'admin.painel@escola.test', perfil: 'admin' });
        const prof = await criarUsuario({ email: 'prof.painel3@escola.test', perfil: 'professor' });
        await request(app)
            .post('/api/reviews')
            .set('Cookie', cookieDe(prof))
            .send({ rating: 5, comment: 'Ótimo', exibirPublicamente: true });
        const doc = await SiteReview.findOne({ userId: String(prof._id) });

        expect(await publicas()).toHaveLength(0);
        await moderar(admin, 'painel', doc._id, 'aprovada');
        const data = await publicas();
        expect(data).toHaveLength(1);
        expect(Object.keys(data[0]).sort()).toEqual(CHAVES_PUBLICAS);
    });
});
