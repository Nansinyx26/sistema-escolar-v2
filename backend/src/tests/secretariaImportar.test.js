/**
 * secretariaImportar.test.js
 * Importação em massa de alunos pela secretaria.
 *
 * Cobre:
 *   - Exige autenticação (401 sem cookie JWT)
 *   - Cria vários alunos, gera código secreto e retorna o resumo
 *   - Linha sem nome entra em "erros" (não é criada)
 *   - Matrícula (RA) duplicada é ignorada, não duplica no banco
 *   - Validação de payload vazio
 *   - estruturar: rejeita texto vazio
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const Aluno = require('../models/Aluno');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

async function cookieSecretaria() {
    const sec = await criarUsuario({ perfil: 'secretaria', email: `sec_${Date.now()}@escola.test` });
    const token = jwt.sign(
        { id: sec._id, perfil: sec.perfil, email: sec.email, nome: sec.nome },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
    );
    return `escola_jwt=${token}`;
}

describe('POST /api/secretaria/alunos/importar', () => {

    it('deve retornar 401 sem cookie JWT', async () => {
        const res = await request(app)
            .post('/api/secretaria/alunos/importar')
            .set('X-CSRF-Token', 'test')
            .send({ alunos: [{ nome: 'Teste' }] });
        expect(res.status).toBe(401);
    });

    it('deve rejeitar payload sem lista de alunos', async () => {
        const cookie = await cookieSecretaria();
        const res = await request(app)
            .post('/api/secretaria/alunos/importar')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({ alunos: [] });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });

    it('deve criar vários alunos e gerar código secreto', async () => {
        const cookie = await cookieSecretaria();
        const res = await request(app)
            .post('/api/secretaria/alunos/importar')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({
                alunos: [
                    { nome: 'Ana', sobrenome: 'Souza', matricula: 'RA001', turma: '5A', nascimento: '10/03/2015' },
                    { nome: 'Bruno', sobrenome: 'Lima', matricula: 'RA002', turma: '5A' },
                ]
            });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.totalCriados).toBe(2);
        expect(res.body.data.criados[0].codigoSecreto).toBeTruthy();

        const total = await Aluno.countDocuments({});
        expect(total).toBe(2);

        const ana = await Aluno.findOne({ nome: 'Ana' });
        expect(ana.ativo).toBe(true);
        expect(ana.matricula).toBe('RA001');
        expect(ana.nascimento).toBeInstanceOf(Date);
        expect(ana.codigoSecreto).toBeTruthy();
    });

    it('deve mandar linha sem nome para "erros" sem criar', async () => {
        const cookie = await cookieSecretaria();
        const res = await request(app)
            .post('/api/secretaria/alunos/importar')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({
                alunos: [
                    { nome: '', turma: '5A' },
                    { nome: 'Carla', turma: '5B' },
                ]
            });

        expect(res.status).toBe(201);
        expect(res.body.data.totalCriados).toBe(1);
        expect(res.body.data.totalErros).toBe(1);
        expect(await Aluno.countDocuments({})).toBe(1);
    });

    it('deve ignorar matrícula (RA) já existente', async () => {
        const cookie = await cookieSecretaria();
        await Aluno.create({ nome: 'Já Existe', matricula: 'RA999', ativo: true });

        const res = await request(app)
            .post('/api/secretaria/alunos/importar')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({ alunos: [{ nome: 'Duplicado', matricula: 'RA999' }] });

        expect(res.status).toBe(200);
        expect(res.body.data.totalCriados).toBe(0);
        expect(res.body.data.totalIgnorados).toBe(1);
        expect(await Aluno.countDocuments({ matricula: 'RA999' })).toBe(1);
    });
});

describe('POST /api/secretaria/alunos/importar/estruturar', () => {
    it('deve rejeitar texto vazio', async () => {
        const cookie = await cookieSecretaria();
        const res = await request(app)
            .post('/api/secretaria/alunos/importar/estruturar')
            .set('Cookie', cookie)
            .set('X-CSRF-Token', 'test')
            .send({ texto: '' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
    });
});
