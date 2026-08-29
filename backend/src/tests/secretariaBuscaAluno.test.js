/**
 * secretariaBuscaAluno.test.js — busca de aluno nas telas da Secretaria.
 *
 * Cobre as três entradas que a secretaria usa para achar um aluno:
 *   1. listagem/gestão de alunos            → GET /api/alunos?q=&turma=
 *   2. modal "Código Secreto do Aluno"      → GET /api/alunos/codigos-secretos?q=&turma=
 *   3. relatórios                           → GET /api/secretaria/relatorios/*?q=&turma=
 *
 * O fio que liga todos os casos: o aluno ESTÁ no banco e a tela dizia que não.
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

const Aluno = require('../models/Aluno');
const Turma = require('../models/Turma');

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
});

async function agentAdmin(email) {
    await criarUsuario({ email, perfil: 'admin' });
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').send({ email, senha: SENHA_TESTE });
    expect(res.status).toBe(200);
    return agent;
}

/** Nomes que a secretaria digita de um jeito e o cadastro guarda de outro. */
async function semearAlunos() {
    await Aluno.create([
        {
            nome: 'João',
            sobrenome: 'da Silva Pereira',
            turma: '1ºA',
            matricula: '2024001',
            ativo: true,
        },
        {
            nome: 'Maria',
            sobrenome: 'Aparecida Souza',
            turma: '1A',
            matricula: '2024002',
            ativo: true,
        },
        { nome: 'Antônio', sobrenome: 'Gonçalves', turma: '2B', matricula: '2024003', ativo: true },
    ]);
}

function nomes(lista) {
    return lista.map((a) => a.nome).sort();
}

describe('GET /api/alunos — busca da tela de gestão', () => {
    /** REGRESSÃO: `nome.includes(termo)` não achava nome acentuado. */
    it('acha "João" procurando por "joao"', async () => {
        await semearAlunos();
        const agent = await agentAdmin('admin_busca1@escola.test');

        const res = await agent.get('/api/alunos?q=joao');
        expect(res.status).toBe(200);
        expect(nomes(res.body.data)).toEqual(['João']);
    });

    /** REGRESSÃO: a regex exigia a ordem exata do cadastro. */
    it('acha "João da Silva" procurando por "silva joao"', async () => {
        await semearAlunos();
        const agent = await agentAdmin('admin_busca2@escola.test');

        const res = await agent.get('/api/alunos?q=silva%20joao');
        expect(res.status).toBe(200);
        expect(nomes(res.body.data)).toEqual(['João']);
    });

    /** REGRESSÃO: `sobrenome` ficava de fora da busca. */
    it('acha pelo sobrenome', async () => {
        await semearAlunos();
        const agent = await agentAdmin('admin_busca3@escola.test');

        const res = await agent.get('/api/alunos?q=souza');
        expect(res.status).toBe(200);
        expect(nomes(res.body.data)).toEqual(['Maria']);
    });

    /**
     * REGRESSÃO: a lista fixa de variações ("1A", "1ºA") não cobria todas as
     * grafias, então o aluno cadastrado com a outra sumia do filtro por turma.
     */
    it('o filtro por sala casa as duas grafias da turma', async () => {
        await semearAlunos();
        const agent = await agentAdmin('admin_busca4@escola.test');

        const res = await agent.get('/api/alunos?turma=1A');
        expect(res.status).toBe(200);
        expect(nomes(res.body.data)).toEqual(['João', 'Maria']);
    });

    it('combina sala e nome sem um filtro anular o outro', async () => {
        await semearAlunos();
        const agent = await agentAdmin('admin_busca5@escola.test');

        const res = await agent.get('/api/alunos?turma=1A&q=maria');
        expect(res.status).toBe(200);
        expect(nomes(res.body.data)).toEqual(['Maria']);

        // Maria é da 1A: pedindo a 2B ela não pode aparecer.
        const vazio = await agent.get('/api/alunos?turma=2B&q=maria');
        expect(vazio.body.data).toHaveLength(0);
    });
});

