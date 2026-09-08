/**
 * turmasPublicas.test.js — a rota anônima de turmas não vaza PII (Issue #212).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O DEFEITO
 * ─────────────────────────────────────────────────────────────────────────
 * `GET /api/auth/turmas-publicas` mora em `/api/auth`, prefixo sem `authJWT` e
 * sem `filtrarPorEscola`, e apontava para `ClassController.list` — o mesmo
 * handler das telas autenticadas, que faz `.populate('professor')` sem
 * `select`. Resultado: o documento inteiro do professor (e-mail, telefone,
 * idade, biografia) saía para qualquer anônimo, e sem `req.escolaId` o recorte
 * por escola do `list` virava no-op, então vinha a rede toda.
 *
 * O consumidor — `js/register.js` — sempre precisou só de `t.nome`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUE ASSERTAR CAMPO A CAMPO, E NÃO SÓ A AUSÊNCIA DE `professor`
 * ─────────────────────────────────────────────────────────────────────────
 * `expect(turma.professor).toBeUndefined()` passaria de novo no dia em que
 * alguém trocasse o `populate` por um `$lookup` com outro nome de campo, ou
 * embutisse o professor dentro da própria turma. O que precisa ficar fora da
 * resposta é o DADO PESSOAL, não a chave que hoje o carrega — então a asserção
 * é sobre o JSON inteiro, procurando os valores que não podem estar lá.
 */
const request = require('supertest');

const app = require('../app');
const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

const EMAIL_PROFESSOR = 'maria.professora@escola.test';
const TELEFONE_PROFESSOR = '(21) 99999-1234';
const BIOGRAFIA_PROFESSOR = 'anotacao pessoal que nao pode sair da escola';

beforeAll(async () => {
    await conectarBanco();
});
afterEach(async () => {
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

async function semearTurmaComProfessor() {
    const escola = await Escola.create({
        nome: 'EMEF Fixture Turmas',
        tipo: 'EMEF',
        endereco: 'Rua de Teste, 123',
    });

    const professor = await Professor.create({
        nome: 'Maria Professora',
        email: EMAIL_PROFESSOR,
        telefone: TELEFONE_PROFESSOR,
        idade: 41,
        biografia: BIOGRAFIA_PROFESSOR,
        salaPrincipal: '1A',
        escolaId: String(escola._id),
    });

    await Turma.create({
        escolaId: String(escola._id),
        id: '1A',
        nome: '1A',
        ano: 2026,
        professor: professor._id,
    });

    return { escola, professor };
}

describe('GET /api/auth/turmas-publicas — requisição anônima', () => {
    it('responde sem exigir sessão', async () => {
        await semearTurmaComProfessor();

        const res = await request(app).get('/api/auth/turmas-publicas');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('não devolve nenhum dado pessoal do professor', async () => {
        await semearTurmaComProfessor();

        const res = await request(app).get('/api/auth/turmas-publicas');
        const corpo = JSON.stringify(res.body);

        expect(corpo).not.toContain(EMAIL_PROFESSOR);
        expect(corpo).not.toContain(TELEFONE_PROFESSOR);
        expect(corpo).not.toContain(BIOGRAFIA_PROFESSOR);
        expect(corpo).not.toContain('Maria Professora');
    });

    it('não devolve o campo professor em item nenhum', async () => {
        await semearTurmaComProfessor();

        const res = await request(app).get('/api/auth/turmas-publicas');

        for (const turma of res.body.data) {
            expect(turma.professor).toBeUndefined();
        }
    });

    it('entrega o nome da turma, que é o que o cadastro consome', async () => {
        await semearTurmaComProfessor();

        const res = await request(app).get('/api/auth/turmas-publicas');

        // `js/register.js` monta o <select> com `t.nome || t.id || t._id`.
        expect(res.body.data.map((t) => t.nome)).toContain('1A');
    });

    it('omite turma inativa, como fazia antes', async () => {
        await semearTurmaComProfessor();
        await Turma.create({ id: '9Z', nome: '9Z', ativo: false });

        const res = await request(app).get('/api/auth/turmas-publicas');

        expect(res.body.data.map((t) => t.nome)).not.toContain('9Z');
    });
});
