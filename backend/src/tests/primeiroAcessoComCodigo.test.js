/**
 * primeiroAcessoComCodigo.test.js — Issue #659
 *
 * O primeiro acesso gravava a senha informada e abria a sessão só com o e-mail
 * (ou CPF) do professor pré-cadastrado. Agora é em duas etapas: o código vai
 * para o e-mail do PRÉ-CADASTRO, e a senha só é gravada com ele.
 */
const request = require('supertest');
const app = require('../app');
const Usuario = require('../models/Usuario');
const Professor = require('../models/Professor');
const RecuperacaoSenha = require('../models/RecuperacaoSenha');
const EmailService = require('../services/EmailService');
const { conectarBanco, limparBanco, desconectarBanco, SENHA_TESTE_NOVA } = require('./helpers');

const EMAIL = 'pre.659@escola.test';
let espiao;
let enviados;

beforeAll(async () => {
    await conectarBanco();
});
beforeEach(() => {
    enviados = [];
    espiao = jest
        .spyOn(EmailService, 'enviarCodigoPrimeiroAcesso')
        .mockImplementation(async (para, codigo) => {
            enviados.push({ para, codigo });
            return true;
        });
});
afterEach(async () => {
    espiao.mockRestore();
    await limparBanco();
});
afterAll(async () => {
    await desconectarBanco();
});

const preCadastro = (extra = {}) =>
    Professor.create({ nome: 'Prof Pré-Cadastrado', email: EMAIL, ativo: true, ...extra });

const primeiroAcesso = (corpo) => request(app).post('/api/auth/first-access').send(corpo);

const temSessao = (res) =>
    (res.headers['set-cookie'] || []).some((c) => c.startsWith('escola_jwt='));

describe('etapa 1: pedido do código', () => {
    it('sem código não grava senha, não cria conta e não abre sessão', async () => {
        await preCadastro();

        const res = await primeiroAcesso({ emailOrCpf: EMAIL, password: SENHA_TESTE_NOVA });

        expect(res.status).toBe(200);
        expect(res.body.etapa).toBe('codigo');
        expect(res.body.user).toBeUndefined();
        expect(temSessao(res)).toBe(false);
        expect(await Usuario.countDocuments({ email: EMAIL })).toBe(0);
    });

    it('o código vai para o e-mail do pré-cadastro e fica guardado só como hash', async () => {
        await preCadastro();

        await primeiroAcesso({ emailOrCpf: EMAIL.toUpperCase() });

        expect(enviados).toHaveLength(1);
        expect(enviados[0].para).toBe(EMAIL);
        expect(enviados[0].codigo).toMatch(/^\d{6}$/);
        const pedido = await RecuperacaoSenha.findOne({ finalidade: 'primeiro-acesso' }).lean();
        expect(pedido.codigo).not.toContain(enviados[0].codigo);
    });

    it('mesma resposta para pré-cadastro, e-mail desconhecido e conta que já tem senha', async () => {
        await preCadastro();
        await Professor.create({ nome: 'Já Ativo', email: 'ativo.659@escola.test' });
        await Usuario.create({
            nome: 'Já Ativo',
            email: 'ativo.659@escola.test',
            senha: 'hash-qualquer',
            telefone: '(11) 90000-0000',
            perfil: 'professor',
        });

        const respostas = await Promise.all(
            [EMAIL, 'ninguem.659@escola.test', 'ativo.659@escola.test'].map((emailOrCpf) =>
                primeiroAcesso({ emailOrCpf })
            )
        );

        for (const r of respostas) {
            expect(r.status).toBe(200);
            expect(r.body).toEqual(respostas[0].body);
        }
        // Só o pré-cadastro sem conta recebe código.
        expect(enviados.map((e) => e.para)).toEqual([EMAIL]);
    });

    it('e-mail desconhecido não casa com pré-cadastro sem CPF', async () => {
        await preCadastro();

        await primeiroAcesso({ emailOrCpf: 'outra.pessoa@escola.test' });

        expect(enviados).toHaveLength(0);
    });

    it('pré-cadastro inativo não recebe código', async () => {
        await preCadastro({ ativo: false });

        await primeiroAcesso({ emailOrCpf: EMAIL });

        expect(enviados).toHaveLength(0);
    });
});

