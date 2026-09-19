/**
 * escolaResolvida.regressao.test.js — Issue #396
 *
 * Sem escola resolvida, a requisição de um perfil de equipe é recusada: seguir
 * adiante faria cada controller abandonar o recorte por escola e responder com
 * a rede inteira. Admin e responsável seguem, por motivos declarados no
 * middleware.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Diretor = require('../models/Diretor');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let escolaA;
let escolaB;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

async function duasEscolasAtivas() {
    escolaA = await Escola.create({ nome: 'EMEF A', tipo: 'EMEF', ativo: true });
    escolaB = await Escola.create({ nome: 'EMEF B', tipo: 'EMEF', ativo: true });
    await Aluno.create({ escolaId: String(escolaA._id), nome: 'Aluno da A', turma: '1A' });
    await Aluno.create({ escolaId: String(escolaB._id), nome: 'Aluno da B', turma: '1B' });
    invalidarCacheEscolas();
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
});

describe('duas escolas ativas', () => {
    it('diretor sem vínculo e sem escola na conta → 403', async () => {
        await duasEscolasAtivas();
        const dir = await criarUsuario({ email: 'dir.legado@escola.test', perfil: 'diretor' });
        const res = await request(app).get('/api/alunos').set('Cookie', cookieDe(dir));
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('ESCOLA_NAO_RESOLVIDA');
    });

    it.each(['secretaria', 'professor'])('%s sem vínculo → 403', async (perfil) => {
        await duasEscolasAtivas();
        const u = await criarUsuario({ email: `${perfil}@escola.test`, perfil });
        const res = await request(app).get('/api/alunos').set('Cookie', cookieDe(u));
        expect(res.status).toBe(403);
    });

    it('diretor com escola no próprio cadastro enxerga só a escola dele', async () => {
        await duasEscolasAtivas();
        const dir = await criarUsuario({
            email: 'dir.legado2@escola.test',
            perfil: 'diretor',
            escolaId: String(escolaA._id),
        });
        const res = await request(app).get('/api/alunos').set('Cookie', cookieDe(dir));
        expect(res.status).toBe(200);
        expect(res.body.data.map((a) => a.nome)).toEqual(['Aluno da A']);
    });

    it('diretor com vínculo continua entrando normalmente', async () => {
        await duasEscolasAtivas();
        const dir = await criarUsuario({ email: 'dir.vinculado@escola.test', perfil: 'diretor' });
        await Diretor.create({
            idUsuario: String(dir._id),
            nome: dir.nome,
            email: dir.email,
            vinculos: [{ escolaId: String(escolaA._id), cargo: 'diretor' }],
        });
        invalidarCacheEscolas();
        const res = await request(app).get('/api/alunos').set('Cookie', cookieDe(dir));
        expect(res.status).toBe(200);
        expect(res.body.data.map((a) => a.nome)).toEqual(['Aluno da A']);
    });

    it('admin segue (conta da rede) e responsável segue pelo vínculo com o filho', async () => {
        await duasEscolasAtivas();
        await Aluno.updateOne(
            { nome: 'Aluno da B' },
            { $set: { responsavel: 'mae@familia.test' } }
        );

        const admin = await criarUsuario({ email: 'admin@rede.test', perfil: 'admin' });
        const mae = await criarUsuario({ email: 'mae@familia.test', perfil: 'responsavel' });

        const resAdmin = await request(app).get('/api/alunos').set('Cookie', cookieDe(admin));
        expect(resAdmin.status).toBe(200);

        const resMae = await request(app)
            .get('/api/responsavel/alunos')
            .set('Cookie', cookieDe(mae));
        expect(resMae.status).toBe(200);
        expect(resMae.body.data.map((a) => a.nome)).toEqual(['Aluno da B']);
    });
});

describe('uma escola ativa', () => {
    it('perfil de equipe sem vínculo resolve na escola ativa', async () => {
        const unica = await Escola.create({ nome: 'EMEF Única', tipo: 'EMEF', ativo: true });
        await Aluno.create({ escolaId: String(unica._id), nome: 'Aluno Único', turma: '1A' });
        invalidarCacheEscolas();

        const sec = await criarUsuario({ email: 'sec.unica@escola.test', perfil: 'secretaria' });
        const res = await request(app).get('/api/alunos').set('Cookie', cookieDe(sec));
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
    });
});
