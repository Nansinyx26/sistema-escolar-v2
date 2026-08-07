/**
 * paginaEntrarAdmin.test.js
 * Suite — tela de login da área administrativa (/html/admin/entrar.html).
 *
 * É a ÚNICA página da área isenta da checagem de perfil, por impasse: exigir
 * sessão para chegar à tela que cria a sessão tornaria a área inacessível. Uma
 * isenção larga demais aqui reabriria justamente o buraco que o gate fechou,
 * então o escopo dela precisa de teste próprio.
 */
const CODIGO = 'b81d3f0a29e7';
process.env.ADMIN_PATH = CODIGO;

const request = require('supertest');
const app = require('../app');
const {
    conectarBanco, limparBanco, desconectarBanco, criarUsuario,
} = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

const MARCADOR_PAINEL = 'Administrador</option>';

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

describe('Tela de login da área', () => {
    it('abre sem sessao no caminho secreto', async () => {
        const res = await request(app).get(`/html/${CODIGO}/entrar.html`);

        expect(res.status).toBe(200);
        expect(res.text).toContain('Acesso restrito');
    });

    it('continua fora do caminho previsivel', async () => {
        // A isenção é da checagem de PERFIL, não do apelido: /html/admin
        // permanece morto para todos.
        const res = await request(app).get('/html/admin/entrar.html');

        expect(res.status).toBe(404);
    });

    it('pede para nao ser indexada', async () => {
        const res = await request(app).get(`/html/${CODIGO}/entrar.html`);

        expect(res.text).toMatch(/name="robots"[^>]*noindex/);
    });

    it('nao embute credencial nem o caminho real da area', async () => {
        const res = await request(app).get(`/html/${CODIGO}/entrar.html`);

        expect(res.text).not.toMatch(/senha\s*[:=]\s*['"][^'"]+['"]/i);
        // Links relativos preservam o prefixo secreto; um caminho absoluto
        // aqui entregaria /html/admin de volta a quem abrisse o fonte.
        expect(res.text).not.toContain('/html/admin');
    });
});

describe('A isenção NÃO vaza para o resto da área', () => {
    const OUTRAS = ['usuarios.html', 'auditoria.html', 'configuracoes.html', 'diagnostico.html'];

    it.each(OUTRAS)('%s continua exigindo sessao', async (pagina) => {
        const res = await request(app).get(`/html/${CODIGO}/${pagina}`);

        expect(res.status).toBe(302);
        expect(res.text).not.toContain(MARCADOR_PAINEL);
    });

    it('professor autenticado segue barrado no painel', async () => {
        const usuario = await criarUsuario({
            email: 'prof_entrar@escola.test', perfil: 'professor', nome: 'Professor',
        });
        const cookies = [`escola_jwt=${assinarTokenSessao(usuario)}`];

        const res = await request(app).get(`/html/${CODIGO}/usuarios.html`).set('Cookie', cookies);

        expect(res.status).toBe(404);
    });

    it('nome parecido nao herda a isencao', async () => {
        // Só o basename exato entra na lista — 'entrar.html.bak' ou
        // 'naoentrar.html' não podem passar por ser parecidos.
        for (const arquivo of ['entrar.html.bak', 'naoentrar.html', 'entrar.htm']) {
            const res = await request(app).get(`/html/${CODIGO}/${arquivo}`);
            expect(`${arquivo}:${res.status}`).toBe(`${arquivo}:302`);
        }
    });
});

describe('Login pela tela da área', () => {
    it('admin autentica e recebe o cookie de sessao', async () => {
        await criarUsuario({ email: 'admin_entrar@escola.test', perfil: 'admin', nome: 'Admin' });
        const { SENHA_TESTE } = require('./helpers');

        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'admin_entrar@escola.test', senha: SENHA_TESTE });

        expect(res.body.success).toBe(true);
        expect((res.headers['set-cookie'] || []).some(c => c.startsWith('escola_jwt'))).toBe(true);

        // E o cookie obtido por essa tela abre o painel sob o apelido.
        const painel = await request(app)
            .get(`/html/${CODIGO}/usuarios.html`)
            .set('Cookie', res.headers['set-cookie']);

        expect(painel.status).toBe(200);
    });
});
