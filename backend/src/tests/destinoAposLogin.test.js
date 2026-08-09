/**
 * destinoAposLogin.test.js — o caminho secreto sai da barra de endereço
 *
 * O gate redirecionava para `/html/login.html?next=%2Fhtml%2F<SEGREDO>%2F...`,
 * pondo o prefixo secreto da área administrativa na URL — visível no histórico
 * do navegador e em qualquer print da tela de login. Um segredo cujo motivo de
 * existir é justamente não aparecer.
 *
 * Pior: o `next` não era lido por ninguém no front. Vazava sem entregar nada.
 */
process.env.ADMIN_PATH = 'f3a91c7d5e4b';

const request = require('supertest');
const app = require('../app');
const {
    conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE,
} = require('./helpers');

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); });
afterAll(async () => { await desconectarBanco(); });

describe('Destino pós-login sai da URL', () => {
    it('o redirect do gate NAO carrega o caminho na query', async () => {
        const res = await request(app).get('/html/secretaria/painel.html');

        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/html/login.html');
        expect(res.headers.location).not.toContain('next=');
    });

    it('o PREFIXO SECRETO nunca aparece no redirect', async () => {
        const res = await request(app).get('/html/f3a91c7d5e4b/usuarios.html');

        expect(res.status).toBe(302);
        expect(res.headers.location).not.toContain('f3a91c7d5e4b');
        expect(res.headers.location).toBe('/html/login.html');
    });

    it('o destino guardado leva a pessoa de volta apos o login', async () => {
        // O recurso passou a FUNCIONAR: antes o `next` era ignorado e o login
        // sempre caia no painel padrao.
        const agente = request.agent(app);
        await criarUsuario({ email: 'volta@escola.test', perfil: 'secretaria' });

        await agente.get('/html/secretaria/documentos.html');   // barrado, guarda o destino
        const login = await agente.post('/api/auth/login')
            .send({ email: 'volta@escola.test', senha: SENHA_TESTE });


        // Secretaria passa por 2FA; o destino sobrevive ate o verify.
        expect(login.body.require2FA).toBe(true);
        expect(login.body.redirect_to).toBe('/html/secretaria/documentos.html');
    });

    it('sem destino guardado, cai no painel do perfil', async () => {
        await criarUsuario({ email: 'sem_destino@escola.test', perfil: 'professor' });

        const res = await request(app).post('/api/auth/login')
            .send({ email: 'sem_destino@escola.test', senha: SENHA_TESTE });

        expect(res.body.redirect_to).toBe('/html/dashboard.html');
    });

    it('destino protocol-relative e RECUSADO — nao vira redirect aberto', async () => {
        // O momento seguinte a autenticacao e o de maior confianca do usuario;
        // um `//evil.com` ali levaria para fora do dominio sem ninguem estranhar.
        await criarUsuario({ email: 'aberto@escola.test', perfil: 'professor' });

        const res = await request(app).post('/api/auth/login')
            .set('Cookie', ['destino_pos_login=%2F%2Fevil.com%2Fx'])
            .send({ email: 'aberto@escola.test', senha: SENHA_TESTE });

        expect(res.body.redirect_to.startsWith('//')).toBe(false);
        expect(res.body.redirect_to).toBe('/html/dashboard.html');
    });

    it('o cookie do destino e HttpOnly e de vida curta', async () => {
        const res = await request(app).get('/html/f3a91c7d5e4b/usuarios.html');
        const cookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('destino_pos_login'));

        expect(cookie).toBeTruthy();
        expect(cookie).toContain('HttpOnly');   // o JS da pagina nao le o prefixo
        expect(cookie).toMatch(/Max-Age=6\d\d/); // ~10 minutos, nao permanente
    });

    it('o destino e de USO UNICO — o login seguinte cai no painel padrao', async () => {
        await criarUsuario({ email: 'unico@escola.test', perfil: 'professor' });

        const primeiro = await request(app).post('/api/auth/login')
            .set('Cookie', ['destino_pos_login=%2Fhtml%2Fmeu-horario.html'])
            .send({ email: 'unico@escola.test', senha: SENHA_TESTE });
        expect(primeiro.body.redirect_to).toBe('/html/meu-horario.html');

        // O cookie foi limpo na resposta anterior.
        const limpeza = (primeiro.headers['set-cookie'] || [])
            .find(c => c.startsWith('destino_pos_login'));
        expect(limpeza).toContain('Expires=Thu, 01 Jan 1970');
    });
});
