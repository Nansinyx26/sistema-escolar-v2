/**
 * Integration Tests — P3 Implementation
 * 
 * Testes E2E para fluxos críticos de aplicação
 * Usa Jest + Supertest para testar API
 * 
 * @module IntegrationTests
 * @version 1.0
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const Usuario = require('../models/Usuario');
const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');

describe('Integration Tests — Sistema Escolar v2', () => {
  let token;
  let usuarioId;
  let alunoId;

  /**
   * Setup: Conectar ao banco de testes
   */
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/test');
    }
  });

  /**
   * Cleanup: Limpar dados de teste
   */
  beforeEach(async () => {
    // Limpar apenas as coleções de teste
    if (mongoose.connection.collection('usuarios')) {
      await Usuario.deleteMany({});
    }
    if (mongoose.connection.collection('alunos')) {
      await Aluno.deleteMany({});
    }
    if (mongoose.connection.collection('notas')) {
      await Nota.deleteMany({});
    }
  });

  /**
   * Teardown: Desconectar do banco
   */
  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }
  });

  // ========================
  // AUTH TESTS
  // ========================
  describe('Authentication', () => {
    it('Deve fazer login com credenciais válidas', async () => {
      // Create test user
      const usuario = await Usuario.create({
        email: 'teste@teste.com',
        nome: 'Teste User',
        senha: '$2b$12$test', // bcrypted
        perfil: 'docente',
        ativo: true,
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'teste@teste.com',
          senha: 'Senha123!',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.token).toBeDefined();
      expect(response.body.user.email).toBe('teste@teste.com');

      token = response.body.token;
      usuarioId = usuario._id;
    });

    it('Deve rejeitar login com senha incorreta', async () => {
      await Usuario.create({
        email: 'teste@teste.com',
        nome: 'Teste User',
        senha: '$2b$12$test',
        perfil: 'docente',
        ativo: true,
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'teste@teste.com',
          senha: 'SenhaErrada123',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('Deve rejeitar login com email não registrado', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'naoexiste@teste.com',
          senha: 'Senha123!',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    it('Deve validar formato de email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'email-invalido',
          senha: 'Senha123!',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // ========================
  // ALUNO TESTS
  // ========================
  describe('Alunos', () => {
    beforeEach(async () => {
      // Create test user with token
      const usuario = await Usuario.create({
        email: 'professor@teste.com',
        nome: 'Professor Teste',
        senha: '$2b$12$test',
        perfil: 'professor',
        ativo: true,
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'professor@teste.com',
          senha: 'Senha123!',
        });

      token = loginResponse.body.token;
    });

    it('Deve listar alunos com paginação', async () => {
      // Create test alunos
      for (let i = 0; i < 25; i++) {
        await Aluno.create({
          nome: `Aluno ${i}`,
          matricula: `MAT00${i}`,
          email: `aluno${i}@teste.com`,
          turma_id: new mongoose.Types.ObjectId(),
          ativo: true,
        });
      }

      const response = await request(app)
        .get('/api/alunos?page=1&limit=20')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBeLessThanOrEqual(20);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.total).toBe(25);
      expect(response.body.pagination.hasNextPage).toBe(true);
    });

    it('Deve retornar página 2 com limite customizado', async () => {
      for (let i = 0; i < 30; i++) {
        await Aluno.create({
          nome: `Aluno ${i}`,
          matricula: `MAT00${i}`,
          email: `aluno${i}@teste.com`,
          turma_id: new mongoose.Types.ObjectId(),
          ativo: true,
        });
      }

      const response = await request(app)
        .get('/api/alunos?page=2&limit=10')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.pagination.page).toBe(2);
      expect(response.body.data.length).toBeLessThanOrEqual(10);
    });

    it('Deve requerer autenticação para listar alunos', async () => {
      const response = await request(app).get('/api/alunos');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  // ========================
  // NOTA TESTS
  // ========================
  describe('Notas', () => {
    beforeEach(async () => {
      const usuario = await Usuario.create({
        email: 'professor@teste.com',
        nome: 'Professor Teste',
        senha: '$2b$12$test',
        perfil: 'professor',
        ativo: true,
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'professor@teste.com',
          senha: 'Senha123!',
        });

      token = loginResponse.body.token;

      // Create test aluno
      const aluno = await Aluno.create({
        nome: 'Aluno Teste',
        matricula: 'MAT001',
        email: 'aluno@teste.com',
        turma_id: new mongoose.Types.ObjectId(),
        ativo: true,
      });

      alunoId = aluno._id;
    });

    it('Deve registrar nota válida', async () => {
      const response = await request(app)
        .post('/api/notas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          aluno_id: alunoId,
          disciplina: 'Matemática',
          valor: 8.5,
          bimestre: 1,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.valor).toBe(8.5);
    });

    it('Deve rejeitar nota com valor inválido', async () => {
      const response = await request(app)
        .post('/api/notas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          aluno_id: alunoId,
          disciplina: 'Matemática',
          valor: 11, // Máximo é 10
          bimestre: 1,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('Deve rejeitar nota sem aluno', async () => {
      const response = await request(app)
        .post('/api/notas')
        .set('Authorization', `Bearer ${token}`)
        .send({
          disciplina: 'Matemática',
          valor: 8.5,
          bimestre: 1,
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  // ========================
  // ERROR HANDLING TESTS
  // ========================
  describe('Error Handling', () => {
    it('Deve retornar 404 para rota não existente', async () => {
      const response = await request(app).get('/api/rota-inexistente');

      expect(response.status).toBe(404);
    });

    it('Deve retornar erro de validação para JSON inválido', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send('invalid json');

      expect([400, 415]).toContain(response.status);
    });

    it('Deve rejeitar token expirado', async () => {
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2MDAwMDAwMDB9.invalid';

      const response = await request(app)
        .get('/api/alunos')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(response.status).toBe(401);
    });
  });

  // ========================
  // PERFORMANCE TESTS
  // ========================
  describe('Performance', () => {
    it('Deve retornar listagem em menos de 1s', async () => {
      const usuario = await Usuario.create({
        email: 'prof@teste.com',
        nome: 'Prof Teste',
        senha: '$2b$12$test',
        perfil: 'professor',
        ativo: true,
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'prof@teste.com',
          senha: 'Senha123!',
        });

      token = loginResponse.body.token;

      // Create 100 alunos
      for (let i = 0; i < 100; i++) {
        await Aluno.create({
          nome: `Aluno ${i}`,
          matricula: `MAT${i}`,
          email: `aluno${i}@teste.com`,
          turma_id: new mongoose.Types.ObjectId(),
          ativo: true,
        });
      }

      const startTime = Date.now();

      await request(app)
        .get('/api/alunos?page=1&limit=20')
        .set('Authorization', `Bearer ${token}`);

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000); // 1 segundo
    });
  });
});

/**
 * Como rodar os testes:
 * 
 * npm test                              // Rodar todos os testes
 * npm test -- --testNamePattern=Auth    // Rodar só testes de Auth
 * npm test -- --coverage               // Com cobertura
 * npm test -- --watch                  // Watch mode
 */
