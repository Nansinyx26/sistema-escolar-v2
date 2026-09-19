/**
 * contencaoAcesso.regressao.test.js — Issue #378
 *
 * Três entradas que ficaram restritas ao papel de cada perfil:
 *   1. cadastro de direção e secretaria não é público;
 *   2. login com Google é só para o perfil responsável;
 *   3. a importação de alunos por texto não envia o documento a IA externa.
 *
 * Cada bloco testa a recusa E o caminho legítimo que precisa continuar vivo.
 */
const request = require('supertest');

// Verificação do Google sem rede: devolve o payload definido pelo teste.
jest.mock('google-auth-library', () => ({
    OAuth2Client: jest.fn().mockImplementation(() => ({
        verifyIdToken: jest.fn(async () => ({
            getPayload: () => global.__GOOGLE_PAYLOAD__,
        })),
    })),
}));

const app = require('../app');
const Usuario = require('../models/Usuario');
const AuditLog = require('../models/AuditLog');
const SecurityConfig = require('../models/SecurityConfig');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
    CODIGO_ESCOLA_TESTE,
} = require('./helpers');
const { CONSENTIMENTO_VERSAO } = require('../utils/consentimentoLgpd');
const { assinarTokenSessao } = require('../utils/sessionToken');

const ACEITE = { aceito: true, versao: CONSENTIMENTO_VERSAO };
const ID_TOKEN_FALSO = 'eyJ.fixture.token';

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    await SecurityConfig.create({
        chave: 'CONFIG_GERAL',
        codigoSecretoEscola: CODIGO_ESCOLA_TESTE,
        rotacaoAutomatica: false,
    });
});

function temCookieDeSessao(res) {
    return (res.headers['set-cookie'] || []).some((c) => c.startsWith('escola_jwt='));
}

describe('cadastro público de direção e secretaria', () => {
    it.each(['register-diretor', 'register-secretaria'])(
        '%s com código válido da escola → 403, sem conta e sem sessão',
        async (rota) => {
            const email = `${rota}@escola.test`;
            const res = await request(app).post(`/api/auth/${rota}`).send({
                nome: 'Pessoa Fixture',
                email,
                senha: SENHA_TESTE,
                telefone: '(19) 99999-0003',
                codigoEscola: CODIGO_ESCOLA_TESTE,
                consentimentoLgpd: ACEITE,
            });
            expect(res.status).toBe(403);
            expect(res.body.codigo).toBe('CADASTRO_EQUIPE_POR_CONVITE');
            expect(temCookieDeSessao(res)).toBe(false);
            expect(await Usuario.countDocuments({ email })).toBe(0);
        }
    );

    it('cadastro docente com o código da escola continua funcionando', async () => {
        const res = await request(app).post('/api/auth/register-docente').send({
            nome: 'Docente Fixture',
            email: 'docente@escola.test',
            senha: SENHA_TESTE,
            disciplina: 'História',
            turma: '2B',
            matricula: 'M42',
            telefone: '(19) 99999-0002',
            codigoEscola: CODIGO_ESCOLA_TESTE,
            consentimentoLgpd: ACEITE,
        });
        expect(res.status).toBe(201);
        const conta = await Usuario.findOne({ email: 'docente@escola.test' }).lean();
        expect(conta.perfil).toBe('professor');
    });
});

describe('login com Google', () => {
    function loginGoogle(payload) {
        global.__GOOGLE_PAYLOAD__ = { email_verified: true, ...payload };
        return request(app).post('/api/auth/google-login').send({ token: ID_TOKEN_FALSO });
    }

    it.each(['diretor', 'secretaria', 'professor', 'admin'])(
        'conta de %s → 403, sem sessão e sem alterar a conta',
        async (perfil) => {
            const conta = await criarUsuario({ email: `${perfil}@escola.test`, perfil });
            const res = await loginGoogle({ email: conta.email, name: 'Qualquer', picture: '' });

            expect(res.status).toBe(403);
            expect(res.body.codigo).toBe('LOGIN_GOOGLE_SO_RESPONSAVEL');
            expect(temCookieDeSessao(res)).toBe(false);

            const depois = await Usuario.findById(conta._id).lean();
            expect(depois.loginGoogle).toBeUndefined();
            expect(await AuditLog.countDocuments({ acao: 'LOGIN_GOOGLE_RECUSADO' })).toBe(1);
        }
    );

    it('responsável existente entra normalmente', async () => {
        await criarUsuario({ email: 'mae@familia.test', perfil: 'responsavel' });
        const res = await loginGoogle({ email: 'mae@familia.test', name: 'Mãe', picture: '' });
        expect(res.status).toBe(200);
        expect(res.body.user.perfil).toBe('responsavel');
        expect(temCookieDeSessao(res)).toBe(true);
    });

    it('e-mail novo cria conta de responsável', async () => {
        const res = await loginGoogle({ email: 'novo@familia.test', name: 'Novo', picture: '' });
        expect(res.status).toBe(200);
        const conta = await Usuario.findOne({ email: 'novo@familia.test' }).lean();
        expect(conta.perfil).toBe('responsavel');
    });

    it('responsável desativado não recebe sessão', async () => {
        await criarUsuario({ email: 'inativo@familia.test', perfil: 'responsavel', ativo: false });
        const res = await loginGoogle({ email: 'inativo@familia.test', name: 'X', picture: '' });
        expect(res.status).toBe(401);
        expect(temCookieDeSessao(res)).toBe(false);
    });
});

describe('importação de alunos por texto', () => {
    it('não envia o documento ao provedor de IA', async () => {
        const voiceService = require('../services/voiceService');
        const espiao = jest.spyOn(voiceService, 'generateInsightText');
        const secretaria = await criarUsuario({ email: 'sec@escola.test', perfil: 'secretaria' });

        const res = await request(app)
            .post('/api/secretaria/alunos/importar/estruturar')
            .set('Cookie', [`escola_jwt=${assinarTokenSessao(secretaria)}`])
            .send({ texto: 'Fulano de Tal, RA 123, turma 3A, nascido em 01/01/2018' });

        expect(res.status).toBe(410);
        expect(espiao).not.toHaveBeenCalled();
        espiao.mockRestore();
    });
});
