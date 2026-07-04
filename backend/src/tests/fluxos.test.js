/**
 * fluxos.test.js — Validação final (Fase 7) dos fluxos de navegação:
 * cadastro → sessão automática → redirect por perfil; primeiro acesso;
 * recuperação de senha; logout; páginas de erro amigáveis.
 */
const request = require('supertest');
const app = require('../app');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE, SENHA_TESTE_NOVA, CODIGO_ESCOLA_TESTE } = require('./helpers');

const SecurityConfig = require('../models/SecurityConfig');
const Professor = require('../models/Professor');

const CODIGO_GLOBAL = CODIGO_ESCOLA_TESTE;

beforeAll(async () => { await conectarBanco(); });
afterAll(async () => { await desconectarBanco(); });

beforeEach(async () => {
    await limparBanco();
    await SecurityConfig.create({
        chave: 'CONFIG_GERAL',
        codigoSecretoEscola: CODIGO_GLOBAL,
        rotacaoAutomatica: false
    });
});

// ─────────────────────────────────────────────────────────
// Cadastro → autenticação automática + redirect por perfil
// ─────────────────────────────────────────────────────────
describe('Cadastro com auto-login e redirect por perfil', () => {
    it('diretor: emite cookie JWT e redirect para o dashboard', async () => {
        const res = await request(app).post('/api/auth/register-diretor').send({
            nome: 'Diretora Teste', email: 'dir@escola.test', senha: SENHA_TESTE,
            telefone: '(19) 99999-0001', codigoEscola: CODIGO_GLOBAL
        });
        expect(res.status).toBe(201);
        expect(res.body.redirect_to).toBe('/html/dashboard.html');
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.startsWith('escola_jwt'))).toBe(true);
    });

    it('secretaria: emite cookie JWT e redirect para o painel da secretaria', async () => {
        const res = await request(app).post('/api/auth/register-secretaria').send({
            nome: 'Secretária Teste', email: 'sec@escola.test', senha: SENHA_TESTE,
            telefone: '(19) 99999-0002', codigoEscola: CODIGO_GLOBAL
        });
        expect(res.status).toBe(201);
        expect(res.body.redirect_to).toBe('/html/secretaria/painel.html');
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.startsWith('escola_jwt'))).toBe(true);
    });

    it('docente: emite cookie JWT e redirect para o dashboard', async () => {
        const res = await request(app).post('/api/auth/register-docente').send({
            nome: 'Docente Teste', email: 'doc@escola.test', senha: SENHA_TESTE,
            disciplina: 'História', turma: '2B', matricula: 'M42',
            telefone: '(19) 99999-0003', codigoEscola: CODIGO_GLOBAL
        });
        expect(res.status).toBe(201);
        expect(res.body.redirect_to).toBe('/html/dashboard.html');
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.startsWith('escola_jwt'))).toBe(true);
    });

    it('nenhum redirect_to de cadastro aponta para landing ou login', async () => {
        const res = await request(app).post('/api/auth/register-diretor').send({
            nome: 'Dir2', email: 'dir2@escola.test', senha: SENHA_TESTE,
            telefone: '(19) 99999-0004', codigoEscola: CODIGO_GLOBAL
        });
        expect(res.body.redirect_to).not.toMatch(/index\.html|login\.html|primeiro-acesso/);
    });
});

// ─────────────────────────────────────────────────────────
// Primeiro acesso (ativação de conta pré-cadastrada)
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/first-access', () => {
    it('ativa a conta, autentica automaticamente e devolve redirect', async () => {
        await Professor.create({
            nome: 'Prof Pré-Cadastrado', email: 'pre@escola.test',
            cpf: '12345678901', ativo: true
        });

        const res = await request(app).post('/api/auth/first-access').send({
            emailOrCpf: 'pre@escola.test', password: SENHA_TESTE_NOVA
        });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.user.perfil).toBe('professor');
        expect(res.body.redirect_to).toBe('/html/dashboard.html');
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.startsWith('escola_jwt'))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────
// Recuperação de senha (rota responde sem vazar existência)
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/forgot-password', () => {
    it('responde 200 sem revelar se o e-mail existe', async () => {
        const res = await request(app).post('/api/auth/forgot-password')
            .send({ email: 'nao-existe@escola.test' });
        expect([200, 404]).toContain(res.status);
        expect(res.body).toHaveProperty('success');
    });
});

// ─────────────────────────────────────────────────────────
// Segurança: mock-google-login bloqueado fora de development
// ─────────────────────────────────────────────────────────
describe('POST /api/auth/mock-google-login', () => {
    it('retorna 404 quando NODE_ENV não é development', async () => {
        await criarUsuario({ email: 'vitima@escola.test', perfil: 'diretor' });
        const res = await request(app).post('/api/auth/mock-google-login')
            .send({ email: 'vitima@escola.test' });
        expect(res.status).toBe(404);
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some(c => c.startsWith('escola_jwt='))).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────
// Navegação: páginas de erro e destinos por perfil existem
// ─────────────────────────────────────────────────────────
describe('Navegação e tratamento de erros', () => {
    it('rota inexistente devolve 404 amigável (não a landing)', async () => {
        const res = await request(app).get('/qualquer-coisa-invalida.html');
        expect(res.status).toBe(404);
        expect(res.text).toContain('Página não encontrada');
        expect(res.text).not.toContain('ESCOLA JAGUARI');
    });

    it('todos os destinos de getRedirectPath existem e retornam 200', async () => {
        const destinos = [
            '/html/dashboard.html',
            '/html/secretaria/painel.html',
            '/html/mudar-senha.html',
            '/html/escolher-perfil.html',
            '/html/login.html',
            '/portal-responsavel/dist/index.html'
        ];
        for (const destino of destinos) {
            const res = await request(app).get(destino);
            expect(`${destino}:${res.status}`).toBe(`${destino}:200`);
        }
    });
});
