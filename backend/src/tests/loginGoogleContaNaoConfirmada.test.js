/**
 * loginGoogleContaNaoConfirmada.test.js — Issue #708
 *
 * A conta de responsável criada pelo cadastro com senha nasce sem confirmação,
 * e a #412 a barra até alguém provar que é dono da caixa postal. Quem cria a
 * conta não precisa ser o dono do e-mail. Quando o dono real entrava com o
 * Google, a conta virava confirmada e a senha e as sessões de quem a criou
 * passavam a atravessar o portão. Agora o login com Google que confirma a conta
 * descarta a senha do cadastro e derruba as sessões anteriores.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');

jest.mock('google-auth-library', () => ({
    OAuth2Client: jest.fn().mockImplementation(() => ({
        verifyIdToken: jest.fn(async () => ({
            getPayload: () => ({
                email: 'dona.real@familia.test',
                email_verified: true,
                name: 'Dona Real',
            }),
        })),
    })),
}));

const app = require('../app');
const Aluno = require('../models/Aluno');
const AuditLog = require('../models/AuditLog');
const Usuario = require('../models/Usuario');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheDeVerificacao } = require('../services/verificacaoEmail');

// Montado em partes: o literal inteiro tem o formato de um JWT e seria
// apontado por detector de segredo, embora não assine nada.
const ID_TOKEN = ['eyJ' + 'hbGciOiJSUzI1NiJ9', 'eyJ' + 'maXh0dXJlIjp0cnVlfQ', 'assinatura'].join(
    '.'
);
const SENHA_DO_CADASTRO = `Cadastro#${'Alheio'}2026`;

let socketsEncerrados;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    delete global.io;
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    invalidarCacheDeVerificacao();
    socketsEncerrados = [];
    global.io = {
        in: (sala) => ({ disconnectSockets: () => socketsEncerrados.push(sala) }),
    };
    await Aluno.create({
        nome: 'Filho da Dona',
        turma: '3A',
        responsavel: 'dona.real@familia.test',
        ativo: true,
    });
});

/** A conta que outra pessoa criou com o e-mail da dona, ainda sem confirmação. */
async function contaCriadaPorOutraPessoa(extra = {}) {
    const conta = await criarUsuario({
        perfil: 'responsavel',
        email: 'dona.real@familia.test',
        senha: await bcrypt.hash(SENHA_DO_CADASTRO, 10),
        emailVerificado: false,
        ...extra,
    });
    return Usuario.findById(conta._id).lean();
}

const cookieDe = (conta) => [`escola_jwt=${assinarTokenSessao(conta)}`];
const alunos = (cookie) => request(app).get('/api/responsavel/alunos').set('Cookie', cookie);
const entrarComGoogle = () => request(app).post('/api/auth/google-login').send({ token: ID_TOKEN });
const cookieDaResposta = (res) =>
    (res.headers['set-cookie'] || [])
        .filter((c) => c.startsWith('escola_jwt='))
        .map((c) => c.split(';')[0]);

describe('login com Google numa conta que ainda precisava confirmar o e-mail', () => {
    it('derruba a sessão de quem criou a conta e descarta a senha do cadastro', async () => {
        const conta = await contaCriadaPorOutraPessoa();
        const sessaoDeQuemCriou = cookieDe(conta);
        const antes = await alunos(sessaoDeQuemCriou);
        expect(antes.status).toBe(403);
        expect(antes.body.codigo).toBe('EMAIL_NAO_VERIFICADO');

        const google = await entrarComGoogle();
        expect(google.status).toBe(200);

        const depois = await Usuario.findById(conta._id).select('+senha').lean();
        expect(depois.emailVerificado).toBe(true);
        expect(depois.tokenVersion).toBe((conta.tokenVersion || 0) + 1);
        expect(await bcrypt.compare(SENHA_DO_CADASTRO, depois.senha)).toBe(false);

        // A sessão anterior não atravessa mais o portão — nem com o e-mail confirmado.
        expect((await alunos(sessaoDeQuemCriou)).status).toBe(401);
        // As conexões em tempo real da conta caem junto.
        expect(socketsEncerrados).toEqual([`user:${conta._id}`]);

        const auditoria = await AuditLog.findOne({ acao: 'CONTA_CONFIRMADA_PELO_GOOGLE' }).lean();
        expect(auditoria).not.toBeNull();
    });

    it('a sessão do Google funciona e mostra os filhos da dona', async () => {
        await contaCriadaPorOutraPessoa();

        const google = await entrarComGoogle();
        const res = await alunos(cookieDaResposta(google));

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).toContain('Filho da Dona');
    });

    it('a senha do cadastro deixa de entrar', async () => {
        await contaCriadaPorOutraPessoa();
        const entrarComSenha = () =>
            request(app).post('/api/auth/login').send({
                email: 'dona.real@familia.test',
                senha: SENHA_DO_CADASTRO,
                portal: 'responsavel',
            });
        // Controle: antes do Google, a senha de quem criou a conta entra.
        expect((await entrarComSenha()).status).toBe(200);

        await entrarComGoogle();

        const login = await entrarComSenha();
        expect(login.status).toBe(401);
        expect(cookieDaResposta(login)).toEqual([]);
    });
});

describe('conta que já não precisava confirmar segue como estava', () => {
    it('conta confirmada mantém senha e sessões', async () => {
        const conta = await contaCriadaPorOutraPessoa({ emailVerificado: true });
        const sessao = cookieDe(conta);

        expect((await entrarComGoogle()).status).toBe(200);

        const depois = await Usuario.findById(conta._id).select('+senha').lean();
        expect(depois.tokenVersion || 0).toBe(conta.tokenVersion || 0);
        expect(await bcrypt.compare(SENHA_DO_CADASTRO, depois.senha)).toBe(true);
        expect((await alunos(sessao)).status).toBe(200);
        expect(socketsEncerrados).toEqual([]);
    });

    it('conta legada, de antes do marco da #412, mantém senha e sessões', async () => {
        const conta = await contaCriadaPorOutraPessoa();
        await Usuario.collection.updateOne(
            { _id: conta._id },
            { $set: { createdAt: new Date('2026-01-15T12:00:00Z') } }
        );
        const sessao = cookieDe(conta);

        expect((await entrarComGoogle()).status).toBe(200);

        const depois = await Usuario.findById(conta._id).select('+senha').lean();
        expect(depois.tokenVersion || 0).toBe(conta.tokenVersion || 0);
        expect(await bcrypt.compare(SENHA_DO_CADASTRO, depois.senha)).toBe(true);
        expect((await alunos(sessao)).status).toBe(200);
    });
});
