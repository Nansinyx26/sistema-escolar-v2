/**
 * relatorioTurmaAlunoSemNota.test.js — Issue #676
 *
 * O relatório da turma na IA respondia 400 ("Cannot convert undefined or null
 * to object") quando qualquer aluno da turma ainda não tinha nota: a análise
 * desse aluno volta sem `disciplinas`. Agora ele conta à parte.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Diretor = require('../models/Diretor');
const Nota = require('../models/Nota');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let escolaId;
let cookie;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    escolaId = String((await Escola.create({ nome: 'EMEF Alfa', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();
    const usuario = await criarUsuario({ perfil: 'diretor', escolaId });
    await Diretor.create({
        idUsuario: String(usuario._id),
        nome: usuario.nome,
        email: usuario.email,
        vinculos: [{ escolaId, cargo: 'diretor' }],
    });
    cookie = [`escola_jwt=${assinarTokenSessao(usuario)}`];
});

async function aluno(turma, nome, nota) {
    const doc = await Aluno.create({ nome, turma, ativo: true, escolaId });
    if (nota !== undefined) {
        await Nota.create({
            alunoId: String(doc._id),
            materiaId: 'Matemática',
            nota,
            bimestre: 1,
            escolaId,
        });
    }
    return doc;
}

it('turma com aluno sem nota responde 200 e conta esse aluno à parte', async () => {
    await aluno('8Y', 'Com nota', 8);
    await aluno('8Y', 'Sem nota');

    const res = await request(app).get('/api/ia/turma/8Y').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.totalAlunos).toBe(2);
    expect(res.body.alunosSemNotas).toBe(1);
    const distribuidos = Object.values(res.body.desempenhos).reduce((a, b) => a + b, 0);
    expect(distribuidos).toBe(1);
    expect(res.body.disciplinas['Matemática'].media).toBe(8);
});

it('turma em que ninguém tem nota responde 200 com média zero', async () => {
    await aluno('8X', 'Primeiro');
    await aluno('8X', 'Segundo');

    const res = await request(app).get('/api/ia/turma/8X').set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body.alunosSemNotas).toBe(2);
    expect(res.body.mediaGeral).toBe(0);
});
