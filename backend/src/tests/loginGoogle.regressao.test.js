/**
 * loginGoogle.regressao.test.js — Issue #387
 *
 * O login com Google aceita só ID token, validado contra o client ID do
 * sistema, com e-mail verificado, e só para o perfil responsável (#378).
 * Também cobre o encerramento das sessões de equipe abertas antes da correção.
 */
const request = require('supertest');

// Verificação do Google sem rede. O mock registra os argumentos para o teste
// provar que o `audience` é o client ID do sistema, e pode recusar como o
// google-auth-library recusa um token de outro aplicativo.
const chamadasVerify = [];
jest.mock('google-auth-library', () => ({
    OAuth2Client: jest.fn().mockImplementation(() => ({
        verifyIdToken: jest.fn(async (args) => {
            chamadasVerify.push(args);
            if (global.__GOOGLE_RECUSA__)
                throw new Error('Wrong recipient, payload audience != requiredAudience');
            return { getPayload: () => global.__GOOGLE_PAYLOAD__ };
        }),
    })),
}));

const app = require('../app');
const Usuario = require('../models/Usuario');
const AuditLog = require('../models/AuditLog');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { encerrarSessoesDeEquipe } = require('../services/encerramentoSessoesEquipe');

// Montado em partes: o literal inteiro tem o formato de um JWT e seria
// apontado por detector de segredo, embora não assine nada.
const ID_TOKEN = ['eyJ' + 'hbGciOiJSUzI1NiJ9', 'eyJ' + 'maXh0dXJlIjp0cnVlfQ', 'assinatura'].join(
    '.'
);

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    chamadasVerify.length = 0;
    global.__GOOGLE_RECUSA__ = false;
    global.__GOOGLE_PAYLOAD__ = null;
});

function temCookieDeSessao(res) {
    return (res.headers['set-cookie'] || []).some((c) => c.startsWith('escola_jwt='));
}

function login(token = ID_TOKEN) {
    return request(app).post('/api/auth/google-login').send({ token });
}

describe('POST /api/auth/google-login', () => {
    it('valida o ID token com audience igual ao client ID do sistema', async () => {
        global.__GOOGLE_PAYLOAD__ = {
            email: 'mae@familia.test',
            email_verified: true,
            name: 'Mãe',
        };
        const res = await login();
        expect(res.status).toBe(200);
        expect(chamadasVerify).toHaveLength(1);
        const clientId =
            process.env.GOOGLE_CLIENT_ID?.trim() ||
            '372860477730-co8eq29vbsafmffmfm2v2ot5givurar1.apps.googleusercontent.com';
        expect(chamadasVerify[0]).toEqual({ idToken: ID_TOKEN, audience: clientId });
    });

    it('token emitido para outro aplicativo (audience diferente) → 401 sem sessão', async () => {
        global.__GOOGLE_RECUSA__ = true;
        const res = await login();
        expect(res.status).toBe(401);
        expect(res.body.codigo).toBe('CREDENCIAL_GOOGLE_INVALIDA');
        expect(temCookieDeSessao(res)).toBe(false);
    });

    it('access token (não é JWT) → 401, sem consultar o Google', async () => {
        const fetchOriginal = global.fetch;
        global.fetch = jest.fn();
        try {
            const res = await login('ya29.a0AfH6SMB-token-de-acesso');
            expect(res.status).toBe(401);
            expect(global.fetch).not.toHaveBeenCalled();
            expect(chamadasVerify).toHaveLength(0);
        } finally {
            global.fetch = fetchOriginal;
        }
    });

    it('e-mail não verificado pelo Google → 401 e nenhuma conta criada', async () => {
        global.__GOOGLE_PAYLOAD__ = { email: 'nao.verificado@x.test', email_verified: false };
        const res = await login();
        expect(res.status).toBe(401);
        expect(res.body.codigo).toBe('EMAIL_GOOGLE_NAO_VERIFICADO');
        expect(await Usuario.countDocuments({ email: 'nao.verificado@x.test' })).toBe(0);
    });

    it('diretor com ID token válido → 403 (continua só para responsável)', async () => {
        await criarUsuario({ email: 'dir@escola.test', perfil: 'diretor' });
        global.__GOOGLE_PAYLOAD__ = { email: 'dir@escola.test', email_verified: true };
        const res = await login();
        expect(res.status).toBe(403);
        expect(temCookieDeSessao(res)).toBe(false);
    });
});

describe('encerramento das sessões de equipe', () => {
    async function sessaoValida(usuario) {
        const res = await request(app)
            .get('/api/auth/me')
            .set('Cookie', [`escola_jwt=${assinarTokenSessao(usuario)}`]);
        return res.status === 200;
    }

    it('simulação não altera nada', async () => {
        const dir = await criarUsuario({ email: 'd@x.test', perfil: 'diretor', loginGoogle: true });
        const r = await encerrarSessoesDeEquipe({});
        expect(r).toMatchObject({ aplicado: false, total: 1, porPerfil: { diretor: 1 } });
        expect((await Usuario.findById(dir._id).lean()).tokenVersion || 0).toBe(0);
        expect(await sessaoValida(dir)).toBe(true);
    });

    it('aplicado: derruba a sessão da equipe que usou Google e poupa o resto', async () => {
        const dir = await criarUsuario({ email: 'd@x.test', perfil: 'diretor', loginGoogle: true });
        const prof = await criarUsuario({ email: 'p@x.test', perfil: 'professor' });
        const mae = await criarUsuario({
            email: 'm@x.test',
            perfil: 'responsavel',
            loginGoogle: true,
        });

        const r = await encerrarSessoesDeEquipe({ aplicar: true });
        expect(r).toMatchObject({ aplicado: true, alterados: 1 });

        expect(await sessaoValida(dir)).toBe(false);
        expect(await sessaoValida(prof)).toBe(true);
        expect(await sessaoValida(mae)).toBe(true);
        expect(await AuditLog.countDocuments({ acao: 'SESSOES_EQUIPE_ENCERRADAS' })).toBe(1);
    });

    it('com `todas`, alcança toda a equipe ativa, nunca o responsável', async () => {
        await criarUsuario({ email: 'p@x.test', perfil: 'professor' });
        await criarUsuario({ email: 's@x.test', perfil: 'secretaria' });
        const mae = await criarUsuario({ email: 'm@x.test', perfil: 'responsavel' });
        const r = await encerrarSessoesDeEquipe({ aplicar: true, todas: true });
        expect(r.alterados).toBe(2);
        expect(await sessaoValida(mae)).toBe(true);
    });
});
