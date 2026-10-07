/**
 * esqueciSenhaSemOraculo.test.js — Issue #678
 *
 * O "esqueci minha senha" devolvia a mesma mensagem com ou sem conta, mas só
 * quando a conta existia esperava o provedor de e-mail: o tempo de resposta
 * dizia quais e-mails estão cadastrados. Agora o envio não é aguardado, o
 * caminho sem conta faz o mesmo hash e as duas respostas têm um piso de tempo.
 */
const request = require('supertest');
const app = require('../app');
const RecuperacaoSenha = require('../models/RecuperacaoSenha');
const EmailService = require('../services/EmailService');
const logger = require('../utils/logger');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

let espiaoEnvio;
let espiaoLog;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(() => {
    espiaoLog = jest.spyOn(logger, 'error');
});
afterEach(async () => {
    espiaoEnvio?.mockRestore();
    espiaoLog.mockRestore();
    await limparBanco();
});

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(email) {
    const inicio = Date.now();
    const res = await request(app).post('/api/auth/forgot-password').send({ email });
    return { res, ms: Date.now() - inicio };
}

it('com provedor lento, a resposta não espera o e-mail, e o código já está gravado', async () => {
    espiaoEnvio = jest
        .spyOn(EmailService, 'sendVerificationCode')
        .mockImplementation(() => esperar(3000).then(() => true));
    const conta = await criarUsuario({ email: 'lento.678@escola.test', perfil: 'responsavel' });

    const { res, ms } = await pedir(conta.email);

    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(2000);
    expect(espiaoEnvio).toHaveBeenCalledTimes(1);
    expect(await RecuperacaoSenha.countDocuments({ usuarioId: conta._id, status: 'ativo' })).toBe(
        1
    );
});

it('com e sem conta, mesma resposta e as duas respeitam o tempo mínimo', async () => {
    espiaoEnvio = jest.spyOn(EmailService, 'sendVerificationCode').mockResolvedValue(true);
    const conta = await criarUsuario({ email: 'existe.678@escola.test', perfil: 'responsavel' });

    const comConta = await pedir(conta.email);
    const semConta = await pedir('ninguem.678@escola.test');

    expect(comConta.res.body).toEqual(semConta.res.body);
    expect(comConta.ms).toBeGreaterThanOrEqual(390);
    expect(semConta.ms).toBeGreaterThanOrEqual(390);
});

it('a falha de entrega continua registrada no log', async () => {
    espiaoEnvio = jest.spyOn(EmailService, 'sendVerificationCode').mockResolvedValue(false);
    const conta = await criarUsuario({ email: 'falha.678@escola.test', perfil: 'responsavel' });

    const { res } = await pedir(conta.email);
    await esperar(50);

    expect(res.status).toBe(200);
    const registros = espiaoLog.mock.calls.filter(
        ([, meta]) => meta?.action === 'auth.recuperacao.envioFalhou'
    );
    expect(registros).toHaveLength(1);
    expect(registros[0][1].usuarioId).toBe(String(conta._id));
});

it('erro do provedor não derruba a resposta e também fica no log', async () => {
    espiaoEnvio = jest
        .spyOn(EmailService, 'sendVerificationCode')
        .mockRejectedValue(new Error('provedor fora do ar'));
    const conta = await criarUsuario({ email: 'erro.678@escola.test', perfil: 'responsavel' });

    const { res } = await pedir(conta.email);
    await esperar(50);

    expect(res.status).toBe(200);
    expect(
        espiaoLog.mock.calls.some(([, meta]) => meta?.action === 'auth.recuperacao.envioFalhou')
    ).toBe(true);
});