describe('etapa 2: conclusão com o código', () => {
    async function pedirCodigo() {
        await primeiroAcesso({ emailOrCpf: EMAIL });
        return enviados.at(-1).codigo;
    }

    it('com o código certo grava a senha e abre a sessão de professor', async () => {
        await preCadastro();
        const codigo = await pedirCodigo();

        const res = await primeiroAcesso({ emailOrCpf: EMAIL, codigo, password: SENHA_TESTE_NOVA });

        expect(res.status).toBe(200);
        expect(res.body.user.perfil).toBe('professor');
        expect(res.body.redirect_to).toBe('/html/dashboard.html');
        expect(temSessao(res)).toBe(true);

        // O código é de uso único.
        const deNovo = await primeiroAcesso({
            emailOrCpf: EMAIL,
            codigo,
            password: SENHA_TESTE_NOVA,
        });
        expect(deNovo.status).toBe(400);
    });

    it('com código errado não cria conta nem abre sessão', async () => {
        await preCadastro();
        const codigo = await pedirCodigo();
        const errado = codigo === '123456' ? '654321' : '123456';

        const res = await primeiroAcesso({
            emailOrCpf: EMAIL,
            codigo: errado,
            password: SENHA_TESTE_NOVA,
        });

        expect(res.status).toBe(400);
        expect(temSessao(res)).toBe(false);
        expect(await Usuario.countDocuments({ email: EMAIL })).toBe(0);
    });

    it('5 códigos errados bloqueiam o pedido, mesmo acertando depois', async () => {
        await preCadastro();
        const codigo = await pedirCodigo();
        const errado = codigo === '123456' ? '654321' : '123456';

        for (let i = 0; i < 5; i++) {
            await primeiroAcesso({ emailOrCpf: EMAIL, codigo: errado, password: SENHA_TESTE_NOVA });
        }
        const res = await primeiroAcesso({ emailOrCpf: EMAIL, codigo, password: SENHA_TESTE_NOVA });

        expect(res.status).toBe(400);
        expect(await Usuario.countDocuments({ email: EMAIL })).toBe(0);
    });

    it('o código de primeiro acesso não serve para redefinir senha', async () => {
        const prof = await preCadastro();
        const codigo = await pedirCodigo();
        // Conta com o mesmo _id do pré-cadastro: o pedido só pode valer no fluxo dele.
        await Usuario.create({
            _id: prof._id,
            nome: 'Prof',
            email: EMAIL,
            senha: 'hash-qualquer',
            telefone: '(11) 90000-0000',
            perfil: 'professor',
        });

        const res = await request(app)
            .post('/api/auth/reset-password')
            .send({ email: EMAIL, codigo, password: SENHA_TESTE_NOVA });

        expect(res.status).toBe(400);
    });

    it('conta inativa sem senha não é reativada', async () => {
        await preCadastro();
        await Usuario.create({
            nome: 'Prof',
            email: EMAIL,
            telefone: '(11) 90000-0000',
            perfil: 'professor',
            ativo: false,
        });

        await primeiroAcesso({ emailOrCpf: EMAIL });
        expect(enviados).toHaveLength(0);

        const res = await primeiroAcesso({
            emailOrCpf: EMAIL,
            codigo: '123456',
            password: SENHA_TESTE_NOVA,
        });
        expect(res.status).toBe(400);
        const conta = await Usuario.findOne({ email: EMAIL }).select('+senha').lean();
        expect(conta.ativo).toBe(false);
        expect(conta.senha).toBeFalsy();
    });

    it('dois professores sem CPF ativam a conta sem colidir no índice de CPF', async () => {
        await preCadastro();
        await Professor.create({ nome: 'Outro', email: 'outro.659@escola.test' });

        for (const email of [EMAIL, 'outro.659@escola.test']) {
            await primeiroAcesso({ emailOrCpf: email });
            const { codigo } = enviados.at(-1);
            const res = await primeiroAcesso({
                emailOrCpf: email,
                codigo,
                password: SENHA_TESTE_NOVA,
            });
            expect(res.status).toBe(200);
        }
    });
});
