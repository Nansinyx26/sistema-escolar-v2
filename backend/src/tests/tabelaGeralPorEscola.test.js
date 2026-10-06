/**
 * tabelaGeralPorEscola.test.js — Issue #679
 *
 * A tabela geral do horário era uma só para a rede: o índice único não tinha
 * escola, as escritas não filtravam por escola, e o reset apagava tudo. Os
 * testes passam pela rota, com duas escolas ativas, e cobrem a migração que
 * troca o índice.
 */
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Diretor = require('../models/Diretor');
const TabelaGeral = require('../models/TabelaGeral');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const migration = require('../../migrations/1791385200000-tabela-geral-unica-por-escola');

let A;
let B;

beforeAll(async () => {
    await conectarBanco();
    await TabelaGeral.init();
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

const cookieDe = (u) => [`escola_jwt=${assinarTokenSessao(u)}`];

async function diretorDa(escolaId) {
    const usuario = await criarUsuario({ perfil: 'diretor', escolaId });
    await Diretor.create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        vinculos: [{ escolaId, cargo: 'diretor' }],
    });
    return cookieDe(usuario);
}

function celula(escolaId, extra = {}) {
    return TabelaGeral.create({
        escolaId,
        turmaId: '2A',
        turmaNome: '2ºA',
        dia: 'SEGUNDA',
        aulaIdx: 0,
        horarioLabel: '7h30–8h20',
        abrev: 'EF',
        professorKey: 'PROF_X',
        ...extra,
    });
}

const editar = (cookie, corpo) =>
    request(app).put('/api/tabela-geral/celula').set('Cookie', cookie).send(corpo);

it('a lista traz só a tabela da escola da sessão', async () => {
    const cookie = await diretorDa(A);
    await celula(A, { abrev: 'DA_A' });
    await celula(B, { abrev: 'DA_B' });

    const res = await request(app).get('/api/tabela-geral').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.cells.map((c) => c.abrev)).toEqual(['DA_A']);
});

it('editar a célula grava na escola da sessão e não toca a de outra escola', async () => {
    const cookie = await diretorDa(A);
    const daB = await celula(B, { abrev: 'DA_B' });

    const res = await editar(cookie, {
        turmaId: '2A',
        dia: 'SEGUNDA',
        aulaIdx: 0,
        abrev: 'MAT',
        professorKey: '',
        escolaId: B,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.escolaId).toBe(A);
    expect((await TabelaGeral.findById(daB._id).lean()).abrev).toBe('DA_B');
    expect(await TabelaGeral.countDocuments({ turmaId: '2A', dia: 'SEGUNDA', aulaIdx: 0 })).toBe(2);
});

it('o professor em aula na outra escola não gera conflito', async () => {
    const cookie = await diretorDa(A);
    await celula(B, { turmaId: '3A', turmaNome: '3ºA', professorKey: 'PROF_X' });

    const res = await editar(cookie, {
        turmaId: '2A',
        dia: 'SEGUNDA',
        aulaIdx: 0,
        abrev: 'EF',
        professorKey: 'PROF_X',
    });

    expect(res.status).toBe(200);
});

it('o conflito na mesma escola continua barrado', async () => {
    const cookie = await diretorDa(A);
    await celula(A, { turmaId: '3A', turmaNome: '3ºA', professorKey: 'PROF_X' });

    const res = await editar(cookie, {
        turmaId: '2A',
        dia: 'SEGUNDA',
        aulaIdx: 0,
        abrev: 'EF',
        professorKey: 'PROF_X',
    });

    expect(res.status).toBe(409);
    expect(res.body.conflict).toBe(true);
});

it('o reset apaga só a tabela da escola da sessão', async () => {
    const admin = await criarUsuario({ perfil: 'admin', escolaId: A });
    await celula(A);
    await celula(B);

    const res = await request(app).delete('/api/tabela-geral/reset').set('Cookie', cookieDe(admin));

    expect(res.status).toBe(200);
    expect(await TabelaGeral.countDocuments({ escolaId: A })).toBe(0);
    expect(await TabelaGeral.countDocuments({ escolaId: B })).toBe(1);
});

describe('migração', () => {
    const colecao = () => mongoose.connection.db.collection('tabela_geral');
    const nomesDosIndices = async () => (await colecao().indexes()).map((i) => i.name);

    beforeEach(async () => {
        // Estado de produção antes da migração: índice antigo, sem o novo.
        await colecao()
            .dropIndex('escola_turma_dia_aula_unico')
            .catch(() => {});
        await colecao().createIndex(
            { turmaId: 1, dia: 1, aulaIdx: 1 },
            { name: 'turmaId_1_dia_1_aulaIdx_1', unique: true }
        );
    });
    afterAll(async () => {
        await colecao()
            .dropIndex('turmaId_1_dia_1_aulaIdx_1')
            .catch(() => {});
        await TabelaGeral.syncIndexes();
    });

    it('troca o índice e põe na escola ativa a célula sem escola, quando ela é única', async () => {
        await Escola.updateOne({ _id: B }, { ativo: false });
        await colecao().insertOne({ turmaId: '2A', dia: 'SEGUNDA', aulaIdx: 0, abrev: 'EF' });

        const resultado = await migration.up();
        await migration.up(); // idempotente

        expect(resultado.preenchidas).toBe(1);
        expect((await colecao().findOne({ turmaId: '2A' })).escolaId).toBe(A);
        const nomes = await nomesDosIndices();
        expect(nomes).toContain('escola_turma_dia_aula_unico');
        expect(nomes).not.toContain('turmaId_1_dia_1_aulaIdx_1');
    });

    it('com duas escolas ativas não adivinha a escola, mas troca o índice', async () => {
        await colecao().insertOne({ turmaId: '2A', dia: 'SEGUNDA', aulaIdx: 0, abrev: 'EF' });

        const resultado = await migration.up();

        expect(resultado).toMatchObject({ preenchidas: 0, semEscola: 1 });
        expect(await nomesDosIndices()).toContain('escola_turma_dia_aula_unico');
    });

    it('depois da migração, duas escolas têm a mesma célula', async () => {
        await migration.up();

        await celula(A);
        await celula(B);

        expect(await TabelaGeral.countDocuments({ turmaId: '2A' })).toBe(2);
    });
});
