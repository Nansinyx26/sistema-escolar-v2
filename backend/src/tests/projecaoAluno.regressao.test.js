/**
 * projecaoAluno.regressao.test.js — Issue #388
 *
 * Cada perfil recebe do cadastro do aluno só os campos da sua função. A trava
 * central: uma varredura recursiva das respostas dadas ao PROFESSOR que falha
 * se encontrar qualquer chave fora do que a função dele exige.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Falta = require('../models/Falta');
const Professor = require('../models/Professor');
const Diretor = require('../models/Diretor');
const Secretaria = require('../models/Secretaria');
const {
    conectarBanco,
    limparBanco,
    desconectarBanco,
    criarUsuario,
    SENHA_TESTE,
} = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

// Nada disto pode chegar ao professor, em nenhum nível do JSON.
const PROIBIDAS_AO_PROFESSOR = [
    'codigoSecreto',
    'cpfAluno',
    'cpf',
    'endereco',
    'religiao',
    'etnia',
    'planoSaude',
    'guardaLegal',
    'telefone',
    'email',
    'nascimento',
    'responsavel',
    'responsavelDados',
    'responsaveis',
    'pessoasAutorizadasRetirada',
    'autorizacoesEscolares',
    'documentos',
    'lgpdConsentimento',
    'deficiencia',
    'transtornos',
    'codigoInep',
];

function chavesProibidas(valor, proibidas, caminho = '', achados = []) {
    if (Array.isArray(valor)) {
        valor.forEach((v, i) => {
            chavesProibidas(v, proibidas, `${caminho}[${i}]`, achados);
        });
    } else if (valor && typeof valor === 'object') {
        for (const [k, v] of Object.entries(valor)) {
            if (proibidas.includes(k)) achados.push(`${caminho}.${k}`);
            chavesProibidas(v, proibidas, `${caminho}.${k}`, achados);
        }
    }
    return achados;
}

let escola;
let aluno;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

async function professor() {
    const u = await criarUsuario({
        email: `prof${Math.random()}@escola.test`,
        perfil: 'professor',
        escolaId: String(escola._id),
    });
    await Professor.create({
        idUsuario: String(u._id),
        nome: u.nome,
        email: u.email,
        salaPrincipal: '1A',
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ativo: true,
    });
    return u;
}

async function gestao(perfil) {
    const u = await criarUsuario({
        email: `${perfil}${Math.random()}@escola.test`,
        perfil,
        escolaId: String(escola._id),
    });
    const Model = perfil === 'diretor' ? Diretor : Secretaria;
    await Model.create({
        idUsuario: String(u._id),
        nome: u.nome,
        email: u.email,
        vinculos: [{ escolaId: String(escola._id), cargo: perfil }],
    });
    return u;
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    delete process.env.PROFESSOR_VE_DETALHE_DEFICIENCIA;
    delete process.env.PROFESSOR_VE_RETIRADA;
    escola = await Escola.create({ nome: 'EMEF Projeção', tipo: 'EMEF', ativo: true });
    aluno = await Aluno.create({
        escolaId: String(escola._id),
        nome: 'Criança Fixture',
        turma: '1A',
        matricula: 'RA-1',
        cpfAluno: '00000000191',
        religiao: 'Fixture',
        etnia: 'Parda',
        nascimento: new Date('2017-03-01'),
        telefone: '19999990000',
        email: 'crianca@fixture.test',
        endereco: { rua: 'Rua Fixture, 1' },
        planoSaude: 'Plano Fixture',
        alergiasRemedio: 'Dipirona',
        deficiencia: 'TEA',
        responsavel: 'mae@familia.test',
        responsaveis: [{ nome: 'Mãe', email: 'mae@familia.test', cpf: '00000000272' }],
        pessoasAutorizadasRetirada: [{ nome: 'Avó', parentesco: 'Avó', documento: 'RG-123' }],
        guardaLegal: 'Mãe',
        ativo: true,
    });
    invalidarCacheEscolas();
});

describe('professor recebe só os campos da função', () => {
    it('lista, leitura, criação, edição e chamada: nenhuma chave proibida', async () => {
        const prof = await professor();
        const c = cookieDe(prof);
        await Falta.create({
            escolaId: String(escola._id),
            aluno: String(aluno._id),
            turma: '1A',
            data: new Date(),
            presente: false,
        });

        const respostas = {
            lista: await request(app).get('/api/alunos?turma=1A').set('Cookie', c),
            leitura: await request(app).get(`/api/alunos/${aluno._id}`).set('Cookie', c),
            edicao: await request(app)
                .put(`/api/alunos/${aluno._id}`)
                .set('Cookie', c)
                .send({ observacoes: 'lê bem' }),
            criacao: await request(app)
                .post('/api/alunos')
                .set('Cookie', c)
                .send({ nome: 'Novo Aluno', turma: '1A', observacoes: 'x' }),
            chamada: await request(app).get('/api/faltas').set('Cookie', c),
        };

        for (const [rota, res] of Object.entries(respostas)) {
            expect({ rota, status: res.status }).toEqual({
                rota,
                status: rota === 'criacao' ? 201 : 200,
            });
            expect({ rota, achados: chavesProibidas(res.body, PROIBIDAS_AO_PROFESSOR) }).toEqual({
                rota,
                achados: [],
            });
        }

        const ficha = respostas.leitura.body.data;
        expect(ficha.nome).toBe('Criança Fixture');
        expect(ficha.alergiasRemedio).toBe('Dipirona');
        expect(ficha.necessitaApoio).toBe(true);
        expect(respostas.chamada.body.data[0].aluno.nome).toBe('Criança Fixture');
    });

    it('PROFESSOR_VE_DETALHE_DEFICIENCIA=sim libera deficiência e transtornos', async () => {
        process.env.PROFESSOR_VE_DETALHE_DEFICIENCIA = 'sim';
        const prof = await professor();
        const res = await request(app)
            .get(`/api/alunos/${aluno._id}`)
            .set('Cookie', cookieDe(prof));
        expect(res.body.data.deficiencia).toBe('TEA');
        expect(res.body.data.cpfAluno).toBeUndefined();
    });

    it('PROFESSOR_VE_RETIRADA=nome libera nome e parentesco, nunca o documento', async () => {
        process.env.PROFESSOR_VE_RETIRADA = 'nome';
        const prof = await professor();
        const res = await request(app)
            .get(`/api/alunos/${aluno._id}`)
            .set('Cookie', cookieDe(prof));
        expect(res.body.data.pessoasAutorizadasRetirada).toEqual([
            { nome: 'Avó', parentesco: 'Avó' },
        ]);
    });
});

describe('gestão e responsável', () => {
    it.each(['secretaria', 'diretor'])(
        '%s recebe a ficha completa, sem o código de vínculo',
        async (perfil) => {
            const u = await gestao(perfil);
            const res = await request(app)
                .get(`/api/alunos/${aluno._id}`)
                .set('Cookie', cookieDe(u));
            expect(res.status).toBe(200);
            expect(res.body.data.cpfAluno).toBe('00000000191');
            expect(res.body.data.responsaveis).toHaveLength(1);
            expect(chavesProibidas(res.body, ['codigoSecreto'])).toEqual([]);
        }
    );

    it('a rota de códigos da secretaria continua exibindo o código', async () => {
        const u = await gestao('secretaria');
        const res = await request(app)
            .get('/api/alunos/codigos-secretos')
            .set('Cookie', cookieDe(u));
        expect(res.status).toBe(200);
        expect(res.body.data[0].codigoSecreto).toMatch(/^[A-Z0-9]{10}$/);
    });

    it('responsável recebe a ficha do próprio filho, sem o código de vínculo', async () => {
        const mae = await criarUsuario({ email: 'mae@familia.test', perfil: 'responsavel' });
        const res = await request(app).get('/api/responsavel/alunos').set('Cookie', cookieDe(mae));
        expect(res.status).toBe(200);
        expect(res.body.data[0].cpfAluno).toBe('00000000191');
        expect(chavesProibidas(res.body, ['codigoSecreto'])).toEqual([]);
    });
});

describe('código de vínculo', () => {
    it('não muda quando outro fluxo salva o aluno', async () => {
        const antes = (await Aluno.findById(aluno._id).select('+codigoSecreto').lean())
            .codigoSecreto;
        const doc = await Aluno.findById(aluno._id); // carregado sem o campo
        doc.observacoes = 'outra rota salvou';
        await doc.save();
        const depois = (await Aluno.findById(aluno._id).select('+codigoSecreto').lean())
            .codigoSecreto;
        expect(depois).toBe(antes);
    });

    it('continua funcionando no cadastro do responsável', async () => {
        const semVinculo = await Aluno.create({
            escolaId: String(escola._id),
            nome: 'Sem Vínculo',
            turma: '1A',
            ativo: true,
        });
        const { codigoSecreto } = await Aluno.findById(semVinculo._id)
            .select('+codigoSecreto')
            .lean();
        const { CONSENTIMENTO_VERSAO } = require('../utils/consentimentoLgpd');
        const res = await request(app)
            .post('/api/auth/register-responsavel')
            .send({
                nome: 'Pai Fixture',
                email: 'pai@familia.test',
                senha: SENHA_TESTE,
                telefone: '19999990001',
                codigoSecreto,
                consentimentoLgpd: { aceito: true, versao: CONSENTIMENTO_VERSAO },
            });
        expect(res.status).toBe(201);
    });
});

describe('resposta do login', () => {
    it('não devolve CPF nem telefone', async () => {
        await criarUsuario({
            email: 'prof.login@escola.test',
            perfil: 'professor',
            cpf: '00000000353',
        });
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'prof.login@escola.test', senha: SENHA_TESTE });
        expect(res.status).toBe(200);
        expect(res.body.user).not.toHaveProperty('cpf');
        expect(res.body.user).not.toHaveProperty('telefone');
    });
});
