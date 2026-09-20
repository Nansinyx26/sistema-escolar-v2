/**
 * camposSemFinalidade.regressao.test.js — Issue #408
 *
 * `religiao` e `responsabilidadeFinanceira` saíram do cadastro. Aqui o teste
 * tenta gravá-los pelas duas portas que existiam (secretaria e portal do
 * responsável) e confere que o banco não os guarda — e que a limpeza dos
 * cadastros antigos conta antes de apagar.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const AuditLog = require('../models/AuditLog');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const {
    limparCamposSemFinalidade,
} = require('../services/conformidade/limpezaCamposSemFinalidade');

let escola;
let secretaria;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

/** Grava um cadastro do jeito antigo, por fora do schema. */
async function cadastroLegado(extras = {}) {
    const aluno = await Aluno.create({
        escolaId: String(escola._id),
        nome: 'Criança Fixture',
        turma: '1A',
        responsavel: 'mae@familia.test',
        responsaveis: [{ nome: 'Mãe', email: 'mae@familia.test' }],
        ativo: true,
        ...extras,
    });
    await Aluno.collection.updateOne(
        { _id: aluno._id },
        {
            $set: {
                religiao: 'Alguma',
                'responsaveis.0.responsabilidadeFinanceira': 'Sim',
                responsavelDados: { email: 'mae@familia.test', responsabilidadeFinanceira: 'Sim' },
            },
        }
    );
    return aluno;
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({ nome: 'EMEF Minimiza', tipo: 'EMEF', ativo: true });
    secretaria = await criarUsuario({
        email: 'secretaria@escola.test',
        perfil: 'secretaria',
        escolaId: String(escola._id),
    });
    invalidarCacheEscolas();
});

describe('os campos não entram mais', () => {
    it('POST /api/alunos com religião e responsabilidade financeira grava sem eles', async () => {
        const res = await request(app)
            .post('/api/alunos')
            .set('Cookie', cookieDe(secretaria))
            .send({
                nome: 'Criança Nova',
                turma: '1A',
                etnia: 'Parda',
                religiao: 'Alguma',
                responsavelDados: { email: 'mae@familia.test', responsabilidadeFinanceira: 'Sim' },
                responsaveis: [
                    {
                        nome: 'Mãe',
                        email: 'mae@familia.test',
                        responsabilidadeFinanceira: 'Parcial',
                    },
                ],
            });

        expect(res.status).toBeLessThan(300);
        const gravado = await Aluno.collection.findOne({ nome: 'Criança Nova' });
        expect(gravado).toBeTruthy();
        // caminho feliz: cor/raça continua, porque o Censo pede
        expect(gravado.etnia).toBe('Parda');
        expect(gravado.religiao).toBeUndefined();
        expect(gravado.responsavelDados.responsabilidadeFinanceira).toBeUndefined();
        expect(gravado.responsaveis[0].responsabilidadeFinanceira).toBeUndefined();
        expect(JSON.stringify(res.body)).not.toMatch(/responsabilidadeFinanceira|religiao/);
    });

    it('PUT /api/alunos/:id não regrava os campos em cadastro antigo', async () => {
        const aluno = await cadastroLegado();
        const res = await request(app)
            .put(`/api/alunos/${aluno._id}`)
            .set('Cookie', cookieDe(secretaria))
            .send({
                observacoes: 'texto qualquer',
                religiao: 'Outra',
                responsavelDados: { email: 'mae@familia.test', responsabilidadeFinanceira: 'Não' },
            });

        expect(res.status).toBeLessThan(300);
        const gravado = await Aluno.collection.findOne({ _id: aluno._id });
        expect(gravado.observacoes).toBe('texto qualquer');
        expect(gravado.religiao).toBe('Alguma'); // o antigo só some pela limpeza
        expect(gravado.responsavelDados.responsabilidadeFinanceira).toBeUndefined();
    });

    it('o portal do responsável também não grava responsabilidade financeira', async () => {
        const aluno = await cadastroLegado();
        const mae = await criarUsuario({
            email: 'mae@familia.test',
            perfil: 'responsavel',
            escolaId: String(escola._id),
        });

        const res = await request(app)
            .put(`/api/responsavel/aluno/${aluno._id}/dados`)
            .set('Cookie', cookieDe(mae))
            .send({
                responsaveis: [
                    {
                        nome: 'Mãe',
                        email: 'mae@familia.test',
                        responsabilidadeFinanceira: 'Sim',
                        telefone: '19999990000',
                    },
                ],
            });

        expect(res.status).toBeLessThan(300);
        const gravado = await Aluno.collection.findOne({ _id: aluno._id });
        expect(gravado.responsaveis[0].telefone).toBe('19999990000');
        expect(gravado.responsaveis[0].responsabilidadeFinanceira).toBeUndefined();
    });

    it('GET /api/responsavel/alunos não devolve religião', async () => {
        const aluno = await cadastroLegado();
        const mae = await criarUsuario({
            email: 'mae@familia.test',
            perfil: 'responsavel',
            escolaId: String(escola._id),
        });
        const res = await request(app).get('/api/responsavel/alunos').set('Cookie', cookieDe(mae));

        expect(res.status).toBe(200);
        expect(JSON.stringify(res.body)).not.toMatch(/religiao/);
        expect(String(JSON.stringify(res.body))).toContain(String(aluno._id));
    });
});

describe('limpeza dos cadastros antigos', () => {
    it('simula por padrão: conta e não apaga', async () => {
        const aluno = await cadastroLegado();
        const r = await limparCamposSemFinalidade();

        expect(r.aplicado).toBe(false);
        expect(r.documentos).toBe(1);
        expect(r.porCampo.religiao).toBe(1);
        expect(r.porCampo['responsaveis[].responsabilidadeFinanceira']).toBe(1);
        const gravado = await Aluno.collection.findOne({ _id: aluno._id });
        expect(gravado.religiao).toBe('Alguma');
    });

    it('com aplicar: apaga os três caminhos, registra e é idempotente', async () => {
        const aluno = await cadastroLegado();
        const r = await limparCamposSemFinalidade({ aplicar: true });

        expect(r.aplicado).toBe(true);
        expect(r.limpos).toBe(1);
        const gravado = await Aluno.collection.findOne({ _id: aluno._id });
        expect(gravado.religiao).toBeUndefined();
        expect(gravado.responsaveis[0].responsabilidadeFinanceira).toBeUndefined();
        expect(gravado.responsavelDados.responsabilidadeFinanceira).toBeUndefined();
        expect(gravado.responsaveis[0].nome).toBe('Mãe'); // o resto da ficha fica

        const log = await AuditLog.findOne({ acao: 'CAMPOS_SEM_FINALIDADE_REMOVIDOS' }).lean();
        expect(log).toBeTruthy();
        expect(log.detalhes.valorNovo.documentos).toBe(1);
        expect(JSON.stringify(log)).not.toContain('Criança Fixture');

        const denovo = await limparCamposSemFinalidade({ aplicar: true });
        expect(denovo.documentos).toBe(0);
        expect(denovo.limpos).toBe(0);
    });
});
