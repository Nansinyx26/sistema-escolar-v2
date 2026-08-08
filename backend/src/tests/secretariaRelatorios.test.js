/**
 * secretariaRelatorios.test.js
 * ============================================================================
 * Suite dos relatórios da secretaria — a página que ficava presa no spinner.
 *
 * O travamento em si era do front (nenhum `finally`, nenhum timeout), mas o
 * backend contribuía com dois problemas de carga: um N+1 no relatório por turma
 * e uma consulta de matrículas sem teto nenhum.
 *
 * A correção do N+1 trocou "uma consulta por turma, com `$or` de três campos"
 * por "uma consulta só, agrupada em memória". Isso é uma mudança de LÓGICA, não
 * só de performance — estes testes fixam a equivalência: o vínculo aluno→turma
 * é gravado de três formas diferentes no histórico da base, e as três precisam
 * continuar casando, sem contar ninguém duas vezes.
 */
const request = require('supertest');
const app = require('../app');
const {
    conectarBanco, limparBanco, desconectarBanco, criarUsuario,
} = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

const Turma = require('../models/Turma');
const Aluno = require('../models/Aluno');
const Matricula = require('../models/Matricula');
const Escola = require('../models/Escola');
const Secretaria = require('../models/Secretaria');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');

const ESCOLA = 'escola-relatorios-teste';

async function sessaoSecretaria() {
    const usuario = await criarUsuario({
        email: `sec_rel_${Date.now()}@escola.test`,
        perfil: 'secretaria',
        escolaId: ESCOLA,
    });
    return [`escola_jwt=${assinarTokenSessao(usuario)}`];
}

/**
 * Monta o cenário multi-escola completo: uma Escola ativa e uma secretaria com
 * vínculo nela. Só assim o `filtrarPorEscola` resolve `req.escolaId` e o escopo
 * por tenant passa a valer.
 */
async function sessaoComEscola() {
    const escola = await Escola.create({ nome: `Escola Rel ${Date.now()}`, tipo: 'EMEF', ativo: true });
    const escolaId = String(escola._id);

    const usuario = await criarUsuario({
        email: `sec_esc_${Date.now()}@escola.test`, perfil: 'secretaria', escolaId,
    });
    await Secretaria.create({
        idUsuario: String(usuario._id), nome: usuario.nome, email: usuario.email,
        vinculos: [{ escolaId, cargo: 'secretaria' }],
    });

    // O estado de escolas é cacheado por 60s no middleware; sem invalidar, a
    // suite herdaria a contagem "zero escolas" de um teste anterior.
    invalidarCacheEscolas();

    return { escolaId, cookies: [`escola_jwt=${assinarTokenSessao(usuario)}`] };
}

const pedirTurmas = (cookies) =>
    request(app).get('/api/secretaria/relatorios/alunos-por-turma').set('Cookie', cookies);

beforeAll(async () => { await conectarBanco(); });
afterEach(async () => { await limparBanco(); invalidarCacheEscolas(); });
afterAll(async () => { await desconectarBanco(); });

describe('Relatório de alunos por turma', () => {
    it('agrupa alunos vinculados pelo NOME da turma', async () => {
        const cookies = await sessaoSecretaria();
        await Turma.create({ _id: 't1', nome: '5A', escolaId: ESCOLA, ativo: true });
        await Aluno.create({ nome: 'Ana', turma: '5A', escolaId: ESCOLA, ativo: true });
        await Aluno.create({ nome: 'Bruno', turma: '5A', escolaId: ESCOLA, ativo: true });

        const res = await pedirTurmas(cookies);

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].totalAlunos).toBe(2);
    });

    it('agrupa alunos vinculados pelo turmaId', async () => {
        const cookies = await sessaoSecretaria();
        await Turma.create({ _id: 't2', nome: '6B', escolaId: ESCOLA, ativo: true });
        await Aluno.create({ nome: 'Carla', turmaId: 't2', escolaId: ESCOLA, ativo: true });

        const res = await pedirTurmas(cookies);

        expect(res.body.data[0].totalAlunos).toBe(1);
        expect(res.body.data[0].alunos[0].nome).toBe('Carla');
    });

    it('NAO conta em dobro o aluno que casa por nome E por turmaId', async () => {
        // Este é o caso que uma implementação ingênua de agrupamento erra: o
        // `$or` do banco devolvia o documento uma vez só, mas indexar por duas
        // chaves em memória o faria aparecer nas duas listas.
        const cookies = await sessaoSecretaria();
        await Turma.create({ _id: 't3', nome: '7C', escolaId: ESCOLA, ativo: true });
        await Aluno.create({ nome: 'Diego', turma: '7C', turmaId: 't3', escolaId: ESCOLA, ativo: true });

        const res = await pedirTurmas(cookies);

        expect(res.body.data[0].totalAlunos).toBe(1);
        expect(res.body.data[0].alunos).toHaveLength(1);
    });

    it('ignora aluno inativo', async () => {
        const cookies = await sessaoSecretaria();
        await Turma.create({ _id: 't4', nome: '8D', escolaId: ESCOLA, ativo: true });
        await Aluno.create({ nome: 'Ativo', turma: '8D', escolaId: ESCOLA, ativo: true });
        await Aluno.create({ nome: 'Inativo', turma: '8D', escolaId: ESCOLA, ativo: false });

        const res = await pedirTurmas(cookies);

        expect(res.body.data[0].totalAlunos).toBe(1);
        expect(res.body.data[0].alunos[0].nome).toBe('Ativo');
    });

    it('nao vaza aluno de outra escola', async () => {
        // O filtro multi-escola só entra em ação quando existem escolas
        // cadastradas E o usuário tem vínculo — ver middleware/filtrarPorEscola.
        // Sem essa montagem, `req.escolaId` fica indefinido e o escopo é
        // ignorado por projeto (caminho "pré-migração"), não por falha.
        const { escolaId, cookies } = await sessaoComEscola();
        await Turma.create({ _id: 't5', nome: '9E', escolaId, ativo: true });
        await Aluno.create({ nome: 'Daqui', turma: '9E', escolaId, ativo: true });
        await Aluno.create({ nome: 'DeOutra', turma: '9E', escolaId: 'outra-escola-id', ativo: true });

        const res = await pedirTurmas(cookies);

        expect(res.body.data[0].totalAlunos).toBe(1);
        expect(JSON.stringify(res.body)).not.toContain('DeOutra');
    });

    it('turma sem aluno responde com lista vazia, nao com erro', async () => {
        const cookies = await sessaoSecretaria();
        await Turma.create({ _id: 't6', nome: 'Vazia', escolaId: ESCOLA, ativo: true });

        const res = await pedirTurmas(cookies);

        expect(res.status).toBe(200);
        expect(res.body.data[0].totalAlunos).toBe(0);
        expect(res.body.data[0].alunos).toEqual([]);
    });

    it('escola sem turma nenhuma responde 200 com data vazio', async () => {
        const cookies = await sessaoSecretaria();

        const res = await pedirTurmas(cookies);

        // Estado vazio precisa ser distinguível de falha: a tela mostra
        // "nenhum dado", nunca a mensagem de erro com botão de retry.
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual([]);
    });
});

