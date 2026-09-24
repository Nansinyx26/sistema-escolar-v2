/**
 * pedidosTitular.regressao.test.js — Issue #413
 *
 * Registra pedidos do titular em coleção própria e exporta dados do filho:
 * 1. Coleção própria de pedidos (tipo, protocolo, status, prazo de 15 dias, histórico);
 * 2. Exportação de dados do responsável inclui dependentes/filhos;
 * 3. Correção do prazo de 15 dias (sem a menção incorreta de "dias úteis");
 * 4. Painel administrativo para acompanhamento e despacho.
 */
const request = require('supertest');
const app = require('../app');
const Usuario = require('../models/Usuario');
const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const PedidoTitular = require('../models/PedidoTitular');
const AuditLog = require('../models/AuditLog');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

let responsavelUser;
let adminUser;
let outroUser;
let alunoFilho;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

beforeAll(async () => {
    await conectarBanco();
});

afterAll(async () => {
    await desconectarBanco();
});

beforeEach(async () => {
    await limparBanco();

    responsavelUser = await criarUsuario({
        email: 'pai@familia.test',
        nome: 'Carlos Pai',
        perfil: 'responsavel',
    });

    adminUser = await criarUsuario({
        email: 'admin@escola.test',
        nome: 'Admin Geral',
        perfil: 'admin',
    });

    outroUser = await criarUsuario({
        email: 'outro@escola.test',
        nome: 'Outro Usuario',
        perfil: 'professor',
    });

    alunoFilho = await Aluno.create({
        nome: 'Lucas',
        sobrenome: 'Filho',
        matricula: '123456',
        raDigito: '7',
        raUf: 'SP',
        turma: '5A',
        nascimento: new Date('2015-05-10'),
        responsavel: 'pai@familia.test',
        responsaveis: [{ nome: 'Carlos Pai', email: 'pai@familia.test' }],
        ativo: true,
    });

    await Nota.create({
        alunoId: String(alunoFilho._id),
        materia: 'Matemática',
        valor: 9.5,
        bimestre: 1,
        tipo: 'prova',
    });

    await Falta.create({
        alunoId: String(alunoFilho._id),
        data: new Date('2026-03-01'),
        motivo: 'Consulta médica',
        presente: false,
        justificada: true,
    });
});

describe('Issue #413 — Pedidos do Titular em coleção própria', () => {
    it('solicitação de exclusão cria documento em pedidos_titular com protocolo e prazo de 15 dias', async () => {
        const res = await request(app)
            .post('/api/meus-dados/solicitar-exclusao')
            .set('Cookie', cookieDe(responsavelUser))
            .send({ motivo: 'Mudei de cidade' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.protocolo).toMatch(/^LGPD-\d+-[A-Z0-9]+$/);
        expect(res.body.status).toBe('pendente');
        // Não deve informar dias úteis (correção do prazo informado ao titular)
        expect(res.body.message).toContain('15 dias');
        expect(res.body.message).not.toContain('15 dias úteis');

        const pedidoNoBanco = await PedidoTitular.findOne({ protocolo: res.body.protocolo });
        expect(pedidoNoBanco).toBeTruthy();
        expect(pedidoNoBanco.usuarioId).toBe(String(responsavelUser._id));
        expect(pedidoNoBanco.usuarioEmail).toBe('pai@familia.test');
        expect(pedidoNoBanco.motivo).toBe('Mudei de cidade');
        expect(pedidoNoBanco.status).toBe('pendente');
        expect(pedidoNoBanco.historico.length).toBe(1);
        expect(pedidoNoBanco.historico[0].status).toBe('pendente');

        // Prazo de 15 dias corridos
        const diffDias = Math.round(
            (new Date(pedidoNoBanco.prazoAtendimento) - new Date()) / (1000 * 60 * 60 * 24)
        );
        expect(diffDias).toBeGreaterThanOrEqual(14);
        expect(diffDias).toBeLessThanOrEqual(15);
    });

    it('GET /api/meus-dados/pedidos retorna os pedidos do titular autenticado', async () => {
        await PedidoTitular.create({
            protocolo: 'LGPD-TESTE-001',
            usuarioId: String(responsavelUser._id),
            usuarioEmail: 'pai@familia.test',
            tipo: 'exclusao',
            status: 'pendente',
            prazoAtendimento: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        });

        await PedidoTitular.create({
            protocolo: 'LGPD-TESTE-002',
            usuarioId: String(outroUser._id),
            usuarioEmail: 'outro@escola.test',
            tipo: 'exportacao',
            status: 'concluido',
            prazoAtendimento: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        });

        const res = await request(app)
            .get('/api/meus-dados/pedidos')
            .set('Cookie', cookieDe(responsavelUser));

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.length).toBe(1);
        expect(res.body.data[0].protocolo).toBe('LGPD-TESTE-001');
    });
});

