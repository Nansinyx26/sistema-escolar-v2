/**
 * emailVerificadoResponsavel.regressao.test.js — Issue #412
 *
 * O vínculo com o aluno é decidido pelo e-mail que a secretaria digitou na
 * ficha. Quem criasse uma conta com aquele endereço herdava o acesso, sem
 * nunca provar que a caixa postal era dele.
 *
 * Agora conta de responsável criada a partir do marco só vê dado de aluno
 * depois de confirmar o e-mail. Conta anterior ao marco continua como estava.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Usuario = require('../models/Usuario');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const {
    exigeVerificacao,
    invalidarCacheDeVerificacao,
    MARCO_PADRAO,
} = require('../services/verificacaoEmail');

const ANTES_DO_MARCO = new Date(new Date(MARCO_PADRAO).getTime() - 30 * 24 * 3600 * 1000);
const DEPOIS_DO_MARCO = new Date(new Date(MARCO_PADRAO).getTime() + 24 * 3600 * 1000);

let escola;
let aluno;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

/** Cria a conta do responsável com data de nascimento e estado controlados. */
async function contaResponsavel({ criadaEm, verificado = false }) {
    const conta = await criarUsuario({
        email: 'mae@familia.test',
        perfil: 'responsavel',
        escolaId: String(escola._id),
    });
    await Usuario.collection.updateOne(
        { _id: conta._id },
        { $set: { createdAt: criadaEm, emailVerificado: verificado } }
    );
    invalidarCacheDeVerificacao(conta._id);
    return conta;
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    invalidarCacheDeVerificacao();
    escola = await Escola.create({ nome: 'EMEF Verificacao', tipo: 'EMEF', ativo: true });
    aluno = await Aluno.create({
        escolaId: String(escola._id),
        nome: 'Criança Fixture',
        turma: '1A',
        responsavel: 'mae@familia.test',
        responsaveis: [{ nome: 'Mãe', email: 'mae@familia.test' }],
        ativo: true,
    });
    invalidarCacheEscolas();
});

describe('conta nova só vê o aluno depois de confirmar o e-mail', () => {
    it('sem confirmar: a lista do portal responde 403 com código próprio', async () => {
        const mae = await contaResponsavel({ criadaEm: DEPOIS_DO_MARCO });

        const res = await request(app).get('/api/responsavel/alunos').set('Cookie', cookieDe(mae));

        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('EMAIL_NAO_VERIFICADO');
        expect(JSON.stringify(res.body)).not.toContain('Criança Fixture');
    });

    it('sem confirmar: a ficha por id também fecha', async () => {
        const mae = await contaResponsavel({ criadaEm: DEPOIS_DO_MARCO });

        const res = await request(app)
            .get(`/api/responsavel/notas/${aluno._id}`)
            .set('Cookie', cookieDe(mae));

        expect(res.status).toBe(403);
    });

    it('depois de confirmar: enxerga o filho', async () => {
        const mae = await contaResponsavel({ criadaEm: DEPOIS_DO_MARCO });

        await Usuario.updateOne({ _id: mae._id }, { $set: { emailVerificado: true } });
        invalidarCacheDeVerificacao(mae._id);

        const res = await request(app).get('/api/responsavel/alunos').set('Cookie', cookieDe(mae));

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toContain(String(aluno._id));
    });

    it('conta anterior ao marco continua entrando, mesmo sem confirmação', async () => {
        const mae = await contaResponsavel({ criadaEm: ANTES_DO_MARCO });

        const res = await request(app).get('/api/responsavel/alunos').set('Cookie', cookieDe(mae));

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toContain(String(aluno._id));
    });

    it('a regra não alcança a equipe da escola', async () => {
        const professor = await criarUsuario({
            email: 'prof@escola.test',
            perfil: 'professor',
            escolaId: String(escola._id),
        });
        await Usuario.collection.updateOne(
            { _id: professor._id },
            { $set: { createdAt: DEPOIS_DO_MARCO, emailVerificado: false } }
        );

        expect(
            exigeVerificacao({
                perfil: 'professor',
                emailVerificado: false,
                createdAt: DEPOIS_DO_MARCO,
            })
        ).toBe(false);
    });
});

describe('o reenvio do link', () => {
    it('gera um token novo e responde igual para quem já confirmou', async () => {
        const mae = await contaResponsavel({ criadaEm: DEPOIS_DO_MARCO });

        const res = await request(app)
            .post('/api/auth/reenviar-verificacao')
            .set('Cookie', cookieDe(mae));

        expect(res.status).toBe(200);
        const depois = await Usuario.findById(mae._id)
            .select('+emailVerificacaoToken +emailVerificacaoExpiry')
            .lean();
        expect(depois.emailVerificacaoToken).toBeTruthy();
        expect(new Date(depois.emailVerificacaoExpiry).getTime()).toBeGreaterThan(Date.now());
        // o token não volta na resposta: quem não tem a caixa postal não o recebe
        expect(JSON.stringify(res.body)).not.toContain(depois.emailVerificacaoToken);
    });

    it('confirmar pelo link libera o portal', async () => {
        const mae = await contaResponsavel({ criadaEm: DEPOIS_DO_MARCO });
        await request(app).post('/api/auth/reenviar-verificacao').set('Cookie', cookieDe(mae));
        const { emailVerificacaoToken } = await Usuario.findById(mae._id)
            .select('+emailVerificacaoToken')
            .lean();

        const confirmacao = await request(app).get(
            `/api/auth/verify-email/${emailVerificacaoToken}`
        );
        expect(confirmacao.status).toBe(200);

        const res = await request(app).get('/api/responsavel/alunos').set('Cookie', cookieDe(mae));
        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toContain(String(aluno._id));
    });
});
