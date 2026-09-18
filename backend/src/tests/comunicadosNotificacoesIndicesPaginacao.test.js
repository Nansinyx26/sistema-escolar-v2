/**
 * comunicadosNotificacoesIndicesPaginacao.test.js
 *
 * Garante o cumprimento de todos os critérios de aceite da Issue #338 (Épico #334):
 * 1. explain das listas de comunicados e notificações usa o índice composto, sem estágio SORT em memória
 * 2. Sem page/limit, as respostas são idênticas às atuais (compatibilidade retroativa)
 * 3. Com ?page=2&limit=20, vem a segunda página e o bloco pagination estruturado
 * 4. limit acima do teto (100) é automaticamente reduzido ao teto
 */

const express = require('express');
const request = require('supertest');
const Comunicado = require('../models/Comunicado');
const Notificacao = require('../models/Notificacao');
const ComunicadoController = require('../controllers/ComunicadoController');
const NotificacaoController = require('../controllers/NotificacaoController');
const SecretariaController = require('../controllers/SecretariaController');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');

/**
 * Função recursiva para verificar se algum estágio do plano de execução é um SORT em memória.
 */
function hasSortStage(plan) {
    if (!plan) return false;
    if (plan.stage === 'SORT') return true;
    if (plan.inputStage && hasSortStage(plan.inputStage)) return true;
    if (Array.isArray(plan.inputStages)) {
        return plan.inputStages.some(hasSortStage);
    }
    return false;
}

// Cria app de teste para testar controllers HTTP
function criarAppTeste() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        const userHeader = req.headers['x-test-user'];
        req.user = userHeader
            ? JSON.parse(userHeader)
            : { perfil: 'admin', _id: 'admin_1', nome: 'Admin' };
        req.escolaId = req.headers['x-test-escola'] || 'escola-teste-1';
        next();
    });

    app.get('/api/comunicados', ComunicadoController.getAll);
    app.get('/api/notificacoes', NotificacaoController.getAll);
    app.get('/api/secretaria/comunicados', SecretariaController.listarComunicados);

    return app;
}

