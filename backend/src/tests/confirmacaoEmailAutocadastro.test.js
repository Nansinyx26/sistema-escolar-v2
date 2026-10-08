/**
 * confirmacaoEmailAutocadastro.test.js — Issue #716
 *
 * Os cadastros públicos da equipe (`register-docente` e `register-code`)
 * aceitam qualquer e-mail e abriam a sessão na hora: ninguém conferia se quem
 * criou a conta é dono do endereço. Agora a conta nasce marcada, recebe o link
 * de confirmação e só entra depois de clicar nele — o login recusa (e reenvia
 * o link, no máximo um a cada 10 minutos) e o `authJWT` recusa a sessão.
 */
jest.mock('../utils/emailNotifications', () => ({
    ...jest.requireActual('../utils/emailNotifications'),
    notificarVerificacaoEmail: jest.fn(async () => true),
}));

const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Usuario = require('../models/Usuario');
const { notificarVerificacaoEmail } = require('../utils/emailNotifications');
const { CONSENTIMENTO_VERSAO } = require('../utils/consentimentoLgpd');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { VALIDADE_HORAS } = require('../services/verificacaoEmail');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { SENHA_TESTE } = require('./helpers');

const CODIGO = 'CodigoDaEscola716';
const EMAIL = 'docente716@escola.test';
let escolaId;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    notificarVerificacaoEmail.mockClear();
    const escola = await Escola.create({
        nome: 'EMEF 716',
        tipo: 'EMEF',
        ativo: true,
        codigoSecreto: CODIGO,
    });
    escolaId = String(escola._id);
    invalidarCacheEscolas();
});

const consentimentoLgpd = { aceito: true, versao: CONSENTIMENTO_VERSAO };

function cadastrarDocente() {
    return request(app).post('/api/auth/register-docente').send({
        nome: 'Pessoa Docente',
        email: EMAIL,
        senha: SENHA_TESTE,
        disciplina: 'Matemática',
        turma: '6B',
        matricula: '0716',
        telefone: '11999990716',
        codigoEscola: CODIGO,
        escolaId,
        consentimentoLgpd,
    });
}

function cadastrarPorCodigo() {
    return request(app).post('/api/auth/register-code').send({
        nome: 'Pessoa Por Codigo',
        email: EMAIL,
        senha: SENHA_TESTE,
        telefone: '11988880716',
        codigoEscola: CODIGO,
        escolaId,
        consentimentoLgpd,
    });
}

const entrar = () =>
    request(app).post('/api/auth/login').send({ email: EMAIL, senha: SENHA_TESTE });

const temSessao = (res) =>
    (res.headers['set-cookie'] || []).some((c) => c.startsWith('escola_jwt='));

/** O envio do link roda em segundo plano depois da resposta. */
async function linksEnviados(quantos) {
    for (let i = 0; i < 100 && notificarVerificacaoEmail.mock.calls.length < quantos; i++) {
        await new Promise((r) => setTimeout(r, 10));
    }
    return notificarVerificacaoEmail.mock.calls;
}

describe.each([
    ['register-docente', cadastrarDocente],
    ['register-code', cadastrarPorCodigo],
])('%s', (_rota, cadastrar) => {
    it('cria a conta sem sessão, marcada, e manda o link de confirmação', async () => {
        const res = await cadastrar();

        expect(res.status).toBe(201);
        expect(res.body.confirmarEmail).toBe(true);
        expect(res.body.redirect_to).toBe('/html/login.html');
        expect(res.body.user).toBeUndefined();
        expect(temSessao(res)).toBe(false);

        const conta = await Usuario.findOne({ email: EMAIL }).lean();
        expect(conta.emailVerificado).toBe(false);
        expect(conta.confirmacaoEmailObrigatoria).toBe(true);

        const [[para, , link]] = await linksEnviados(1);
        expect(para).toBe(EMAIL);
        expect(link).toMatch(/\/api\/auth\/verify-email\/[0-9a-f]{64}$/);
    });

    it('a senha certa não entra antes de confirmar; depois do link, entra', async () => {
        await cadastrar();
        const [[, , link]] = await linksEnviados(1);

        const antes = await entrar();
        expect(antes.status).toBe(403);
        expect(antes.body.codigo).toBe('EMAIL_NAO_VERIFICADO');
        expect(temSessao(antes)).toBe(false);

        const confirmacao = await request(app).get(new URL(link).pathname);
        expect(confirmacao.status).toBe(200);
        expect(confirmacao.text).toContain('E-mail Verificado');

        const depois = await entrar();
        expect(depois.status).toBe(200);
        expect(temSessao(depois)).toBe(true);
    });
});

describe('reenvio do link pelo login', () => {
    it('não reenvia antes de 10 minutos; depois, reenvia', async () => {
        await cadastrarDocente();
        await linksEnviados(1);

        await entrar();
        await new Promise((r) => setTimeout(r, 50));
        expect(notificarVerificacaoEmail).toHaveBeenCalledTimes(1);

        // O link anterior foi emitido há 11 minutos.
        const emitidoHa11Min = Date.now() - 11 * 60 * 1000;
        await Usuario.updateOne(
            { email: EMAIL },
            {
                $set: {
                    emailVerificacaoExpiry: new Date(emitidoHa11Min + VALIDADE_HORAS * 3600 * 1000),
                },
            }
        );

        const res = await entrar();
        expect(res.body.codigo).toBe('EMAIL_NAO_VERIFICADO');
        expect(notificarVerificacaoEmail).toHaveBeenCalledTimes(2);
    });
});

describe('authJWT', () => {
    it('recusa a sessão de conta do autocadastro ainda não confirmada', async () => {
        await cadastrarDocente();
        const conta = await Usuario.findOne({ email: EMAIL }).lean();

        const res = await request(app)
            .get('/api/auth/me')
            .set('Cookie', [`escola_jwt=${assinarTokenSessao(conta)}`]);

        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('EMAIL_NAO_VERIFICADO');
    });
});

describe('quem não é do autocadastro segue como antes', () => {
    it('conta antiga sem a marca, ainda com e-mail não confirmado, entra', async () => {
        await criarUsuario({ email: EMAIL, perfil: 'professor', emailVerificado: false });

        const res = await entrar();

        expect(res.status).toBe(200);
        expect(temSessao(res)).toBe(true);
    });
});
