/**
 * politica2FA.test.js — dispensa do segundo fator por perfil
 *
 * `DISPENSAR_2FA_EMAIL` enfraquece a autenticação de propósito, a pedido da
 * operação, enquanto o provedor de e-mail está bloqueado. Justamente por ser um
 * enfraquecimento deliberado, o ESCOPO dele precisa ser exato: dispensar um
 * perfil não pode, por descuido, dispensar outro — nem deixar a exigência
 * ligada quando deveria ter saído.
 *
 * A variável é lida a cada chamada (não em cache de módulo), então dá para
 * alterná-la dentro do teste.
 */
const request = require('supertest');
const app = require('../app');
const {
    conectarBanco, limparBanco, desconectarBanco, criarUsuario, SENHA_TESTE,
} = require('./helpers');
const Usuario = require('../models/Usuario');
const politica = require('../utils/politica2FA');

const postLogin = (body) => request(app).post('/api/auth/login').send(body);

const ORIGINAL = process.env.DISPENSAR_2FA_EMAIL;

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => {
    await limparBanco();
    if (ORIGINAL === undefined) delete process.env.DISPENSAR_2FA_EMAIL;
    else process.env.DISPENSAR_2FA_EMAIL = ORIGINAL;
});
afterAll(async () => { await desconectarBanco(); });

describe('Unidade: exigeSegundoFator', () => {
    it('sem a variavel, diretor e secretaria seguem exigindo 2FA', () => {
        delete process.env.DISPENSAR_2FA_EMAIL;
        expect(politica.exigeSegundoFator({ perfil: 'diretor' })).toBe(true);
        expect(politica.exigeSegundoFator({ perfil: 'secretaria' })).toBe(true);
        expect(politica.exigeSegundoFator({ perfil: 'professor' })).toBe(false);
    });

    it('a dispensa vale SO para os perfis listados', () => {
        process.env.DISPENSAR_2FA_EMAIL = 'diretor';
        expect(politica.exigeSegundoFator({ perfil: 'diretor' })).toBe(false);
        // secretaria NAO foi listada — continua exigindo.
        expect(politica.exigeSegundoFator({ perfil: 'secretaria' })).toBe(true);
    });

    it('admin com 2FA ligado NAO e afetado por dispensar diretor/secretaria', () => {
        // O risco real de um interruptor amplo: derrubar o segundo fator de uma
        // conta que ninguem pediu para derrubar.
        process.env.DISPENSAR_2FA_EMAIL = 'diretor,secretaria';
        expect(politica.exigeSegundoFator({ perfil: 'admin', twoFactorEnabled: true })).toBe(true);
    });

    it('a dispensa vence o twoFactorEnabled do banco', () => {
        // Deliberado: meia dispensa (perfil sim, conta nao) deixaria uma conta
        // trancada sem nada na tela explicando por que.
        process.env.DISPENSAR_2FA_EMAIL = 'secretaria';
        expect(politica.exigeSegundoFator({ perfil: 'secretaria', twoFactorEnabled: true })).toBe(false);
    });

    it('tolera espaco e caixa na variavel', () => {
        process.env.DISPENSAR_2FA_EMAIL = ' Diretor , SECRETARIA ';
        expect(politica.exigeSegundoFator({ perfil: 'diretor' })).toBe(false);
        expect(politica.exigeSegundoFator({ perfil: 'secretaria' })).toBe(false);
    });

    it('variavel vazia ou lixo nao dispensa ninguem', () => {
        for (const valor of ['', '   ', ',,,']) {
            process.env.DISPENSAR_2FA_EMAIL = valor;
            expect(politica.exigeSegundoFator({ perfil: 'diretor' })).toBe(true);
        }
    });

    it('o boot avisa quando ha dispensa, e cala quando nao ha', () => {
        delete process.env.DISPENSAR_2FA_EMAIL;
        expect(politica.avisoDeBoot()).toBeNull();

        process.env.DISPENSAR_2FA_EMAIL = 'diretor,secretaria';
        expect(politica.avisoDeBoot()).toContain('diretor, secretaria');
    });
});

describe('Login com a dispensa ativa', () => {
    it('diretor entra direto, com cookie de sessao e sem pedir codigo', async () => {
        process.env.DISPENSAR_2FA_EMAIL = 'diretor,secretaria';
        await criarUsuario({ email: 'dir_disp@escola.test', perfil: 'diretor' });

        const res = await postLogin({ email: 'dir_disp@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(200);
        expect(res.body.requires2FA).toBe(false);
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some((c) => c.startsWith('escola_jwt'))).toBe(true);
        // Sem etapa intermediaria: o pre-auth nao chega a ser emitido.
        expect(cookies.some((c) => c.startsWith('escola_preauth'))).toBe(false);
    });

    it('secretaria com twoFactorEnabled no banco tambem entra direto', async () => {
        // Cenario real: scripts antigos gravaram twoFactorEnabled=true em
        // contas de secretaria. Sem a dispensa vencer esse campo, a variavel
        // pareceria nao funcionar.
        process.env.DISPENSAR_2FA_EMAIL = 'diretor,secretaria';
        const sec = await criarUsuario({ email: 'sec_disp@escola.test', perfil: 'secretaria' });
        await Usuario.findByIdAndUpdate(sec._id, { twoFactorEnabled: true });

        const res = await postLogin({ email: 'sec_disp@escola.test', senha: SENHA_TESTE });

        expect(res.status).toBe(200);
        expect(res.body.requires2FA).toBe(false);
    });

    it('a SENHA continua obrigatoria — dispensa nao e porta aberta', async () => {
        process.env.DISPENSAR_2FA_EMAIL = 'diretor,secretaria';
        await criarUsuario({ email: 'dir_senha@escola.test', perfil: 'diretor' });

        const res = await postLogin({ email: 'dir_senha@escola.test', senha: 'ErradaDeProposito1' });

        expect(res.status).toBe(401);
        expect(res.body.codigo).toBe('CREDENCIAL_INVALIDA');
    });

    it('perfil NAO listado continua no fluxo de 2FA', async () => {
        process.env.DISPENSAR_2FA_EMAIL = 'diretor';
        await criarUsuario({ email: 'sec_naodisp@escola.test', perfil: 'secretaria' });

        const res = await postLogin({ email: 'sec_naodisp@escola.test', senha: SENHA_TESTE });

        expect(res.body.require2FA).toBe(true);
        const cookies = res.headers['set-cookie'] || [];
        expect(cookies.some((c) => c.startsWith('escola_jwt'))).toBe(false);
    });

    it('apagar a variavel restaura o 2FA, sem mudar codigo', async () => {
        await criarUsuario({ email: 'dir_volta@escola.test', perfil: 'diretor' });

        process.env.DISPENSAR_2FA_EMAIL = 'diretor';
        const dispensado = await postLogin({ email: 'dir_volta@escola.test', senha: SENHA_TESTE });
        expect(dispensado.body.requires2FA).toBe(false);

        delete process.env.DISPENSAR_2FA_EMAIL;
        const restaurado = await postLogin({ email: 'dir_volta@escola.test', senha: SENHA_TESTE });
        expect(restaurado.body.require2FA).toBe(true);
    });
});
