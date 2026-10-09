/**
 * autorizacoesProfessor.regressao.test.js — Issue #496
 *
 * O professor vê a SITUAÇÃO das autorizações dos alunos das próprias turmas
 * — nunca arquivo, detalhe ou data — e só se a direção liberou para ele.
 *
 * Desde a Issue #727 a liberação é por professor (ferramenta
 * "gestao.autorizacoes-pais"); o atalho da direção na tela de Autorizações dos
 * Pais grava a mesma decisão para todos os professores atuais da escola.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Professor = require('../models/Professor');
const AuditLog = require('../models/AuditLog');
const PermissaoFerramenta = require('../models/PermissaoFerramenta');
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
    it('sem autorização: o professor recebe 403 com o código da ferramenta', async () => {
        const res = await situacao(prof);
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('FERRAMENTA_NAO_AUTORIZADA');
        expect(res.body.ferramenta.id).toBe('gestao.autorizacoes-pais');
    });

    it('a direção libera para todos, o professor passa a ver e o log tem antes e depois', async () => {
        const res = await liberar(diretor, escola._id, true);
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ liberar: true, professores: 1, alteradas: 1 });
        expect((await situacao(prof)).status).toBe(200);

        const log = await AuditLog.findOne({ acao: 'FERRAMENTA_AUTORIZADA' }).lean();
        expect(log.escolaId).toBe(String(escola._id));
        expect(log.detalhes.valorAnterior).toMatchObject({
            professorId: String(prof._id),
            ferramentaId: 'gestao.autorizacoes-pais',
            autorizado: false,
        });
        expect(log.detalhes.valorNovo.autorizado).toBe(true);
    });

    it('a direção retira de todos, e o professor deixa de ver na hora', async () => {
        await liberar(diretor, escola._id, true);
        const res = await liberar(diretor, escola._id, false);
        expect(res.body.data).toMatchObject({ liberar: false, alteradas: 1 });
        expect((await situacao(prof)).status).toBe(403);
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
        expect(await PermissaoFerramenta.countDocuments()).toBe(0);
    });
});

describe('o que o professor vê', () => {
    beforeEach(async () => {
        await PermissaoFerramenta.create({
            escolaId: String(escola._id),
            professorId: String(prof._id),
            ferramentaId: 'gestao.autorizacoes-pais',
            autorizado: true,
        });
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
