/**
 * equipePorEscola.regressao.test.js — Issue #554.
 *
 * A equipe nunca atravessa a fronteira da escola, inclusive para a conta admin
 * que abre o card do Dashboard. O Chat usa a mesma escola ativa, mas preserva
 * as permissões explícitas da matriz de conversa.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

let escolaA;
let escolaB;

function cookieDe(usuario) {
    return [`escola_jwt=${assinarTokenSessao(usuario)}`];
}

async function professorDa(escola, email, nome) {
    const usuario = await criarUsuario({
        email,
        nome,
        perfil: 'professor',
        escolaId: String(escola._id),
    });
    await Professor.create({
        idUsuario: String(usuario._id),
        nome,
        email,
        salaPrincipal: '1A',
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ativo: true,
    });
    return usuario;
}

beforeAll(conectarBanco);
afterAll(desconectarBanco);

beforeEach(async () => {
    await limparBanco();
    escolaA = await Escola.create({ nome: 'Escola A', tipo: 'EMEF', ativo: true });
    escolaB = await Escola.create({ nome: 'Escola B', tipo: 'EMEF', ativo: true });
    invalidarCacheEscolas();
});

describe('fronteira da equipe entre escolas', () => {
    it('Dashboard e Chat retornam somente a equipe da escola ativa', async () => {
        const professorA = await professorDa(escolaA, 'prof.a@escola.test', 'Professor A');
        const professorB = await professorDa(escolaB, 'prof.b@escola.test', 'Professor B');
        const adminDaA = await criarUsuario({
            email: 'admin.a@escola.test',
            nome: 'Admin da Escola A',
            perfil: 'admin',
            escolaId: String(escolaA._id),
        });

        const dashboard = await request(app)
            .get('/api/professores/status-online')
            .set('Cookie', cookieDe(adminDaA));
        expect(dashboard.status).toBe(200);
        expect(dashboard.body.data.map((integrante) => integrante.userId)).toContain(
            String(professorA._id)
        );
        expect(dashboard.body.data.map((integrante) => integrante.userId)).not.toContain(
            String(professorB._id)
        );

        const chatDaA = await request(app)
            .get('/api/chat-direto/contatos')
            .set('Cookie', cookieDe(professorA));
        const chatDaB = await request(app)
            .get('/api/chat-direto/contatos')
            .set('Cookie', cookieDe(professorB));

        expect(chatDaA.status).toBe(200);
        expect(chatDaB.status).toBe(200);
        expect(chatDaA.body.data.map((contato) => contato.id)).not.toContain(
            String(professorB._id)
        );
        expect(chatDaB.body.data.map((contato) => contato.id)).not.toContain(
            String(professorA._id)
        );
    });
});
