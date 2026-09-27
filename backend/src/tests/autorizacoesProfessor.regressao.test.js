/**
 * autorizacoesProfessor.regressao.test.js — Issue #496
 *
 * O professor vê a SITUAÇÃO das autorizações dos alunos das próprias turmas
 * — nunca arquivo, detalhe ou data — e só se a direção da escola liberou.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Professor = require('../models/Professor');
const AuditLog = require('../models/AuditLog');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

let escola;
let outraEscola;
let prof;
let diretor;

async function cenario() {
    escola = await Escola.create({ nome: 'EMEF A', tipo: 'EMEF', ativo: true });
    outraEscola = await Escola.create({ nome: 'EMEF B', tipo: 'EMEF', ativo: true });
    invalidarCacheEscolas();

    await Aluno.create({
        nome: 'Aluno Da Turma',
        turma: '3A',
        escolaId: String(escola._id),
        autorizacoesEscolares: {
            antitermico: true,
            medicamentoNome: 'Dipirona',
            medicamentoDose: '15 gotas',
            conducaoEscolar: true,
            motoristaNome: 'Seu João',
            motoristaTelefone: '11999990000',
        },
    });
    await Aluno.create({ nome: 'Aluno De Outra Turma', turma: '5B', escolaId: String(escola._id) });

    prof = await criarUsuario({
        email: 'prof.aut@escola.test',
        perfil: 'professor',
        escolaId: String(escola._id),
    });
    await Professor.create({
        idUsuario: String(prof._id),
        nome: 'Prof',
        email: 'prof.aut@escola.test',
        salaPrincipal: '3A',
        escolaId: String(escola._id),
    });
    diretor = await criarUsuario({
        email: 'dir.aut@escola.test',
        perfil: 'diretor',
        escolaId: String(escola._id),
    });
}

async function situacao(quem) {
    return request(app).get('/api/turmas/autorizacoes/situacao').set('Cookie', cookieDe(quem));
}

async function liberar(quem, escolaId, valor) {
    return request(app)
        .patch(`/api/escolas/${escolaId}/autorizacoes-professor`)
        .set('Cookie', cookieDe(quem))
        .send({ liberar: valor });
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
    await cenario();
});

describe('decisão da direção', () => {
    it('desligado por padrão: o professor recebe 403 com código próprio', async () => {
        const res = await situacao(prof);
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('AUTORIZACOES_PROFESSOR_DESLIGADO');
    });

    it('a direção da escola liga, e a decisão vai para o log com antes e depois', async () => {
        const res = await liberar(diretor, escola._id, true);
        expect(res.status).toBe(200);

        const log = await AuditLog.findOne({ acao: 'AUTORIZACOES_PROFESSOR_ALTERADO' }).lean();
        expect(log.detalhes.valorAnterior).toEqual({ professorVeAutorizacoes: false });
        expect(log.detalhes.valorNovo).toEqual({ professorVeAutorizacoes: true });
    });

    it('diretor não decide por outra escola; professor e secretaria não decidem', async () => {
        expect((await liberar(diretor, outraEscola._id, true)).status).toBe(403);
        expect((await liberar(prof, escola._id, true)).status).toBe(403);
        const sec = await criarUsuario({
            email: 'sec.aut@escola.test',
            perfil: 'secretaria',
            escolaId: String(escola._id),
        });
        expect((await liberar(sec, escola._id, true)).status).toBe(403);
        expect((await Escola.findById(escola._id).lean()).professorVeAutorizacoes).toBeUndefined();
    });
});

describe('o que o professor vê', () => {
    beforeEach(async () => {
        await Escola.updateOne({ _id: escola._id }, { $set: { professorVeAutorizacoes: true } });
    });

    it('só alunos das próprias turmas', async () => {
        const res = await situacao(prof);
        expect(res.status).toBe(200);
        const nomes = res.body.data.map((a) => a.nome);
        expect(nomes).toContain('Aluno Da Turma');
        expect(nomes).not.toContain('Aluno De Outra Turma');
    });

    it('só tipo, título e situação — sem remédio, motorista, data ou arquivo', async () => {
        const res = await situacao(prof);
        const aluno = res.body.data.find((a) => a.nome === 'Aluno Da Turma');
        for (const a of aluno.autorizacoes) {
            expect(Object.keys(a).sort()).toEqual(['situacao', 'tipo', 'titulo']);
        }
        const texto = JSON.stringify(res.body);
        for (const proibido of [
            'Dipirona',
            '15 gotas',
            'Seu João',
            '11999990000',
            'gridfs',
            'dataResposta',
        ]) {
            expect(texto).not.toContain(proibido);
        }
        expect(aluno.autorizacoes.find((a) => a.tipo === 'antitermico').situacao).toBe('aceita');
    });

    it('a rota é só do professor', async () => {
        const res = await situacao(diretor);
        expect(res.status).toBe(403);
    });
});
