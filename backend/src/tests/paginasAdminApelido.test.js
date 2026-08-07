/**
 * paginasAdminApelido.test.js
 * Suite — apelido secreto da área administrativa (ADMIN_PATH).
 *
 * A variável é lida na carga do módulo, então precisa estar definida ANTES do
 * require de ../app. Cada arquivo de teste tem seu próprio registro de módulos
 * no Jest, o que mantém esta suite isolada das demais.
 */
const CODIGO = 'f3a91c7d5e4b';
process.env.ADMIN_PATH = CODIGO;

const request = require('supertest');
const app = require('../app');
const {
    conectarBanco, limparBanco, desconectarBanco, criarUsuario,
} = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

const MARCADOR = 'Administrador</option>';
const vazou = (res) => typeof res.text === 'string' && res.text.includes(MARCADOR);

async function sessaoDe(perfil, email) {
    const usuario = await criarUsuario({ email, perfil, nome: `Teste ${perfil}` });
    return [`escola_jwt=${assinarTokenSessao(usuario)}`];
}

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

describe('Apelido secreto: o caminho previsível morre', () => {
    it('anonimo recebe 404 em /html/admin — e nao 302', async () => {
        const res = await request(app).get('/html/admin/usuarios.html');

        // 404 e não o redirect do login: um 302 confirmaria que a área
        // administrativa existe neste servidor.
        expect(res.status).toBe(404);
        expect(vazou(res)).toBe(false);
    });

    it('nem o proprio admin acessa pelo caminho previsivel', async () => {
        const cookies = await sessaoDe('admin', 'admin_apelido@escola.test');

        const res = await request(app).get('/html/admin/usuarios.html').set('Cookie', cookies);

        expect(res.status).toBe(404);
        expect(vazou(res)).toBe(false);
    });

    it('variacoes codificadas do caminho previsivel tambem morrem', async () => {
        for (const url of ['/html/%61dmin/usuarios.html', '/html//admin/usuarios.html']) {
            const res = await request(app).get(url);
            expect(`${url}:${vazou(res)}`).toBe(`${url}:false`);
        }
    });
});

describe('Apelido secreto: a área responde no caminho novo', () => {
    it('admin entra pelo apelido', async () => {
        const cookies = await sessaoDe('admin', 'admin_ok@escola.test');

        const res = await request(app).get(`/html/${CODIGO}/usuarios.html`).set('Cookie', cookies);

        expect(res.status).toBe(200);
        expect(vazou(res)).toBe(true);
    });

    it('o apelido NAO dispensa a autorizacao — anonimo continua barrado', async () => {
        const res = await request(app).get(`/html/${CODIGO}/usuarios.html`);

        // Ofuscação não é autorização: conhecer a URL não basta.
        expect(res.status).toBe(302);
        expect(vazou(res)).toBe(false);
    });

    it('o apelido NAO dispensa a autorizacao — professor recebe 404', async () => {
        const cookies = await sessaoDe('professor', 'prof_apelido@escola.test');

        const res = await request(app).get(`/html/${CODIGO}/auditoria.html`).set('Cookie', cookies);

        expect(res.status).toBe(404);
    });

    it('as excecoes por pagina continuam valendo sob o apelido', async () => {
        const cookies = await sessaoDe('diretor', 'dir_apelido@escola.test');

        const usuarios = await request(app).get(`/html/${CODIGO}/usuarios.html`).set('Cookie', cookies);
        const auditoria = await request(app).get(`/html/${CODIGO}/auditoria.html`).set('Cookie', cookies);

        expect(usuarios.status).toBe(200);   // diretor pode
        expect(auditoria.status).toBe(404);  // admin-only
    });

    it('query string sobrevive a reescrita do caminho', async () => {
        const cookies = await sessaoDe('admin', 'admin_query@escola.test');

        const res = await request(app)
            .get(`/html/${CODIGO}/usuarios.html?filtro=professor&pagina=2`)
            .set('Cookie', cookies);

        expect(res.status).toBe(200);
    });

    it('apelido codificado tambem passa pelo gate, sem vazar', async () => {
        const res = await request(app).get(`/html/${CODIGO}%2Fusuarios.html`);
        expect(vazou(res)).toBe(false);
    });
});

describe('Apelido secreto: escopo', () => {
    it('as outras areas restritas seguem no caminho original', async () => {
        const cookies = await sessaoDe('secretaria', 'sec_apelido@escola.test');

        const res = await request(app).get('/html/secretaria/painel.html').set('Cookie', cookies);

        expect(res.status).toBe(200);
    });

    it('paginas publicas nao sao afetadas', async () => {
        const res = await request(app).get('/html/login.html');
        expect(res.status).toBe(200);
    });

    it('um caminho parecido com o apelido nao abre nada', async () => {
        const res = await request(app).get(`/html/${CODIGO}x/usuarios.html`);
        expect(vazou(res)).toBe(false);
        expect(res.status).not.toBe(200);
    });
});
