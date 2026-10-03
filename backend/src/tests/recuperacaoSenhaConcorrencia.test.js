/**
 * recuperacaoSenhaConcorrencia.test.js — Issue #596
 *
 * `verifyRecoveryCode` e `resetPassword` liam o pedido, comparavam o hash e só
 * depois gravavam `tentativas += 1`. Palpites em paralelo liam todos o mesmo
 * contador e passavam todos pelo teto de 5. E o código só virava `utilizado`
 * depois da troca de senha, então duas redefinições simultâneas passavam.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../app');
const RecuperacaoSenha = require('../models/RecuperacaoSenha');
const Usuario = require('../models/Usuario');
const EmailService = require('../services/EmailService');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

const SENHA_NOVA = 'Recuperada2026';
let codigoEnviado = null;
let espiaoEmail;

beforeAll(async () => {
    await conectarBanco();
    espiaoEmail = jest
        .spyOn(EmailService, 'sendVerificationCode')
        .mockImplementation(async (_para, codigo) => {
            codigoEnviado = codigo;
            return true;
        });
});
afterEach(async () => {
    await limparBanco();
    codigoEnviado = null;
});
afterAll(async () => {
    espiaoEmail.mockRestore();
    await desconectarBanco();
});

/** Conta com um código de recuperação recém-pedido; devolve e-mail e código. */
async function pedirCodigo() {
    const conta = await criarUsuario({ perfil: 'responsavel' });
    await request(app).post('/api/auth/forgot-password').send({ email: conta.email });
    expect(codigoEnviado).toMatch(/^\d{6}$/);
    return { conta, email: conta.email, codigo: codigoEnviado };
}

/** Um palpite certamente errado (o código real tem 6 dígitos de 100000 a 999998). */
const errado = (codigo) => (codigo === '000000' ? '000001' : '000000');

const verificar = (corpo) => request(app).post('/api/auth/verify-recovery-code').send(corpo);
const redefinir = (corpo) => request(app).post('/api/auth/reset-password').send(corpo);

describe('teto de tentativas sob concorrência (Issue #596)', () => {
    it('10 palpites errados em paralelo comparam no máximo 5 vezes e o código expira', async () => {
        const { conta, email, codigo } = await pedirCodigo();

        const respostas = await Promise.all(
            Array.from({ length: 10 }, () => verificar({ email, codigo: errado(codigo) }))
        );

        expect(respostas.every((r) => r.status === 400)).toBe(true);
        // "Código inválido." é a resposta de quem chegou a comparar e errou
        // com tentativa sobrando: no máximo 4 (a 5ª errada já bloqueia).
        const compararam = respostas.filter((r) => r.body.error === 'Código inválido.');
        expect(compararam.length).toBeLessThanOrEqual(4);

        const pedido = await RecuperacaoSenha.findOne({ usuarioId: conta._id }).lean();
        expect(pedido.status).toBe('expirado');
        expect(pedido.tentativas).toBeLessThanOrEqual(5);

        // O código certo não vale mais.
        const depois = await verificar({ email, codigo });
        expect(depois.status).toBe(400);
    });

    it('duas redefinições simultâneas com o código certo: só uma passa', async () => {
        const { email, codigo } = await pedirCodigo();

        const [a, b] = await Promise.all([
            redefinir({ email, codigo, password: SENHA_NOVA }),
            redefinir({ email, codigo, password: `${SENHA_NOVA}x` }),
        ]);

        expect([a.status, b.status].sort()).toEqual([200, 400]);
        expect(await RecuperacaoSenha.countDocuments({ status: 'utilizado' })).toBe(1);
    });
});

describe('quem tem o código não paga por acertar', () => {
    it('4 erros, verificação certa e redefinição seguem funcionando', async () => {
        const { email, codigo } = await pedirCodigo();
        for (let i = 0; i < 4; i++) {
            const r = await verificar({ email, codigo: errado(codigo) });
            expect(r.body.error).toBe('Código inválido.');
        }

        expect((await verificar({ email, codigo })).status).toBe(200);
        const reset = await redefinir({ email, codigo, password: SENHA_NOVA });
        expect(reset.status).toBe(200);

        const { senha } = await Usuario.findOne({ email }).select('+senha').lean();
        expect(await bcrypt.compare(SENHA_NOVA, senha)).toBe(true);
    });

    it('a 5ª errada bloqueia, e o código certo não salva mais', async () => {
        const { email, codigo } = await pedirCodigo();
        for (let i = 0; i < 4; i++) await verificar({ email, codigo: errado(codigo) });

        const quinta = await verificar({ email, codigo: errado(codigo) });
        expect(quinta.body.error).toMatch(/bloqueado/i);

        const certo = await redefinir({ email, codigo, password: SENHA_NOVA });
        expect(certo.status).toBe(400);
    });
});
