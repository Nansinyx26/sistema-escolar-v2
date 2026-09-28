/**
 * restricaoJudicial.regressao.test.js — Issue #491
 *
 * A escola marca o e-mail de um responsável como bloqueado por decisão
 * judicial, e o bloqueio vence o cadastro: a pessoa deixa de ver o aluno em
 * todo ponto que a reconhece pelo e-mail, mesmo com o e-mail na ficha. Os
 * demais responsáveis seguem com acesso. Só a gestão da escola do aluno marca.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Usuario = require('../models/Usuario');
const AuditLog = require('../models/AuditLog');
const { turmasDosFilhos, vinculoDoResponsavel } = require('../services/vinculoTurmas');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

let escolaA;
let escolaB;
let aluno;
let bloqueado;
let outro;
let secretariaA;

async function cenario() {
    escolaA = await Escola.create({ nome: 'EMEF A', tipo: 'EMEF', ativo: true });
    escolaB = await Escola.create({ nome: 'EMEF B', tipo: 'EMEF', ativo: true });
    invalidarCacheEscolas();

    aluno = await Aluno.create({
        nome: 'Criança Protegida',
        turma: '2A',
        escolaId: String(escolaA._id),
        responsavel: 'pai.restrito@escola.test',
        responsaveis: [
            { nome: 'Pai', email: 'Pai.Restrito@escola.test', parentesco: 'Pai' },
            { nome: 'Mãe', email: 'mae.guardia@escola.test', parentesco: 'Mãe' },
        ],
    });
    bloqueado = await criarUsuario({ email: 'pai.restrito@escola.test', perfil: 'responsavel' });
    outro = await criarUsuario({ email: 'mae.guardia@escola.test', perfil: 'responsavel' });
    secretariaA = await criarUsuario({
        email: 'sec.a@escola.test',
        perfil: 'secretaria',
        escolaId: String(escolaA._id),
    });
}

async function bloquear(quem, email, confirmacao = true) {
    return request(app)
        .post(`/api/secretaria/alunos/${aluno._id}/restricoes-acesso`)
        .set('Cookie', cookieDe(quem))
        .send({ email, confirmacao });
}

async function filhosNoPortal(responsavel) {
    const res = await request(app)
        .get('/api/responsavel/alunos')
        .set('Cookie', cookieDe(responsavel));
    expect(res.status).toBe(200);
    return res.body.data || res.body.alunos || [];
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
    global.io = undefined;
    await cenario();
});

describe('efeito do bloqueio', () => {
    it('antes do bloqueio, os dois responsáveis veem o aluno', async () => {
        expect(await filhosNoPortal(bloqueado)).toHaveLength(1);
        expect(await filhosNoPortal(outro)).toHaveLength(1);
    });

    it('depois do bloqueio, o bloqueado some do portal e o outro responsável segue', async () => {
        expect((await bloquear(secretariaA, 'PAI.RESTRITO@escola.test')).status).toBe(201);

        // A sessão antiga foi encerrada; mesmo com login novo, o aluno não aparece.
        const relogado = await Usuario.findById(bloqueado._id);
        expect(await filhosNoPortal(relogado)).toHaveLength(0);
        expect(await filhosNoPortal(outro)).toHaveLength(1);
    });

    it('a guarda por aluno recusa o bloqueado', async () => {
        await bloquear(secretariaA, 'pai.restrito@escola.test');
        const relogado = await Usuario.findById(bloqueado._id);

        const res = await request(app)
            .get(`/api/notas/boletim/${aluno._id}`)
            .set('Cookie', cookieDe(relogado));
        expect([403, 404]).toContain(res.status);

        const doOutro = await request(app)
            .get(`/api/notas/boletim/${aluno._id}`)
            .set('Cookie', cookieDe(outro));
        expect(doOutro.status).toBe(200);
    });

    it('turmas, vínculo com a rede e exportação deixam de enxergar o aluno', async () => {
        await bloquear(secretariaA, 'pai.restrito@escola.test');

        expect((await turmasDosFilhos('pai.restrito@escola.test')).size).toBe(0);
        expect((await vinculoDoResponsavel('pai.restrito@escola.test')).filhos).toBe(0);
        expect((await vinculoDoResponsavel('mae.guardia@escola.test')).filhos).toBe(1);

        const relogado = await Usuario.findById(bloqueado._id);
        const pacote = await request(app).get('/api/meus-dados').set('Cookie', cookieDe(relogado));
        expect(pacote.status).toBe(200);
        expect(pacote.body.dependentes).toBeUndefined();
    });

    it('as sessões abertas do bloqueado são encerradas na hora', async () => {
        const tokenAntigo = assinarTokenSessao(bloqueado);
        await bloquear(secretariaA, 'pai.restrito@escola.test');

        const res = await request(app)
            .get('/api/responsavel/alunos')
            .set('Cookie', [`escola_jwt=${tokenAntigo}`]);
        expect(res.status).toBe(401);
    });

    it('retirar o bloqueio devolve o acesso', async () => {
        await bloquear(secretariaA, 'pai.restrito@escola.test');
        const res = await request(app)
            .post(`/api/secretaria/alunos/${aluno._id}/restricoes-acesso/remover`)
            .set('Cookie', cookieDe(secretariaA))
            .send({ email: 'pai.restrito@escola.test' });
        expect(res.status).toBe(200);

        const relogado = await Usuario.findById(bloqueado._id);
        expect(await filhosNoPortal(relogado)).toHaveLength(1);
    });
});

describe('quem marca e como fica registrado', () => {
    it('sem a confirmação de que a decisão está arquivada, recusa', async () => {
        const res = await bloquear(secretariaA, 'pai.restrito@escola.test', false);
        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('CONFIRMACAO_OBRIGATORIA');
    });

    it('gestão de outra escola não marca', async () => {
        const secB = await criarUsuario({
            email: 'sec.b@escola.test',
            perfil: 'secretaria',
            escolaId: String(escolaB._id),
        });
        const res = await bloquear(secB, 'pai.restrito@escola.test');
        expect([403, 404]).toContain(res.status);
        expect((await Aluno.findById(aluno._id).lean()).restricoesAcesso).toBeUndefined();
    });

    it('professor e responsável não marcam', async () => {
        const prof = await criarUsuario({
            email: 'prof.r@escola.test',
            perfil: 'professor',
            escolaId: String(escolaA._id),
        });
        expect((await bloquear(prof, 'pai.restrito@escola.test')).status).toBe(403);
        expect((await bloquear(outro, 'pai.restrito@escola.test')).status).toBe(403);
    });

    it('o AuditLog registra por id, com o e-mail mascarado', async () => {
        await bloquear(secretariaA, 'pai.restrito@escola.test');
        const log = await AuditLog.findOne({ acao: 'ACESSO_RESPONSAVEL_BLOQUEADO' }).lean();
        expect(log.recursoId).toBe(String(aluno._id));
        expect(log.detalhes.valorAnterior).toEqual({ restricoes: 0 });
        expect(log.detalhes.valorNovo).toEqual({ restricoes: 1 });
        expect(log.detalhes.descricao).not.toContain('pai.restrito@escola.test');
    });

    it('o professor não recebe o marcador na ficha', async () => {
        await bloquear(secretariaA, 'pai.restrito@escola.test');
        const prof = await criarUsuario({
            email: 'prof.ficha@escola.test',
            perfil: 'professor',
            escolaId: String(escolaA._id),
        });
        const { projetarAluno } = require('../utils/projecaoAluno');
        const doc = await Aluno.findById(aluno._id).lean();
        expect(projetarAluno(doc, 'professor').restricoesAcesso).toBeUndefined();
        expect(projetarAluno(doc, 'responsavel').restricoesAcesso).toBeUndefined();
        expect(prof).toBeTruthy();
    });
});
