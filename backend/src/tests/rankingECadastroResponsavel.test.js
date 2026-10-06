/**
 * rankingECadastroResponsavel.test.js — Issue #665
 *
 * 1. `GET /api/dashboard/ranking` entregava nome, turma e média das crianças a
 *    qualquer conta logada, responsável inclusive.
 * 2. `POST /api/secretaria/responsaveis` buscava o e-mail na rede inteira e
 *    respondia o cadastro completo da conta encontrada.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Usuario = require('../models/Usuario');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const Professor = require('../models/Professor');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const CARGO = { diretor: Diretor, secretaria: Secretaria, professor: Professor };
let A;
let B;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    A = String((await Escola.create({ nome: 'EMEF Alfa', tipo: 'EMEF', ativo: true }))._id);
    B = String((await Escola.create({ nome: 'EMEF Beta', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();
});

const cookieDe = (usuario) => [`escola_jwt=${assinarTokenSessao(usuario)}`];

async function equipe(perfil, escolaId) {
    const usuario = await criarUsuario({ perfil, escolaId });
    await CARGO[perfil].create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        vinculos: [{ escolaId, cargo: perfil }],
        ...(perfil === 'professor' ? { salaPrincipal: '1A', ativo: true } : {}),
    });
    return cookieDe(usuario);
}

describe('GET /api/dashboard/ranking', () => {
    beforeEach(async () => {
        const aluno = await Aluno.create({ nome: 'Filho', turma: '1B', ativo: true, escolaId: A });
        await Nota.create({ escolaId: A, alunoId: String(aluno._id), nota: 9, bimestre: 1 });
    });

    it('responsável recebe 403', async () => {
        const email = 'fam.665@escola.test';
        const resp = await criarUsuario({ perfil: 'responsavel', email, escolaId: A });
        await Aluno.create({
            nome: 'Meu',
            turma: '1A',
            ativo: true,
            escolaId: A,
            responsavel: email,
        });

        const res = await request(app).get('/api/dashboard/ranking').set('Cookie', cookieDe(resp));

        expect(res.status).toBe(403);
        expect(res.body.data).toBeUndefined();
    });

    it('professor recebe 403', async () => {
        const res = await request(app)
            .get('/api/dashboard/ranking')
            .set('Cookie', await equipe('professor', A));

        expect(res.status).toBe(403);
    });

    it('a direção continua recebendo o ranking', async () => {
        const res = await request(app)
            .get('/api/dashboard/ranking')
            .set('Cookie', await equipe('diretor', A));

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([expect.objectContaining({ nome: 'Filho', media: 9 })]);
    });
});

describe('POST /api/secretaria/responsaveis', () => {
    const corpo = (email, extra = {}) => ({
        nome: 'Responsável Novo',
        email,
        telefone: '(11) 90000-0000',
        ...extra,
    });

    it('e-mail de professor de outra escola: 409, sem dados e sem alterar a conta', async () => {
        const cookie = await equipe('secretaria', A);
        const profB = await criarUsuario({
            perfil: 'professor',
            email: 'prof.b.665@escola.test',
            escolaId: B,
            cpf: '12345678909',
        });
        const aluno = await Aluno.create({ nome: 'Da A', turma: '1A', ativo: true, escolaId: A });

        const res = await request(app)
            .post('/api/secretaria/responsaveis')
            .set('Cookie', cookie)
            .send(corpo('prof.b.665@escola.test', { alunoId: String(aluno._id) }));

        expect(res.status).toBe(409);
        expect(res.body.data).toBeUndefined();
        expect(JSON.stringify(res.body)).not.toContain('12345678909');
        const depois = await Usuario.findById(profB._id).lean();
        expect(depois.nomeAluno || '').toBe('');
    });

    it('responsável que já existe: vincula ao aluno da escola sem devolver o cadastro', async () => {
        const cookie = await equipe('secretaria', A);
        const existente = await criarUsuario({
            perfil: 'responsavel',
            email: 'mae.665@escola.test',
            escolaId: B,
            cpf: '98765432100',
        });
        const aluno = await Aluno.create({ nome: 'Da A', turma: '1A', ativo: true, escolaId: A });

        const res = await request(app)
            .post('/api/secretaria/responsaveis')
            .set('Cookie', cookie)
            .send(corpo('mae.665@escola.test', { alunoId: String(aluno._id) }));

        expect(res.status).toBe(201);
        expect(res.body.data).toEqual({ _id: String(existente._id), existente: true });
        const vinculado = await Aluno.findById(aluno._id).lean();
        expect(vinculado.responsaveis.map((r) => r.email)).toContain('mae.665@escola.test');
    });

    it('conta nova: a resposta não traz CPF, telefone nem histórico', async () => {
        const cookie = await equipe('secretaria', A);

        const res = await request(app)
            .post('/api/secretaria/responsaveis')
            .set('Cookie', cookie)
            .send(corpo('novo.665@escola.test', { cpf: '11122233344' }));

        expect(res.status).toBe(201);
        expect(Object.keys(res.body.data).sort()).toEqual(['_id', 'email', 'nome', 'perfil']);
        expect(res.body.data.perfil).toBe('responsavel');
    });
});
