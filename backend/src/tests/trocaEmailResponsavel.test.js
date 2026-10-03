/**
 * trocaEmailResponsavel.test.js
 *
 * Issue #571: o responsável trocava o e-mail da conta por PUT /api/auth/profile
 * sem confirmar o endereço novo. Como o vínculo com o aluno é decidido pelo
 * e-mail, trocar para o endereço do responsável de outra criança dava acesso
 * aos dados dela. O e-mail não pode mais mudar por nenhuma rota de autoatendimento.
 */

const request = require('supertest');
const app = require('../app');
const Usuario = require('../models/Usuario');
const Aluno = require('../models/Aluno');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

const EMAIL_ATACANTE = 'familia.a@exemplo.test';
const EMAIL_ALVO = 'familia.b@exemplo.test';

beforeAll(async () => {
    await conectarBanco();
});

beforeEach(() => {
    invalidarCacheEscolas();
});

afterEach(async () => {
    await limparBanco();
    invalidarCacheEscolas();
});

afterAll(async () => {
    await desconectarBanco();
});

async function criarResponsavel() {
    const responsavel = await criarUsuario({
        perfil: 'responsavel',
        nome: 'Responsável A',
        email: EMAIL_ATACANTE,
    });
    return { responsavel, cookie: [`escola_jwt=${assinarTokenSessao(responsavel)}`] };
}

describe('PUT /api/auth/profile — e-mail não é alterável (Issue #571)', () => {
    it('recusa trocar o e-mail para o endereço do responsável de outro aluno', async () => {
        const { responsavel, cookie } = await criarResponsavel();
        await Aluno.create({ nome: 'Criança B', turma: '1A', responsavel: EMAIL_ALVO });

        const res = await request(app)
            .put('/api/auth/profile')
            .set('Cookie', cookie)
            .send({ email: EMAIL_ALVO, nome: 'Outro nome' });

        expect(res.status).toBe(400);
        expect(res.body.codigo).toBe('EMAIL_NAO_ALTERAVEL');

        const conta = await Usuario.findById(responsavel._id).lean();
        expect(conta.email).toBe(EMAIL_ATACANTE);
        // A recusa vem antes de qualquer escrita
        expect(conta.nome).toBe('Responsável A');
    });

    it('aceita o mesmo e-mail atual (em qualquer caixa) sem alterar nada', async () => {
        const { responsavel, cookie } = await criarResponsavel();

        const res = await request(app)
            .put('/api/auth/profile')
            .set('Cookie', cookie)
            .send({ email: ` ${EMAIL_ATACANTE.toUpperCase()} `, nome: 'Nome Novo' });

        expect(res.status).toBe(200);
        const conta = await Usuario.findById(responsavel._id).lean();
        expect(conta.email).toBe(EMAIL_ATACANTE);
        expect(conta.nome).toBe('Nome Novo');
    });

    it('PUT /api/usuarios/:id na própria conta também não troca o e-mail', async () => {
        const { responsavel, cookie } = await criarResponsavel();

        await request(app)
            .put(`/api/usuarios/${responsavel._id}`)
            .set('Cookie', cookie)
            .send({ email: EMAIL_ALVO });

        const conta = await Usuario.findById(responsavel._id).lean();
        expect(conta.email).toBe(EMAIL_ATACANTE);
    });
});
