/**
 * atribuicoesFrequenciaPorEscola.test.js — Issue #660
 *
 * `/atribuicoes` e `/frequencia-professores` eram montadas sem
 * `filtrarPorEscola`: o escopo de escola dos controllers não filtrava nada, e a
 * direção de uma escola lia, apagava e reescrevia os registros das outras.
 * Os testes passam PELA ROTA, com duas escolas ativas — chamar o controller com
 * `req.escolaId` pronto (como em syncIsolamentoEscola.test.js) não pega a falha.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const AtribuicaoProfessor = require('../models/AtribuicaoProfessor');
const FrequenciaProfessor = require('../models/FrequenciaProfessor');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const migration = require('../../migrations/1791298800000-atribuicoes-e-frequencias-na-escola-ativa');

const CARGO = { diretor: Diretor, secretaria: Secretaria };
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

async function equipe(perfil, escolaId) {
    const usuario = await criarUsuario({ perfil, escolaId });
    await CARGO[perfil].create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        vinculos: [{ escolaId, cargo: perfil }],
    });
    return [`escola_jwt=${assinarTokenSessao(usuario)}`];
}

describe('atribuições', () => {
    it('a lista traz só as da escola da sessão', async () => {
        const cookie = await equipe('secretaria', A);
        await AtribuicaoProfessor.create({ escolaId: A, nome: 'Prof da A' });
        await AtribuicaoProfessor.create({ escolaId: B, nome: 'Prof da B' });

        const res = await request(app).get('/api/atribuicoes').set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.data.map((x) => x.nome)).toEqual(['Prof da A']);
    });

    it('o sync de uma escola não apaga as atribuições da outra', async () => {
        const cookie = await equipe('secretaria', A);
        const daA = await AtribuicaoProfessor.create({ escolaId: A, nome: 'Prof da A' });
        const daB = await AtribuicaoProfessor.create({ escolaId: B, nome: 'Prof da B' });

        const res = await request(app)
            .post('/api/atribuicoes/sync')
            .set('Cookie', cookie)
            .send({ atribuicoes: [{ _id: String(daA._id), nome: 'Prof da A' }] });

        expect(res.status).toBe(200);
        expect(await AtribuicaoProfessor.findById(daB._id)).not.toBeNull();
        expect(res.body.data.map((x) => x.nome)).toEqual(['Prof da A']);
    });

    it('o sync não reescreve, por id, a atribuição de outra escola nem aceita escolaId do corpo', async () => {
        const cookie = await equipe('diretor', A);
        const daB = await AtribuicaoProfessor.create({ escolaId: B, nome: 'Prof da B' });

        await request(app)
            .post('/api/atribuicoes/sync')
            .set('Cookie', cookie)
            .send({ atribuicoes: [{ _id: String(daB._id), nome: 'Trocado pela A', escolaId: A }] });

        const depois = await AtribuicaoProfessor.findById(daB._id).lean();
        expect(depois.nome).toBe('Prof da B');
        expect(depois.escolaId).toBe(B);
    });

    it('atribuição nova fica na escola da sessão, mesmo com outra no corpo', async () => {
        const cookie = await equipe('secretaria', A);

        await request(app)
            .post('/api/atribuicoes/sync')
            .set('Cookie', cookie)
            .send({ atribuicoes: [{ nome: 'Nova', escolaId: B }] });

        const nova = await AtribuicaoProfessor.findOne({ nome: 'Nova' }).lean();
        expect(nova.escolaId).toBe(A);
    });
});

describe('frequência dos professores', () => {
    const aula = (escolaId, nomeProfessor) => ({
        escolaId,
        nomeProfessor,
        disciplina: 'Matemática',
        escola: 'EMEF',
        classe: '1A',
        quantidadeAulas: 2,
    });

    it('a lista traz só as aulas da escola da sessão', async () => {
        const cookie = await equipe('diretor', A);
        await FrequenciaProfessor.create([aula(A, 'Docente da A'), aula(B, 'Docente da B')]);

        const res = await request(app).get('/api/frequencia-professores').set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.data.map((x) => x.nomeProfessor)).toEqual(['Docente da A']);
    });

    it('a aula registrada pela direção grava a escola da sessão', async () => {
        const cookie = await equipe('diretor', A);

        const res = await request(app)
            .post('/api/frequencia-professores')
            .set('Cookie', cookie)
            .send({
                nomeProfessor: 'Docente',
                disciplina: 'História',
                escola: 'EMEF Alfa',
                classe: '1A',
                quantidadeAulas: 1,
            });

        expect(res.status).toBe(200);
        expect(res.body.data.escolaId).toBe(A);
    });
});

describe('migration: registros sem escola vão para a escola ativa única', () => {
    const semEscola = async () => {
        const db = mongoose.connection.db;
        await db.collection('atribuicoes_professores').insertOne({ nome: 'Legado' });
        await db
            .collection('frequencia_professores')
            .insertOne({ nomeProfessor: 'Legado', escolaId: '' });
    };

    it('com uma escola ativa, ganham a escola dela', async () => {
        await Escola.updateOne({ _id: B }, { $set: { ativo: false } });
        await semEscola();

        await migration.up();

        const db = mongoose.connection.db;
        expect(
            (await db.collection('atribuicoes_professores').findOne({ nome: 'Legado' })).escolaId
        ).toBe(A);
        expect(
            (await db.collection('frequencia_professores').findOne({ nomeProfessor: 'Legado' }))
                .escolaId
        ).toBe(A);
    });

    it('com duas escolas ativas, nada é alterado', async () => {
        await semEscola();

        const resultado = await migration.up();

        expect(resultado.atribuicoes_professores).toEqual({ semEscola: 1, atualizados: 0 });
        const db = mongoose.connection.db;
        expect(
            (await db.collection('atribuicoes_professores').findOne({ nome: 'Legado' })).escolaId
        ).toBeUndefined();
    });
});
