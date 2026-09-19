/**
 * escritaProfessorAluno.regressao.test.js — Issue #389
 *
 * O professor escreve só o registro pedagógico e a identificação do aluno da
 * própria turma. Vínculo familiar (responsáveis, guarda, retirada) é da
 * secretaria: com conteúdo vindo do professor, a requisição é recusada e fica
 * no AuditLog. Também cobre a regeneração em lote dos códigos de vínculo.
 */
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const AuditLog = require('../models/AuditLog');
const Professor = require('../models/Professor');
const Secretaria = require('../models/Secretaria');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { regenerarCodigosDeAlunos } = require('../services/regeneracaoCodigosAluno');

let escola;
let aluno;
let prof;

function cookieDe(u) {
    return [`escola_jwt=${assinarTokenSessao(u)}`];
}

async function codigoDe(id) {
    return (await Aluno.findById(id).select('+codigoSecreto').lean()).codigoSecreto;
}

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    escola = await Escola.create({ nome: 'EMEF Escrita', tipo: 'EMEF', ativo: true });
    aluno = await Aluno.create({
        escolaId: String(escola._id),
        nome: 'Criança Fixture',
        turma: '1A',
        cpfAluno: '00000000191',
        responsavel: 'mae@familia.test',
        responsaveis: [{ nome: 'Mãe', email: 'mae@familia.test' }],
        ativo: true,
    });
    prof = await criarUsuario({
        email: 'prof@escola.test',
        perfil: 'professor',
        escolaId: String(escola._id),
    });
    await Professor.create({
        idUsuario: String(prof._id),
        nome: prof.nome,
        email: prof.email,
        salaPrincipal: '1A',
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ativo: true,
    });
    invalidarCacheEscolas();
});

describe('professor não grava vínculo familiar', () => {
    it.each([
        ['responsaveis', [{ nome: 'X', email: 'pessoal.do.professor@gmail.com' }]],
        ['responsavel', 'pessoal.do.professor@gmail.com'],
        ['responsavelDados', { email: 'pessoal.do.professor@gmail.com' }],
        ['guardaLegal', 'Pai'],
        ['pessoasAutorizadasRetirada', [{ nome: 'Estranho', documento: '123' }]],
    ])('PUT com %s → 403, documento intacto e registro no AuditLog', async (campo, valor) => {
        const antes = await Aluno.findById(aluno._id).lean();
        const res = await request(app)
            .put(`/api/alunos/${aluno._id}`)
            .set('Cookie', cookieDe(prof))
            .send({ observacoes: 'junto', [campo]: valor });

        expect(res.status).toBe(403);
        expect(res.body.codigo).toBe('VINCULO_FAMILIAR_SO_SECRETARIA');
        const depois = await Aluno.findById(aluno._id).lean();
        expect(depois.responsaveis).toEqual(antes.responsaveis);
        expect(depois.responsavel).toBe(antes.responsavel);
        expect(depois.observacoes).toBeUndefined();
        const log = await AuditLog.findOne({ acao: 'ALUNO_VINCULO_RECUSADO' }).lean();
        expect(log.recursoId).toBe(String(aluno._id));
    });

    it('e-mail que o professor tentou incluir não ganha acesso ao aluno', async () => {
        await request(app)
            .put(`/api/alunos/${aluno._id}`)
            .set('Cookie', cookieDe(prof))
            .send({ responsaveis: [{ nome: 'X', email: 'pessoal.do.professor@gmail.com' }] });
        const intruso = await criarUsuario({
            email: 'pessoal.do.professor@gmail.com',
            perfil: 'responsavel',
        });
        const lista = await request(app)
            .get('/api/responsavel/alunos')
            .set('Cookie', cookieDe(intruso));
        expect(lista.body.data).toHaveLength(0);
    });

    it('POST com responsável preenchido → 403 e nenhum aluno criado', async () => {
        const res = await request(app)
            .post('/api/alunos')
            .set('Cookie', cookieDe(prof))
            .send({ nome: 'Novo', turma: '1A', responsavel: 'alguem@x.test' });
        expect(res.status).toBe(403);
        expect(await Aluno.countDocuments({ nome: 'Novo' })).toBe(0);
    });

    it('campos vazios de vínculo não contam como tentativa', async () => {
        const res = await request(app)
            .put(`/api/alunos/${aluno._id}`)
            .set('Cookie', cookieDe(prof))
            .send({
                observacoes: 'ok',
                responsaveis: [],
                guardaLegal: '',
                pessoasAutorizadasRetirada: [],
            });
        expect(res.status).toBe(200);
        const depois = await Aluno.findById(aluno._id).lean();
        expect(depois.responsaveis).toHaveLength(1); // o vazio foi ignorado, não gravado
    });

    it('campo pedagógico grava; campo fora da lista é ignorado e informado', async () => {
        const res = await request(app)
            .put(`/api/alunos/${aluno._id}`)
            .set('Cookie', cookieDe(prof))
            .send({ observacoes: 'lê bem', cpfAluno: '99999999999', ativo: false });
        expect(res.status).toBe(200);
        expect(res.body.camposIgnorados).toEqual(expect.arrayContaining(['cpfAluno', 'ativo']));
        const depois = await Aluno.findById(aluno._id).lean();
        expect(depois.observacoes).toBe('lê bem');
        expect(depois.cpfAluno).toBe('00000000191');
        expect(depois.ativo).toBe(true);
    });

    it('secretaria continua alterando responsáveis', async () => {
        const sec = await criarUsuario({
            email: 'sec@escola.test',
            perfil: 'secretaria',
            escolaId: String(escola._id),
        });
        await Secretaria.create({
            idUsuario: String(sec._id),
            nome: sec.nome,
            email: sec.email,
            vinculos: [{ escolaId: String(escola._id), cargo: 'secretaria' }],
        });
        const res = await request(app)
            .put(`/api/alunos/${aluno._id}`)
            .set('Cookie', cookieDe(sec))
            .send({ responsaveis: [{ nome: 'Pai', email: 'pai@familia.test' }] });
        expect(res.status).toBe(200);
        expect((await Aluno.findById(aluno._id).lean()).responsaveis[0].email).toBe(
            'pai@familia.test'
        );
    });
});