describe('Índices Compostos e Paginação (Issue #338 / Épico #334)', () => {
    let app;

    beforeAll(async () => {
        await conectarBanco();
        // Garante que o Mongoose crie os índices no banco de teste in-memory
        await Comunicado.init();
        await Notificacao.init();
        app = criarAppTeste();
    });

    afterAll(async () => {
        await desconectarBanco();
    });

    beforeEach(async () => {
        await limparBanco();
    });

    describe('1. Verificação de Índices Compostos via explain (sem SORT em memória)', () => {
        beforeEach(async () => {
            // Cria documentos de teste para indexação
            const agora = Date.now();
            const docsComunicado = [];
            const docsNotificacao = [];

            for (let i = 0; i < 5; i++) {
                docsComunicado.push({
                    titulo: `Comunicado ${i}`,
                    conteudo: `Conteúdo ${i}`,
                    destinatarios: ['todos'],
                    escolaId: 'escola-teste-1',
                    ativo: true,
                    dataCriacao: new Date(agora - i * 10000),
                });

                docsNotificacao.push({
                    id: `notif_${i}`,
                    tipo: 'resumo_diario',
                    titulo: `Aviso ${i}`,
                    mensagem: `Mensagem ${i}`,
                    destinatarios: ['todos'],
                    escolaId: 'escola-teste-1',
                    dataCriacao: new Date(agora - i * 10000),
                });
            }

            await Comunicado.insertMany(docsComunicado);
            await Notificacao.insertMany(docsNotificacao);
        });

        it('Comunicado com { escolaId, ativo } ordenado por dataCriacao:-1 não usa SORT em memória', async () => {
            const explain = await Comunicado.find({ escolaId: 'escola-teste-1', ativo: true })
                .sort({ dataCriacao: -1 })
                .explain('executionStats');

            const winningPlan = explain.queryPlanner?.winningPlan;
            expect(winningPlan).toBeDefined();
            expect(hasSortStage(winningPlan)).toBe(false);
        });

        it('Comunicado com { ativo: true } ordenado por dataCriacao:-1 não usa SORT em memória', async () => {
            const explain = await Comunicado.find({ ativo: true })
                .sort({ dataCriacao: -1 })
                .explain('executionStats');

            const winningPlan = explain.queryPlanner?.winningPlan;
            expect(winningPlan).toBeDefined();
            expect(hasSortStage(winningPlan)).toBe(false);
        });

        it('Notificacao com { escolaId } ordenado por dataCriacao:-1 não usa SORT em memória', async () => {
            const explain = await Notificacao.find({ escolaId: 'escola-teste-1' })
                .sort({ dataCriacao: -1 })
                .explain('executionStats');

            const winningPlan = explain.queryPlanner?.winningPlan;
            expect(winningPlan).toBeDefined();
            expect(hasSortStage(winningPlan)).toBe(false);
        });

        it('Notificacao com { tipo } ordenado por dataCriacao:-1 não usa SORT em memória', async () => {
            const explain = await Notificacao.find({ tipo: 'resumo_diario' })
                .sort({ dataCriacao: -1 })
                .explain('executionStats');

            const winningPlan = explain.queryPlanner?.winningPlan;
            expect(winningPlan).toBeDefined();
            expect(hasSortStage(winningPlan)).toBe(false);
        });
    });

    describe('2. Paginação em /api/comunicados (ComunicadoController.getAll)', () => {
        beforeEach(async () => {
            const baseTime = Date.now();
            const comunicados = [];
            for (let i = 1; i <= 5; i++) {
                comunicados.push({
                    titulo: `Comunicado ${i}`,
                    conteudo: `Conteúdo ${i}`,
                    destinatarios: ['todos'],
                    escolaId: 'escola-teste-1',
                    ativo: true,
                    dataCriacao: new Date(baseTime + i * 1000),
                });
            }
            await Comunicado.insertMany(comunicados);
        });

        it('sem page e limit: resposta idêntica à atual (sem bloco pagination)', async () => {
            const res = await request(app).get('/api/comunicados');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBe(5);
            expect(res.body.pagination).toBeUndefined();
        });

        it('com ?page=2&limit=2: retorna segunda página e bloco pagination estruturado', async () => {
            const res = await request(app).get('/api/comunicados?page=2&limit=2');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBe(2);

            // Confere ordenação por dataCriacao decrescente:
            // Itens 5, 4 (página 1), 3, 2 (página 2), 1 (página 3)
            expect(res.body.data[0].titulo).toBe('Comunicado 3');
            expect(res.body.data[1].titulo).toBe('Comunicado 2');

            expect(res.body.pagination).toBeDefined();
            expect(res.body.pagination).toEqual({
                page: 2,
                limit: 2,
                total: 5,
                pages: 3,
                hasNextPage: true,
                hasPrevPage: true,
                nextPage: 3,
                prevPage: 1,
            });
        });

        it('com ?limit=500: reduz automaticamente ao teto (100)', async () => {
            const res = await request(app).get('/api/comunicados?limit=500');

            expect(res.status).toBe(200);
            expect(res.body.pagination).toBeDefined();
            expect(res.body.pagination.limit).toBe(100);
            expect(res.body.pagination.page).toBe(1);
        });

        it('com ?page=0 ou negativo: normaliza page para 1', async () => {
            const res = await request(app).get('/api/comunicados?page=0&limit=10');

            expect(res.status).toBe(200);
            expect(res.body.pagination).toBeDefined();
            expect(res.body.pagination.page).toBe(1);
        });
    });

    describe('3. Paginação em /api/notificacoes (NotificacaoController.getAll)', () => {
        beforeEach(async () => {
            const baseTime = Date.now();
            const notificacoes = [];
            for (let i = 1; i <= 6; i++) {
                notificacoes.push({
                    id: `notif_${i}`,
                    tipo: 'informativo',
                    titulo: `Notificação ${i}`,
                    mensagem: `Mensagem ${i}`,
                    destinatarios: ['todos'],
                    escolaId: 'escola-teste-1',
                    dataCriacao: new Date(baseTime + i * 1000),
                });
            }
            await Notificacao.insertMany(notificacoes);
        });

        it('sem page e limit: resposta idêntica à atual (sem bloco pagination)', async () => {
            const res = await request(app).get('/api/notificacoes');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBe(6);
            expect(res.body.pagination).toBeUndefined();
        });

        it('com ?page=2&limit=2: retorna página 2 e bloco pagination', async () => {
            const res = await request(app).get('/api/notificacoes?page=2&limit=2');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBe(2);
            expect(res.body.pagination).toEqual({
                page: 2,
                limit: 2,
                total: 6,
                pages: 3,
                hasNextPage: true,
                hasPrevPage: true,
                nextPage: 3,
                prevPage: 1,
            });
        });

        it('com ?limit=300: reduz automaticamente ao teto (100)', async () => {
            const res = await request(app).get('/api/notificacoes?limit=300');

            expect(res.status).toBe(200);
            expect(res.body.pagination).toBeDefined();
            expect(res.body.pagination.limit).toBe(100);
        });
    });

    describe('4. Paginação em /api/secretaria/comunicados (SecretariaController.listarComunicados)', () => {
        beforeEach(async () => {
            const baseTime = Date.now();
            const comunicados = [];
            for (let i = 1; i <= 4; i++) {
                comunicados.push({
                    titulo: `Comunicado Sec ${i}`,
                    conteudo: `Conteúdo Sec ${i}`,
                    destinatarios: ['todos'],
                    escolaId: 'escola-teste-1',
                    ativo: true,
                    dataCriacao: new Date(baseTime + i * 1000),
                });
            }
            await Comunicado.insertMany(comunicados);
        });

        it('sem parâmetros: retorna todos sem pagination', async () => {
            const res = await request(app).get('/api/secretaria/comunicados');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBe(4);
            expect(res.body.pagination).toBeUndefined();
        });

        it('com paginação: retorna bloco pagination', async () => {
            const res = await request(app).get('/api/secretaria/comunicados?page=1&limit=2');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.length).toBe(2);
            expect(res.body.pagination).toEqual({
                page: 1,
                limit: 2,
                total: 4,
                pages: 2,
                hasNextPage: true,
                hasPrevPage: false,
                nextPage: 2,
                prevPage: null,
            });
        });
    });
});
