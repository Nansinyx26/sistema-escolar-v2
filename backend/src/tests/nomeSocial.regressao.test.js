/**
 * nomeSocial.regressao.test.js — Issue #510
 *
 * Nome social do aluno nos registros escolares internos (Resolução CNE/CP
 * nº 1/2018; em SP, Decreto 55.588/2010):
 *   1. só a gestão da escola registra, pela rota própria, com requerimento;
 *   2. menor de 18 anos (ou sem data de nascimento) exige os responsáveis;
 *   3. o professor recebe o nome social no lugar do civil, sem o sobrenome;
 *   4. a ficha (secretaria, responsável) recebe os dois;
 *   5. anonimização apaga, IA trata como nome, AuditLog não guarda o nome.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Professor = require('../models/Professor');
const Secretaria = require('../models/Secretaria');
const AuditLog = require('../models/AuditLog');
const { planoDeAnonimizacao } = require('../services/conformidade/anonimizacaoAluno');
const { criarMapa } = require('../services/ia/pseudonimizar');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const SOCIAL = 'Ana Fixture';

let escola;
let outraEscola;
let menor;
let maior;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

function anosAtras(anos, dias = 0) {
    const d = new Date();
    d.setUTCFullYear(d.getUTCFullYear() - anos);
    d.setUTCDate(d.getUTCDate() + dias);
    return d;
}

async function professor() {
    const u = await criarUsuario({
        email: `prof${Math.random()}@escola.test`,
        perfil: 'professor',
        escolaId: String(escola._id),
    });
    await Professor.create({
        idUsuario: String(u._id),
        nome: u.nome,
        email: u.email,
        salaPrincipal: '1A',
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ativo: true,
    });
    return u;
}

async function secretaria(daEscola = escola) {
    const u = await criarUsuario({
        email: `sec${Math.random()}@escola.test`,
        perfil: 'secretaria',
        escolaId: String(daEscola._id),
    });
    await Secretaria.create({
        idUsuario: String(u._id),
        nome: u.nome,
        email: u.email,
        vinculos: [{ escolaId: String(daEscola._id), cargo: 'secretaria' }],
    });
    return u;
}

function definir(quem, aluno, corpo) {
    return request(app)
        .put(`/api/secretaria/alunos/${aluno._id}/nome-social`)
        .set('Cookie', cookieDe(quem))
        .send({ requerimentoArquivado: true, ...corpo });
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({ nome: 'EMEF Nome Social', tipo: 'EMEF', ativo: true });
    outraEscola = await Escola.create({ nome: 'EMEF Vizinha', tipo: 'EMEF', ativo: true });
    menor = await Aluno.create({
        escolaId: String(escola._id),
        nome: 'Civil',
        sobrenome: 'Fixture Menor',
        turma: '1A',
        nascimento: anosAtras(12),
        responsavel: 'mae@familia.test',
        responsaveis: [{ nome: 'Mãe', email: 'mae@familia.test' }],
        ativo: true,
    });
    maior = await Aluno.create({
        escolaId: String(escola._id),
        nome: 'Civil',
        sobrenome: 'Fixture Maior',
        turma: '1A',
        nascimento: anosAtras(19),
        ativo: true,
    });
    invalidarCacheEscolas();
});

describe('registro pela gestão da escola', () => {
    it('secretaria registra com requerimento dos responsáveis e o AuditLog não guarda o nome', async () => {
        const sec = await secretaria();
        const res = await definir(sec, menor, {
            nomeSocial: `  ${SOCIAL} `,
            requerente: 'responsaveis',
        });

        expect(res.status).toBe(200);
        const salvo = await Aluno.findById(menor._id).lean();
        expect(salvo.nomeSocial).toBe(SOCIAL);
        expect(salvo.nome).toBe('Civil');
        expect(salvo.nomeSocialRequerimento).toMatchObject({
            requerente: 'responsaveis',
            registradoPor: String(sec._id),
        });

        const logs = await AuditLog.find({ acao: 'ALUNO_NOME_SOCIAL_DEFINIDO' }).lean();
        expect(logs).toHaveLength(1);
        expect(logs[0].recursoId).toBe(String(menor._id));
        expect(JSON.stringify(logs[0])).not.toContain('Ana');
    });

    it('menor de 18 anos com requerimento do próprio aluno recebe 400', async () => {
        const sec = await secretaria();
        const res = await definir(sec, menor, { nomeSocial: SOCIAL, requerente: 'aluno' });
        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('REQUERIMENTO_DOS_RESPONSAVEIS');
        expect((await Aluno.findById(menor._id).lean()).nomeSocial).toBeUndefined();
    });

    it('véspera dos 18 anos ainda é menor; maior de 18 requer por si', async () => {
        const sec = await secretaria();
        const vespera = await Aluno.create({
            escolaId: String(escola._id),
            nome: 'Civil',
            turma: '1A',
            nascimento: anosAtras(18, 1),
        });
        expect(
            (await definir(sec, vespera, { nomeSocial: SOCIAL, requerente: 'aluno' })).status
        ).toBe(400);
        expect(
            (await definir(sec, maior, { nomeSocial: SOCIAL, requerente: 'aluno' })).status
        ).toBe(200);
    });

    it('sem data de nascimento, só o requerimento dos responsáveis é aceito', async () => {
        const sec = await secretaria();
        const semData = await Aluno.create({
            escolaId: String(escola._id),
            nome: 'Civil',
            turma: '1A',
        });
        expect(
            (await definir(sec, semData, { nomeSocial: SOCIAL, requerente: 'aluno' })).status
        ).toBe(400);
        expect(
            (await definir(sec, semData, { nomeSocial: SOCIAL, requerente: 'responsaveis' })).status
        ).toBe(200);
    });

    it('recusa sem confirmar o requerimento arquivado e com nome vazio', async () => {
        const sec = await secretaria();
        const semPapel = await definir(sec, menor, {
            nomeSocial: SOCIAL,
            requerente: 'responsaveis',
            requerimentoArquivado: false,
        });
        expect(semPapel.status).toBe(400);
        expect(semPapel.body.codigo).toBe('REQUERIMENTO_NAO_CONFIRMADO');
        expect(
            (await definir(sec, menor, { nomeSocial: '   ', requerente: 'responsaveis' })).status
        ).toBe(400);
    });

    it('professor, responsável e secretaria de outra escola não registram', async () => {
        const prof = await professor();
        const mae = await criarUsuario({ email: 'mae@familia.test', perfil: 'responsavel' });
        const secDeFora = await secretaria(outraEscola);
        const corpo = { nomeSocial: SOCIAL, requerente: 'responsaveis' };

        expect((await definir(prof, menor, corpo)).status).toBe(403);
        expect((await definir(mae, menor, corpo)).status).toBe(403);
        expect((await definir(secDeFora, menor, corpo)).status).toBe(403);
        expect((await Aluno.findById(menor._id).lean()).nomeSocial).toBeUndefined();
    });

    it('a edição genérica do aluno não grava nome social (sem requerimento)', async () => {
        const sec = await secretaria();
        const prof = await professor();
        await request(app)
            .put(`/api/secretaria/alunos/${menor._id}`)
            .set('Cookie', cookieDe(sec))
            .send({ nomeSocial: SOCIAL });
        await request(app)
            .put(`/api/alunos/${menor._id}`)
            .set('Cookie', cookieDe(prof))
            .send({ nomeSocial: SOCIAL });
        expect((await Aluno.findById(menor._id).lean()).nomeSocial).toBeUndefined();
    });

    it('remove o nome social e registra no AuditLog', async () => {
        const sec = await secretaria();
        await definir(sec, menor, { nomeSocial: SOCIAL, requerente: 'responsaveis' });
        const res = await request(app)
            .delete(`/api/secretaria/alunos/${menor._id}/nome-social`)
            .set('Cookie', cookieDe(sec));
        expect(res.status).toBe(200);
        const salvo = await Aluno.findById(menor._id).lean();
        expect(salvo.nomeSocial).toBeUndefined();
        expect(salvo.nomeSocialRequerimento).toBeUndefined();
        expect(await AuditLog.countDocuments({ acao: 'ALUNO_NOME_SOCIAL_REMOVIDO' })).toBe(1);
    });
});

describe('exibição', () => {
    beforeEach(async () => {
        await Aluno.updateOne(
            { _id: menor._id },
            { nomeSocial: SOCIAL, nomeSocialRequerimento: { requerente: 'responsaveis' } }
        );
    });

    it('professor recebe o nome social no lugar do civil, sem sobrenome, na lista e na leitura', async () => {
        const c = cookieDe(await professor());
        const lista = await request(app).get('/api/alunos?turma=1A').set('Cookie', c);
        const leitura = await request(app).get(`/api/alunos/${menor._id}`).set('Cookie', c);

        expect(leitura.status).toBe(200);
        expect(leitura.body.data.nome).toBe(SOCIAL);
        expect(leitura.body.data.sobrenome).toBeUndefined();
        expect(leitura.body.data.nomeSocial).toBeUndefined();

        const noLista = lista.body.data.find((a) => String(a._id) === String(menor._id));
        expect(noLista.nome).toBe(SOCIAL);
        expect(JSON.stringify(lista.body)).not.toContain('Fixture Menor');
        // Quem não tem nome social segue com o civil.
        const outro = lista.body.data.find((a) => String(a._id) === String(maior._id));
        expect(outro.nome).toBe('Civil');
    });

    it('secretaria recebe o nome civil e o social', async () => {
        const res = await request(app)
            .get(`/api/alunos/${menor._id}`)
            .set('Cookie', cookieDe(await secretaria()));
        expect(res.body.data.nome).toBe('Civil');
        expect(res.body.data.sobrenome).toBe('Fixture Menor');
        expect(res.body.data.nomeSocial).toBe(SOCIAL);
    });
});

describe('outras camadas', () => {
    it('anonimização apaga o nome social e o requerimento', () => {
        const plano = planoDeAnonimizacao({
            _id: 'x',
            nome: 'Civil',
            nomeSocial: SOCIAL,
            nomeSocialRequerimento: { requerente: 'aluno' },
        });
        expect(plano.camposRemovidos).toEqual(
            expect.arrayContaining(['nomeSocial', 'nomeSocialRequerimento'])
        );
    });

    it('pseudonimização da IA troca o nome social pelo rótulo do aluno', () => {
        const mapa = criarMapa();
        const saida = mapa.mascarar({ _id: 'a1', nome: 'Civil', nomeSocial: SOCIAL });
        expect(JSON.stringify(saida)).not.toContain('Ana');
        expect(saida.nomeSocial).toBe(saida.nome);
    });
});
