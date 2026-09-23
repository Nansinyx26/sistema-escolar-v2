/**
 * loginPorPortal.test.js — cada conta entra pela porta dela.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * O QUE ESTA SUÍTE PROTEGE
 * ─────────────────────────────────────────────────────────────────────────
 * O Portal do Responsável sempre mandou `portal: 'responsavel'` no corpo do
 * login (`portal-responsavel/src/services/apiService.ts`) e o endpoint nunca
 * olhou para o campo. Uma conta de família que digitasse e-mail e senha na tela
 * do professor recebia sessão completa no domínio da escola — o redirect a
 * devolvia ao portal, mas o COOKIE ficava. O login com Google já recusava o
 * caminho inverso; era o login por senha que não tinha o espelho dessa recusa.
 *
 * Três coisas ficam travadas aqui:
 *
 *   1. a recusa acontece nos DOIS sentidos, e sem emitir cookie;
 *   2. ela vem DEPOIS da senha — quem erra a senha recebe a resposta de senha
 *      errada, nunca a de portal, senão a mensagem vira um oráculo que diz o
 *      perfil de qualquer e-mail;
 *   3. o campo ausente é lido como escola, e não como "qualquer porta serve".
 *
 * A trava do que se ALCANÇA depois de entrar é outra, e tem suíte própria
 * (`matrizAcesso.test.js`): esta aqui cobre só a porta.
 */

const request = require('supertest');

const app = require('../app');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');

beforeAll(async () => {
    await conectarBanco();
});
afterEach(async () => {
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

const postLogin = (body) => request(app).post('/api/auth/login').send(body);

/** O cookie de sessão que o login emite quando aceita a conta. */
const temCookieDeSessao = (res) =>
    (res.headers['set-cookie'] || []).some((c) => c.startsWith('escola_jwt='));

describe('conta de responsável no portal da escola', () => {
    it('é recusada com 403 e o código que leva ao portal certo', async () => {
        await criarUsuario({ email: 'familia@escola.test', perfil: 'responsavel' });

        const res = await postLogin({
            email: 'familia@escola.test',
            senha: SENHA_TESTE,
            portal: 'escola',
        });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.codigo).toBe('CONTA_DE_RESPONSAVEL');
        expect(res.body.portalCorreto).toBe('responsavel');
    });

    it('não recebe cookie de sessão nenhum', async () => {
        await criarUsuario({ email: 'familia2@escola.test', perfil: 'responsavel' });

        const res = await postLogin({
            email: 'familia2@escola.test',
            senha: SENHA_TESTE,
            portal: 'escola',
        });

        expect(temCookieDeSessao(res)).toBe(false);
    });

    // O `portal` ausente é o caso de quem fala direto com a API — e de qualquer
    // cliente antigo. Ler a ausência como "responsável pode entrar" devolveria
    // o buraco inteiro a quem tirasse uma linha do JSON.
    it('sem o campo `portal`, a leitura é escola — e a recusa continua', async () => {
        await criarUsuario({ email: 'familia3@escola.test', perfil: 'responsavel' });

        const res = await postLogin({ email: 'familia3@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('CONTA_DE_RESPONSAVEL');
        expect(temCookieDeSessao(res)).toBe(false);
    });

    it('entra normalmente pelo portal dela', async () => {
        await criarUsuario({ email: 'familia4@escola.test', perfil: 'responsavel' });

        const res = await postLogin({
            email: 'familia4@escola.test',
            senha: SENHA_TESTE,
            portal: 'responsavel',
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.redirect_to).toBe('/portal-responsavel/dist/index.html');
    });
});

describe('conta da equipe escolar no portal do responsável', () => {
    it.each(['professor', 'diretor', 'secretaria', 'admin'])(
        'a conta de %s é recusada com 403',
        async (perfil) => {
            await criarUsuario({ email: `${perfil}@escola.test`, perfil });

            const res = await postLogin({
                email: `${perfil}@escola.test`,
                senha: SENHA_TESTE,
                portal: 'responsavel',
            });

            expect(res.status).toBe(403);
            expect(res.body.codigo).toBe('CONTA_DA_ESCOLA');
            expect(temCookieDeSessao(res)).toBe(false);
        }
    );

    it('o professor entra normalmente pelo portal da escola', async () => {
        await criarUsuario({ email: 'prof-ok@escola.test', perfil: 'professor' });

        const res = await postLogin({
            email: 'prof-ok@escola.test',
            senha: SENHA_TESTE,
            portal: 'escola',
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe('a recusa de portal vem DEPOIS da prova de senha', () => {
    // Se viesse antes, bastaria mandar uma senha qualquer com
    // `portal: 'responsavel'` para descobrir o perfil de qualquer e-mail: um
    // 403 'CONTA_DA_ESCOLA' diria "esta conta existe e é da equipe". Toda a
    // resposta de credencial deste endpoint é unificada justamente para isso
    // não acontecer.
    it('senha errada em conta de responsável devolve credencial inválida, não portal', async () => {
        await criarUsuario({ email: 'familia5@escola.test', perfil: 'responsavel' });

        const res = await postLogin({
            email: 'familia5@escola.test',
            senha: 'SenhaErradaDeProposito1',
            portal: 'escola',
        });

        expect(res.status).toBe(401);
        expect(res.body.codigo).toBe('CREDENCIAL_INVALIDA');
    });

    it('a resposta é idêntica à de um e-mail que nunca existiu', async () => {
        await criarUsuario({ email: 'familia6@escola.test', perfil: 'responsavel' });

        const existente = await postLogin({
            email: 'familia6@escola.test',
            senha: 'SenhaErradaDeProposito1',
            portal: 'escola',
        });
        const inexistente = await postLogin({
            email: 'nunca-existiu@escola.test',
            senha: 'SenhaErradaDeProposito1',
            portal: 'escola',
        });

        expect(existente.status).toBe(inexistente.status);
        expect(existente.body).toEqual(inexistente.body);
    });
});

describe('utils/portalDeLogin — a regra isolada', () => {
    const portal = require('../utils/portalDeLogin');

    it('só o responsável mora no portal da família', () => {
        expect(portal.portalDoPerfil('responsavel')).toBe('responsavel');
        for (const p of ['professor', 'diretor', 'secretaria', 'admin']) {
            expect(portal.portalDoPerfil(p)).toBe('escola');
        }
    });

    it('perfil novo no enum nasce como conta de escola', () => {
        expect(portal.portalDoPerfil('perfil-que-ainda-nao-existe')).toBe('escola');
    });

    it('tolera caixa e espaço, que é como o campo chega de formulário', () => {
        expect(portal.portalDaRequisicao('  RESPONSAVEL ')).toBe('responsavel');
        expect(portal.portalDoPerfil(' Responsavel ')).toBe('responsavel');
    });

    it('`docente` continua sendo a porta da escola — é o nome antigo dela', () => {
        // `AuthenticationService.login(email, senha, portal = 'docente')`.
        // Trocar o nome da porta não pode virar recusa.
        expect(portal.portalDaRequisicao('docente')).toBe('escola');
        expect(portal.portalConfere('professor', 'docente')).toBe(true);
        expect(portal.portalConfere('responsavel', 'docente')).toBe(false);
    });

    it('valor ausente, nulo ou lixo é lido como escola', () => {
        for (const bruto of [undefined, null, '', 'portal-inventado', 42, {}]) {
            expect(portal.portalDaRequisicao(bruto)).toBe('escola');
        }
    });
});
