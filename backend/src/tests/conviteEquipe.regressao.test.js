/**
 * conviteEquipe.regressao.test.js — Issue #386
 *
 * Direção e secretaria nascem de convite de uso único do admin. O que fica
 * provado aqui:
 *   - só o admin convida; o banco guarda o hash, nunca o token;
 *   - o aceite cria a conta com o vínculo da escola e SEM sessão;
 *   - convite reutilizado, expirado, revogado ou de outro e-mail → 403;
 *   - dois aceites simultâneos do mesmo convite criam uma conta só;
 *   - a conta criada entra pelo login com segundo fator.
 */
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const app = require('../app');
const Usuario = require('../models/Usuario');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const Escola = require('../models/Escola');
const AuditLog = require('../models/AuditLog');
const ConviteEquipe = require('../models/ConviteEquipe');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');
const { CONSENTIMENTO_VERSAO } = require('../utils/consentimentoLgpd');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const ACEITE = { aceito: true, versao: CONSENTIMENTO_VERSAO };
let escola;
let admin;

function cookieDe(usuario) {
    return [`escola_jwt=${assinarTokenSessao(usuario)}`];
}

function temCookieDeSessao(res) {
    return (res.headers['set-cookie'] || []).some((c) => c.startsWith('escola_jwt='));
}

async function convidar(email, perfil = 'diretor', quem = admin) {
    const res = await request(app)
        .post('/api/admin/convites-equipe')
        .set('Cookie', cookieDe(quem))
        .send({ email, perfil, escolaId: String(escola._id) });
    const token = res.body?.data?.link?.split('#convite=')[1];
    return { res, token };
}

function aceitar(token, email, extra = {}) {
    return request(app)
        .post('/api/auth/convite-equipe/aceitar')
        .send({
            token,
            email,
            nome: 'Pessoa Convidada',
            telefone: '19999990000',
            senha: SENHA_TESTE,
            consentimentoLgpd: ACEITE,
            ...extra,
        });
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({ nome: 'EMEF Convite', tipo: 'EMEF', ativo: true });
    admin = await criarUsuario({ email: 'admin@rede.test', perfil: 'admin' });
    invalidarCacheEscolas();
});

describe('criação do convite', () => {
    it('admin cria: o link carrega o token no fragmento e o banco guarda só o hash', async () => {
        const { res, token } = await convidar('nova.diretora@escola.test');
        expect(res.status).toBe(201);
        expect(res.body.data.link).toMatch(
            /\/html\/pages\/cadastro-diretor-publico\.html#convite=/
        );
        expect(token.length).toBeGreaterThanOrEqual(43); // 256 bits em base64url

        const salvo = await ConviteEquipe.findOne({}).lean();
        expect(JSON.stringify(salvo)).not.toContain(token);
        expect(salvo.email).toBe('nova.diretora@escola.test');
        expect(salvo.escolaId).toBe(String(escola._id));
        expect(await AuditLog.countDocuments({ acao: 'CONVITE_EQUIPE_CRIADO' })).toBe(1);
    });

    it.each(['diretor', 'secretaria', 'professor', 'responsavel'])(
        '%s não cria convite (403)',
        async (perfil) => {
            const outro = await criarUsuario({ email: `${perfil}@escola.test`, perfil });
            const { res } = await convidar('alguem@escola.test', 'diretor', outro);
            expect(res.status).toBe(403);
            expect(await ConviteEquipe.countDocuments({})).toBe(0);
        }
    );

    it('recusa e-mail que já tem conta (409)', async () => {
        await criarUsuario({ email: 'existente@escola.test', perfil: 'professor' });
        const { res } = await convidar('existente@escola.test');
        expect(res.status).toBe(409);
    });

    it('listagem não expõe hash nem token', async () => {
        await convidar('x@escola.test');
        const res = await request(app)
            .get('/api/admin/convites-equipe')
            .set('Cookie', cookieDe(admin));
        expect(res.status).toBe(200);
        expect(res.body.data[0]).not.toHaveProperty('tokenHash');
        expect(res.body.data[0].situacao).toBe('ativo');
    });
});