describe('Relatório de matrículas', () => {
    async function criarMatriculas(quantidade, status = 'cursando') {
        for (let i = 0; i < quantidade; i++) {
            const aluno = await Aluno.create({ nome: `Aluno ${status} ${i}`, escolaId: ESCOLA, ativo: true });
            await Matricula.create({
                alunoId: String(aluno._id),
                turmaId: 'turma-x',
                escolaId: ESCOLA,
                anoLetivo: 2000 + i,   // o índice único é (escolaId, alunoId, anoLetivo)
                status,
            });
        }
    }

    const pedirMatriculas = (cookies, query = '') =>
        request(app).get(`/api/secretaria/relatorios/matriculas${query}`).set('Cookie', cookies);

    it('limita as linhas devolvidas', async () => {
        const cookies = await sessaoSecretaria();
        await criarMatriculas(5);

        const res = await pedirMatriculas(cookies, '?limite=2');

        expect(res.status).toBe(200);
        expect(res.body.data.matriculas).toHaveLength(2);
        expect(res.body.data.paginacao.truncado).toBe(true);
    });

    it('o resumo conta a base INTEIRA, nao apenas a pagina', async () => {
        // Este é o erro que a paginação introduziria se o resumo continuasse
        // sendo calculado sobre o array já carregado: os totais da tela
        // passariam a refletir só as linhas visíveis.
        const cookies = await sessaoSecretaria();
        await criarMatriculas(5, 'cursando');

        const res = await pedirMatriculas(cookies, '?limite=2');

        expect(res.body.data.resumo.total).toBe(5);
        expect(res.body.data.resumo.cursando).toBe(5);
    });

    it('separa o resumo por status', async () => {
        const cookies = await sessaoSecretaria();
        await criarMatriculas(2, 'cursando');
        await criarMatriculas(3, 'aprovado');

        const res = await pedirMatriculas(cookies);

        expect(res.body.data.resumo.total).toBe(5);
        expect(res.body.data.resumo.cursando).toBe(2);
        expect(res.body.data.resumo.aprovado).toBe(3);
        expect(res.body.data.resumo.reprovado).toBe(0);
    });

    it('sem matricula nenhuma devolve 200 com resumo zerado', async () => {
        const cookies = await sessaoSecretaria();

        const res = await pedirMatriculas(cookies);

        expect(res.status).toBe(200);
        expect(res.body.data.matriculas).toEqual([]);
        expect(res.body.data.resumo.total).toBe(0);
        expect(res.body.data.paginacao.truncado).toBe(false);
    });

    it('limite absurdo e contido — o cliente nao define a carga do servidor', async () => {
        const cookies = await sessaoSecretaria();
        await criarMatriculas(1);

        const res = await pedirMatriculas(cookies, '?limite=999999');

        expect(res.body.data.paginacao.limite).toBe(1000);
    });
});

describe('Relatórios: autorização', () => {
    it('professor nao acessa os relatorios da secretaria', async () => {
        const usuario = await criarUsuario({ email: `prof_rel_${Date.now()}@escola.test`, perfil: 'professor' });
        const cookies = [`escola_jwt=${assinarTokenSessao(usuario)}`];

        const res = await pedirTurmas(cookies);

        expect(res.status).toBe(403);
    });

    it('anonimo nao acessa os relatorios da secretaria', async () => {
        const res = await request(app).get('/api/secretaria/relatorios/alunos-por-turma');

        expect(res.status).toBe(401);
    });
});