describe('Issue #413 — Exportação de dados do responsável inclui dados do filho', () => {
    it('responsável baixa pacote contendo seus dados e os dados escolares do filho', async () => {
        const res = await request(app)
            .get('/api/meus-dados')
            .set('Cookie', cookieDe(responsavelUser));

        expect(res.status).toBe(200);
        expect(res.body.titular).toBeDefined();
        expect(res.body.titular.email).toBe('pai@familia.test');

        // Campo dependentes com os dados completos do filho
        expect(res.body.dependentes).toBeDefined();
        expect(Array.isArray(res.body.dependentes)).toBe(true);
        expect(res.body.dependentes.length).toBe(1);

        const filho = res.body.dependentes[0];
        expect(filho.nome).toBe('Lucas');
        expect(filho.matricula).toBe('123456');
        expect(filho.turma).toBe('5A');
        expect(filho.notas.length).toBe(1);
        expect(filho.notas[0].materia).toBe('Matemática');
        expect(filho.notas[0].valor).toBe(9.5);
        expect(filho.faltas.length).toBe(1);
        expect(filho.faltas[0].motivo).toBe('Consulta médica');
    });

    it('usuário sem filhos dependentes exporta dados pessoais sem campo dependentes', async () => {
        const res = await request(app).get('/api/meus-dados').set('Cookie', cookieDe(outroUser));

        expect(res.status).toBe(200);
        expect(res.body.titular.email).toBe('outro@escola.test');
        expect(res.body.dependentes).toBeUndefined();
    });
});

describe('Issue #413 — Gestão administrativa de pedidos do titular', () => {
    it('bloqueia acesso a rotas de gestão para usuários sem perfil admin', async () => {
        const res = await request(app)
            .get('/api/admin/pedidos-titular')
            .set('Cookie', cookieDe(responsavelUser));

        expect(res.status).toBe(403);
    });

    it('admin lista pedidos com cálculo de dias restantes', async () => {
        await PedidoTitular.create({
            protocolo: 'LGPD-ADMIN-100',
            usuarioId: String(responsavelUser._id),
            usuarioEmail: 'pai@familia.test',
            usuarioNome: 'Carlos Pai',
            tipo: 'exclusao',
            status: 'pendente',
            prazoAtendimento: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        });

        const res = await request(app)
            .get('/api/admin/pedidos-titular')
            .set('Cookie', cookieDe(adminUser));

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.length).toBe(1);
        expect(res.body.data[0].protocolo).toBe('LGPD-ADMIN-100');
        expect(res.body.data[0].diasRestantes).toBeGreaterThanOrEqual(9);
    });

    it('admin despacha pedido atualizando status, histórico e resposta', async () => {
        const pedido = await PedidoTitular.create({
            protocolo: 'LGPD-DESPACHO-200',
            usuarioId: String(responsavelUser._id),
            usuarioEmail: 'pai@familia.test',
            tipo: 'exclusao',
            status: 'pendente',
            prazoAtendimento: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
            historico: [{ status: 'pendente', alteradoEm: new Date() }],
        });

        const res = await request(app)
            .patch(`/api/admin/pedidos-titular/${pedido._id}`)
            .set('Cookie', cookieDe(adminUser))
            .send({
                status: 'concluido',
                observacao: 'Pedido analisado e deferido pela gestão',
                respostaAdmin: 'Seus dados foram tratados conforme a LGPD.',
            });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.status).toBe('concluido');

        const noBanco = await PedidoTitular.findById(pedido._id);
        expect(noBanco.status).toBe('concluido');
        expect(noBanco.decididoEm).toBeTruthy();
        expect(noBanco.respostaAdmin).toBe('Seus dados foram tratados conforme a LGPD.');
        expect(noBanco.historico.length).toBe(2);
        expect(noBanco.historico[1].status).toBe('concluido');
        expect(noBanco.historico[1].observacao).toBe('Pedido analisado e deferido pela gestão');
    });
});