describe('GET /api/alunos/codigos-secretos — modal de código', () => {
    it('puxa o código pelo NOME do aluno', async () => {
        await semearAlunos();
        const agent = await agentAdmin('admin_cod1@escola.test');

        const res = await agent.get('/api/alunos/codigos-secretos?q=antonio');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].nome).toContain('Antônio');
        expect(res.body.data[0].codigoSecreto).toBeTruthy();
    });

    it('puxa os códigos pela SALA, nas duas grafias', async () => {
        await semearAlunos();
        const agent = await agentAdmin('admin_cod2@escola.test');

        const res = await agent.get('/api/alunos/codigos-secretos?turma=1A');
        expect(res.status).toBe(200);
        expect(res.body.data.map((a) => a.nome).sort()).toEqual([
            'João da Silva Pereira',
            'Maria Aparecida Souza',
        ]);
    });

    it('devolve a lista de salas para o filtro, sem os filtros aplicados', async () => {
        await semearAlunos();
        const agent = await agentAdmin('admin_cod3@escola.test');

        const res = await agent.get('/api/alunos/codigos-secretos?turma=2B');
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(1);
        // O seletor não pode encolher junto com o resultado, senão a secretaria
        // fica presa na sala que acabou de escolher.
        expect(res.body.salas.length).toBeGreaterThanOrEqual(2);
    });
});

describe('GET /api/secretaria/relatorios/alunos-por-turma', () => {
    /**
     * REGRESSÃO: o relatório agrupava comparando a sala como string. O aluno
     * que a professora cadastrou como "1ºA" não entrava na turma "1A" e
     * desaparecia do relatório sem deixar rastro.
     */
    it('agrupa o aluno cadastrado com outra grafia da sala', async () => {
        await Turma.create({ nome: '1A', ativo: true });
        await semearAlunos();
        const agent = await agentAdmin('admin_rel1@escola.test');

        const res = await agent.get('/api/secretaria/relatorios/alunos-por-turma');
        expect(res.status).toBe(200);

        const turma1A = res.body.data.find((t) => t.turma === '1A');
        expect(turma1A.totalAlunos).toBe(2);
    });

    /** O aluno cuja sala não existe no cadastro de turmas fica visível. */
    it('lista em bloco próprio quem não casa com nenhuma turma cadastrada', async () => {
        await Turma.create({ nome: '1A', ativo: true });
        await semearAlunos();
        const agent = await agentAdmin('admin_rel2@escola.test');

        const res = await agent.get('/api/secretaria/relatorios/alunos-por-turma');
        const avulsos = res.body.data.find((t) => t.semTurmaCadastrada);
        expect(avulsos).toBeTruthy();
        expect(avulsos.alunos.map((a) => a.nome)).toEqual(['Antônio']);
    });

    it('filtra por nome de aluno', async () => {
        await Turma.create({ nome: '1A', ativo: true });
        await semearAlunos();
        const agent = await agentAdmin('admin_rel3@escola.test');

        const res = await agent.get('/api/secretaria/relatorios/alunos-por-turma?q=maria');
        const todos = res.body.data.flatMap((t) => t.alunos);
        expect(nomes(todos)).toEqual(['Maria']);
    });

    it('filtra por sala', async () => {
        await Turma.create({ nome: '1A', ativo: true });
        await semearAlunos();
        const agent = await agentAdmin('admin_rel4@escola.test');

        const res = await agent.get('/api/secretaria/relatorios/alunos-por-turma?turma=2B');
        const todos = res.body.data.flatMap((t) => t.alunos);
        expect(nomes(todos)).toEqual(['Antônio']);
    });
});

describe('Aluno sem o campo `ativo` (cadastro legado)', () => {
    /**
     * REGRESSÃO: as telas da secretaria filtravam por `ativo: true` estrito.
     * Todo cadastro em que o campo nem existe ficava invisível — o aluno estava
     * no banco e não aparecia em lugar nenhum.
     */
    it('aparece na listagem, no relatório e na lista de códigos', async () => {
        const col = require('mongoose').connection.collection('alunos');
        await col.insertOne({ _id: 'legado-1', nome: 'Legado Sem Ativo', turma: '1A' });
        await Turma.create({ nome: '1A', ativo: true });

        const agent = await agentAdmin('admin_legado@escola.test');

        const lista = await agent.get('/api/alunos?q=legado');
        expect(nomes(lista.body.data)).toEqual(['Legado Sem Ativo']);

        const codigos = await agent.get('/api/alunos/codigos-secretos?q=legado');
        expect(codigos.body.data).toHaveLength(1);

        const rel = await agent.get('/api/secretaria/relatorios/alunos-por-turma?q=legado');
        const todos = rel.body.data.flatMap((t) => t.alunos);
        expect(nomes(todos)).toEqual(['Legado Sem Ativo']);
    });
});
