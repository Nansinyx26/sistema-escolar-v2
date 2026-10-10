/**
 * codigoAlunoSoPrimeiroVinculo.test.js — Issue #756
 *
 * O código secreto do aluno continua valendo depois do vínculo. O cadastro
 * por código só recusava quando `responsavel` era um e-mail, e a secretaria
 * grava ali o NOME (o e-mail vai para `responsaveis[]`): uma conta nova se
 * ligava à ficha sem a secretaria, inclusive o pai bloqueado pela Justiça com
 * um e-mail novo. O `vincular` deixava passar a ficha com o e-mail só em
 * `responsaveis[]` e não conferia o bloqueio judicial.
 */
jest.mock('../services/EnvioEmail', () => ({
    ...jest.requireActual('../services/EnvioEmail'),
    enviarEmail: jest.fn().mockResolvedValue({ ok: true }),
}));

const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const { CONSENTIMENTO_VERSAO } = require('../utils/consentimentoLgpd');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { SENHA_TESTE } = require('./helpers');

const CODIGO = 'ABCDEFGH23';
const cookieDe = (conta) => [`escola_jwt=${assinarTokenSessao(conta)}`];
let escolaId;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    escolaId = String((await Escola.create({ nome: 'EMEF 756', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();
});

/** Ficha como a secretaria deixa: nome em `responsavel`, e-mail na lista. */
function fichaDaSecretaria(extra = {}) {
    return Aluno.create({
        escolaId,
        nome: 'Criança',
        turma: '3A',
        ativo: true,
        codigoSecreto: CODIGO,
        responsavel: 'Maria Mãe',
        responsaveis: [{ nome: 'Maria Mãe', email: 'mae.756@familia.test' }],
        restricoesAcesso: [{ email: 'pai.756@familia.test', motivo: 'decisao_judicial' }],
        ...extra,
    });
}

const cadastrar = (email) =>
    request(app)
        .post('/api/auth/register-responsavel')
        .send({
            nome: 'Pessoa',
            email,
            senha: SENHA_TESTE,
            telefone: '(11) 98765-4321',
            codigoSecreto: CODIGO,
            consentimentoLgpd: { aceito: true, versao: CONSENTIMENTO_VERSAO },
        });

describe('register-responsavel pelo código', () => {
    it('ficha com responsável (nome da secretaria) recusa conta nova com outro e-mail', async () => {
        const aluno = await fichaDaSecretaria();

        const res = await cadastrar('pai.novo.756@outro.test');

        expect(res.status).toBe(400);
        expect((await Aluno.findById(aluno._id).lean()).responsavel).toBe('Maria Mãe');
    });

    it('a mãe que já está na ficha cria a conta, e o nome da ficha fica', async () => {
        const aluno = await fichaDaSecretaria();

        const res = await cadastrar('mae.756@familia.test');

        expect(res.status).toBe(201);
        expect((await Aluno.findById(aluno._id).lean()).responsavel).toBe('Maria Mãe');
    });

    it('ficha vazia: o primeiro cadastro vincula (controle)', async () => {
        const aluno = await fichaDaSecretaria({
            responsavel: undefined,
            responsaveis: [],
            restricoesAcesso: [],
        });

        const res = await cadastrar('primeira.756@familia.test');

        expect(res.status).toBe(201);
        expect((await Aluno.findById(aluno._id).lean()).responsavel).toBe(
            'primeira.756@familia.test'
        );
    });

    it('código de aluno inativo é recusado', async () => {
        await fichaDaSecretaria({
            ativo: false,
            responsavel: undefined,
            responsaveis: [],
            restricoesAcesso: [],
        });

        const res = await cadastrar('alguem.756@familia.test');

        expect(res.status).toBe(400);
    });
});

describe('POST /api/responsavel/vincular', () => {
    const vincular = (conta) =>
        request(app)
            .post('/api/responsavel/vincular')
            .set('Cookie', cookieDe(conta))
            .send({ codigoSecreto: CODIGO });

    it('conta fora da ficha não se liga a ficha que tem e-mail só em responsaveis[]', async () => {
        const aluno = await fichaDaSecretaria({ responsavel: undefined });
        const estranho = await criarUsuario({
            perfil: 'responsavel',
            email: 'estranho.756@x.test',
        });

        const res = await vincular(estranho);

        expect(res.status).toBe(409);
        expect((await Aluno.findById(aluno._id).lean()).responsavel).toBeUndefined();
    });

    it('e-mail com bloqueio judicial não se liga, nem em ficha sem responsável', async () => {
        await fichaDaSecretaria({ responsavel: undefined, responsaveis: [] });
        const pai = await criarUsuario({ perfil: 'responsavel', email: 'pai.756@familia.test' });

        const res = await vincular(pai);

        expect(res.status).toBe(409);
    });

    it('quem já está na ficha refaz o vínculo sem mudar a ficha (controle)', async () => {
        const aluno = await fichaDaSecretaria();
        const mae = await criarUsuario({ perfil: 'responsavel', email: 'mae.756@familia.test' });

        const res = await vincular(mae);

        expect(res.status).toBe(200);
        expect((await Aluno.findById(aluno._id).lean()).responsavel).toBe('Maria Mãe');
    });
});