describe('aceite do convite', () => {
    it('cria a conta com o vínculo da escola, sem sessão, e registra no AuditLog', async () => {
        const { token } = await convidar('dir@escola.test');
        const res = await aceitar(token, 'dir@escola.test');

        expect(res.status).toBe(201);
        expect(temCookieDeSessao(res)).toBe(false);
        expect(res.body.redirect_to).toBe('/html/login-diretor.html');

        const conta = await Usuario.findOne({ email: 'dir@escola.test' }).lean();
        expect(conta.perfil).toBe('diretor');
        expect(conta.escolaId).toBe(String(escola._id));
        const perfil = await Diretor.findOne({ idUsuario: String(conta._id) }).lean();
        expect(perfil.vinculos).toEqual([
            expect.objectContaining({ escolaId: String(escola._id), cargo: 'diretor' }),
        ]);
        expect((await ConviteEquipe.findOne({}).lean()).usadoEm).toBeInstanceOf(Date);
        expect(await AuditLog.countDocuments({ acao: 'CONVITE_EQUIPE_USADO' })).toBe(1);
    });

    it('convite de secretaria cria o perfil de secretaria vinculado', async () => {
        const { token } = await convidar('sec@escola.test', 'secretaria');
        const res = await aceitar(token, 'sec@escola.test');
        expect(res.status).toBe(201);
        const conta = await Usuario.findOne({ email: 'sec@escola.test' }).lean();
        expect(conta.perfil).toBe('secretaria');
        const perfil = await Secretaria.findOne({ idUsuario: String(conta._id) }).lean();
        expect(perfil.vinculos[0].escolaId).toBe(String(escola._id));
    });

    it('a conta criada entra pelo login com segundo fator', async () => {
        const { token } = await convidar('dir2fa@escola.test');
        await aceitar(token, 'dir2fa@escola.test');
        const login = await request(app)
            .post('/api/auth/login')
            .send({ email: 'dir2fa@escola.test', senha: SENHA_TESTE });
        expect(login.body.requires2FA).toBe(true);
        expect(temCookieDeSessao(login)).toBe(false);
    });

    it('convite reutilizado → 403', async () => {
        const { token } = await convidar('dir@escola.test');
        expect((await aceitar(token, 'dir@escola.test')).status).toBe(201);
        await Usuario.deleteOne({ email: 'dir@escola.test' });
        const segunda = await aceitar(token, 'dir@escola.test');
        expect(segunda.status).toBe(403);
        expect(segunda.body.codigo).toBe('CONVITE_INVALIDO');
    });

    it('convite expirado → 403', async () => {
        const { token } = await convidar('dir@escola.test');
        await ConviteEquipe.updateOne({}, { $set: { expiraEm: new Date(Date.now() - 1000) } });
        expect((await aceitar(token, 'dir@escola.test')).status).toBe(403);
        expect(await Usuario.countDocuments({ email: 'dir@escola.test' })).toBe(0);
    });

    it('convite revogado → 403', async () => {
        const { res, token } = await convidar('dir@escola.test');
        const revogar = await request(app)
            .delete(`/api/admin/convites-equipe/${res.body.data.id}`)
            .set('Cookie', cookieDe(admin));
        expect(revogar.status).toBe(200);
        expect((await aceitar(token, 'dir@escola.test')).status).toBe(403);
        expect(await AuditLog.countDocuments({ acao: 'CONVITE_EQUIPE_REVOGADO' })).toBe(1);
    });

    it('e-mail diferente do convidado → 403 e o convite continua valendo', async () => {
        const { token } = await convidar('dir@escola.test');
        const res = await aceitar(token, 'outra.pessoa@escola.test');
        expect(res.status).toBe(403);
        expect(await Usuario.countDocuments({ email: 'outra.pessoa@escola.test' })).toBe(0);
        expect((await ConviteEquipe.findOne({}).lean()).usadoEm).toBeNull();
        expect((await aceitar(token, 'dir@escola.test')).status).toBe(201);
    });

    it('token inventado → 403 com a mesma resposta', async () => {
        const res = await aceitar('A'.repeat(43), 'dir@escola.test');
        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('CONVITE_INVALIDO');
    });

    it('sem o aceite da política → 400 e o convite não é consumido', async () => {
        const { token } = await convidar('dir@escola.test');
        const res = await aceitar(token, 'dir@escola.test', { consentimentoLgpd: undefined });
        expect(res.status).toBe(400);
        expect((await ConviteEquipe.findOne({}).lean()).usadoEm).toBeNull();
    });

    it('dois aceites simultâneos criam uma conta só', async () => {
        const { token } = await convidar('dir@escola.test');
        const respostas = await Promise.all([
            aceitar(token, 'dir@escola.test'),
            aceitar(token, 'dir@escola.test'),
        ]);
        const criados = respostas.filter((r) => r.status === 201);
        expect(criados).toHaveLength(1);
        expect(await Usuario.countDocuments({ email: 'dir@escola.test' })).toBe(1);
    });

    it('consulta devolve perfil e e-mail mascarado; token inválido → 403', async () => {
        const { token } = await convidar('diretora.nova@escola.test');
        const ok = await request(app).post('/api/auth/convite-equipe/consultar').send({ token });
        expect(ok.status).toBe(200);
        expect(ok.body.data.perfil).toBe('diretor');
        expect(ok.body.data.emailMascarado).not.toBe('diretora.nova@escola.test');
        const ruim = await request(app)
            .post('/api/auth/convite-equipe/consultar')
            .send({ token: 'B'.repeat(43) });
        expect(ruim.status).toBe(403);
    });
});

describe('páginas de aceite', () => {
    const RAIZ = path.resolve(__dirname, '../../..');
    it.each(['diretor', 'secretaria'])(
        'cadastro-%s-publico.html não pede código da escola e usa o script do convite',
        (perfil) => {
            const html = fs.readFileSync(
                path.join(RAIZ, `html/pages/cadastro-${perfil}-publico.html`),
                'utf8'
            );
            expect(html).not.toMatch(/id="codigoEscola"/);
            expect(html).toMatch(/js\/aceitar-convite-equipe\.js/);
            expect(html).toMatch(new RegExp(`data-perfil="${perfil}"`));
        }
    );

    it('o script lê o token do fragmento e o tira da barra de endereço', () => {
        const js = fs.readFileSync(path.join(RAIZ, 'js/aceitar-convite-equipe.js'), 'utf8');
        expect(js).toMatch(/window\.location\.hash/);
        expect(js).toMatch(/history\.replaceState/);
    });
});