describe('regeneração dos códigos de vínculo', () => {
    it('simulação não troca nada', async () => {
        const antes = await codigoDe(aluno._id);
        const r = await regenerarCodigosDeAlunos({});
        expect(r).toMatchObject({ aplicado: false, total: 1 });
        expect(await codigoDe(aluno._id)).toBe(antes);
    });

    it('aplicada: código novo, o antigo deixa de achar o aluno, o vínculo existente continua', async () => {
        const antigo = await codigoDe(aluno._id);
        const r = await regenerarCodigosDeAlunos({ aplicar: true });
        expect(r.trocados).toBe(1);
        const novo = await codigoDe(aluno._id);
        expect(novo).not.toBe(antigo);
        expect(r.lista[0]).toMatchObject({ nome: 'Criança Fixture', codigo: novo });
        expect(await Aluno.countDocuments({ codigoSecreto: antigo })).toBe(0);
        expect(await AuditLog.countDocuments({ acao: 'CODIGOS_ALUNO_REGENERADOS' })).toBe(1);

        const mae = await criarUsuario({ email: 'mae@familia.test', perfil: 'responsavel' });
        const lista = await request(app)
            .get('/api/responsavel/alunos')
            .set('Cookie', cookieDe(mae));
        expect(lista.body.data).toHaveLength(1);
    });

    it('somenteSemVinculo troca só quem ainda não tem responsável', async () => {
        const semVinculo = await Aluno.create({
            escolaId: String(escola._id),
            nome: 'Sem Vínculo',
            turma: '1A',
            ativo: true,
        });
        const vinculadoAntes = await codigoDe(aluno._id);
        const r = await regenerarCodigosDeAlunos({ aplicar: true, somenteSemVinculo: true });
        expect(r.trocados).toBe(1);
        expect(r.lista[0].nome).toBe('Sem Vínculo');
        expect(await codigoDe(aluno._id)).toBe(vinculadoAntes);
        expect(await codigoDe(semVinculo._id)).toBeTruthy();
    });
});
