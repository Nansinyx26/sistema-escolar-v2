/**
 * turmasDoProfessorPorEscola.test.js — Issue #707
 *
 * O professor entra numa segunda escola pela troca por código, e o vínculo
 * novo vai para o MESMO documento `Professor`. As turmas eram uma lista só,
 * sem escola, e o acesso ao aluno compara turma pelo nome: com a escola B
 * ativa, a "1A" que ele dá em A liberava a "1A" de B. Agora as turmas de cima
 * são da escola do cadastro, as de uma escola adicional ficam no vínculo dela,
 * e o `horizontalFilter` roda depois do `filtrarPorEscola`.
 */
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Diretor = require('../models/Diretor');
const Professor = require('../models/Professor');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { SENHA_TESTE } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { turmasDoProfessorNaEscola } = require('../services/turmasDoProfessor');
const { contasDasTurmas } = require('../services/publicoDoComunicado');

describe('turmasDoProfessorNaEscola', () => {
    const A = 'escola-a';
    const B = 'escola-b';
    const doCadastro = { salaPrincipal: '1A', salasAdicionais: ['2B'], turmas: ['1A', '2B'] };

    it('um vínculo só: as turmas de sempre', () => {
        const prof = { ...doCadastro, vinculos: [{ escolaId: A }] };
        expect(turmasDoProfessorNaEscola(prof, A)).toEqual(['1A', '2B']);
    });

    it('escola adicional sem turma atribuída: nenhuma', () => {
        const prof = { ...doCadastro, vinculos: [{ escolaId: A }, { escolaId: B }] };
        expect(turmasDoProfessorNaEscola(prof, A)).toEqual(['1A', '2B']);
        expect(turmasDoProfessorNaEscola(prof, B)).toEqual([]);
    });

    it('escola adicional com turmas no vínculo: só as dela', () => {
        const prof = {
            ...doCadastro,
            vinculos: [{ escolaId: A }, { escolaId: B, turmas: ['3C'] }],
        };
        expect(turmasDoProfessorNaEscola(prof, B)).toEqual(['3C']);
        expect(turmasDoProfessorNaEscola(prof, A)).toEqual(['1A', '2B']);
    });

    it('escola sem vínculo nenhum com o professor: nenhuma', () => {
        const prof = { ...doCadastro, vinculos: [{ escolaId: A }] };
        expect(turmasDoProfessorNaEscola(prof, 'escola-c')).toEqual([]);
    });

    it('sem escola resolvida: dois vínculos falham fechado, um vínculo segue', () => {
        expect(
            turmasDoProfessorNaEscola({
                ...doCadastro,
                vinculos: [{ escolaId: A }, { escolaId: B }],
            })
        ).toEqual([]);
        expect(turmasDoProfessorNaEscola({ ...doCadastro, vinculos: [{ escolaId: A }] })).toEqual([
            '1A',
            '2B',
        ]);
    });

    it('legado sem vínculo: escola do documento, ou escola única', () => {
        expect(turmasDoProfessorNaEscola({ ...doCadastro, escolaId: A }, A)).toEqual(['1A', '2B']);
        expect(turmasDoProfessorNaEscola({ ...doCadastro, escolaId: A }, B)).toEqual([]);
        expect(turmasDoProfessorNaEscola({ ...doCadastro }, A)).toEqual(['1A', '2B']);
    });

    it('sem cadastro de professor: nenhuma', () => {
        expect(turmasDoProfessorNaEscola(null, A)).toEqual([]);
    });
});

describe('professor com vínculo em duas escolas', () => {
    let escolaA;
    let escolaB;
    let prof;
    let usuarioProf;

    beforeAll(async () => {
        await conectarBanco();
    });
    afterAll(async () => {
        await desconectarBanco();
    });
    beforeEach(async () => {
        await limparBanco();
        escolaA = String((await Escola.create({ nome: 'EMEF A', tipo: 'EMEF', ativo: true }))._id);
        escolaB = String((await Escola.create({ nome: 'EMEF B', tipo: 'EMEF', ativo: true }))._id);
        await Aluno.create({ nome: 'Aluno 1A de A', turma: '1A', escolaId: escolaA, ativo: true });
        await Aluno.create({ nome: 'Aluno 1A de B', turma: '1A', escolaId: escolaB, ativo: true });
        await Aluno.create({ nome: 'Aluno 3C de B', turma: '3C', escolaId: escolaB, ativo: true });

        // Professor da 1A em A que entrou em B pela troca por código: o
        // vínculo de B foi acrescentado depois, e B não atribuiu turma nenhuma.
        usuarioProf = await criarUsuario({ email: 'prof.duas@escola.test', perfil: 'professor' });
        prof = await Professor.create({
            idUsuario: String(usuarioProf._id),
            nome: 'Prof Duas Escolas',
            email: usuarioProf.email,
            salaPrincipal: '1A',
            turmas: ['1A'],
            vinculos: [
                { escolaId: escolaA, cargo: 'professor' },
                { escolaId: escolaB, cargo: 'professor' },
            ],
        });
        invalidarCacheEscolas();
    });

    /** Sessão do professor com a escola escolhida ativa (login com a escolha). */
    async function professorNa(escolaId) {
        const agente = request.agent(app);
        const login = await agente
            .post('/api/auth/login')
            .send({ email: usuarioProf.email, senha: SENHA_TESTE, escolaId });
        expect(login.status).toBe(200);
        expect(login.body.requiresEscolha).toBeUndefined();
        return agente;
    }

    async function nomesDosAlunos(agente) {
        const res = await agente.get('/api/alunos');
        expect(res.status).toBe(200);
        return res.body.data.map((a) => a.nome).sort();
    }

    async function diretorDe(escolaId, email) {
        const diretor = await criarUsuario({ email, perfil: 'diretor' });
        await Diretor.create({
            idUsuario: String(diretor._id),
            nome: diretor.nome,
            email: diretor.email,
            vinculos: [{ escolaId, cargo: 'diretor' }],
        });
        return [`escola_jwt=${assinarTokenSessao(diretor)}`];
    }

    it('com a escola B ativa, a 1A de B não abre por ele dar aula na 1A de A', async () => {
        const naB = await professorNa(escolaB);
        expect(await nomesDosAlunos(naB)).toEqual([]);

        const alunoB = await Aluno.findOne({ nome: 'Aluno 1A de B' }).lean();
        const ficha = await naB.get(`/api/alunos/${alunoB._id}`);
        expect(ficha.status).toBe(403);
    });

    it('com a escola A ativa, a turma dele em A continua aberta', async () => {
        const naA = await professorNa(escolaA);
        expect(await nomesDosAlunos(naA)).toEqual(['Aluno 1A de A']);
    });

    it('a gestão de B atribui no vínculo de B, e cada escola vale só na sua', async () => {
        const gestaoB = await diretorDe(escolaB, 'dir.b@escola.test');
        const atribuicao = await request(app)
            .put(`/api/professores/${prof._id}`)
            .set('Cookie', gestaoB)
            .send({ salaPrincipal: '3C' });
        expect(atribuicao.status).toBe(200);
        expect(atribuicao.body.data.salaPrincipal).toBe('3C');

        const gravado = await Professor.findById(prof._id).lean();
        // As turmas de A ficaram intactas; as de B foram para o vínculo de B.
        expect(gravado.salaPrincipal).toBe('1A');
        expect(gravado.turmas).toEqual(['1A']);
        expect(gravado.vinculos.find((v) => v.escolaId === escolaB).turmas).toEqual(['3C']);

        expect(await nomesDosAlunos(await professorNa(escolaB))).toEqual(['Aluno 3C de B']);
        expect(await nomesDosAlunos(await professorNa(escolaA))).toEqual(['Aluno 1A de A']);
    });

    it('a gestão de cada escola vê só as turmas que o professor tem nela', async () => {
        await Professor.updateOne(
            { _id: prof._id, 'vinculos.escolaId': escolaB },
            { $set: { 'vinculos.$.turmas': ['3C'] } }
        );
        const listaB = await request(app)
            .get('/api/professores')
            .set('Cookie', await diretorDe(escolaB, 'dir.b2@escola.test'));
        const vistoPorB = listaB.body.data.find((p) => p.email === usuarioProf.email);
        expect(vistoPorB.salaPrincipal).toBe('3C');
        expect(vistoPorB.turmas).toEqual(['3C']);

        const listaA = await request(app)
            .get('/api/professores')
            .set('Cookie', await diretorDe(escolaA, 'dir.a2@escola.test'));
        const vistoPorA = listaA.body.data.find((p) => p.email === usuarioProf.email);
        expect(vistoPorA.salaPrincipal).toBe('1A');
        // As turmas que B gravou no vínculo dela não aparecem para A.
        expect(vistoPorA.vinculos.find((v) => v.escolaId === escolaB).turmas).toBeUndefined();
    });

    it('aviso para a 1A de B não alcança o professor da 1A de A', async () => {
        const contasB = await contasDasTurmas(escolaB, ['1A'], { incluirResponsaveis: false });
        expect(contasB).not.toContain(String(usuarioProf._id));

        const contasA = await contasDasTurmas(escolaA, ['1A'], { incluirResponsaveis: false });
        expect(contasA).toContain(String(usuarioProf._id));
    });
});

describe('ordem das montagens em routes/api.js', () => {
    it('toda rota com horizontalFilter roda filtrarPorEscola antes dele', () => {
        const fonte = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
        // Cada registro de rota: do `router.xxx(` até o `);` que o fecha.
        const registros = fonte.match(/router\.(use|get|post|put|patch|delete)\([\s\S]*?\);/g);
        const comFiltro = registros.filter((r) => /\bhorizontalFilter\b/.test(r));

        expect(comFiltro.length).toBeGreaterThan(10); // sanidade do leitor
        const foraDeOrdem = comFiltro.filter((r) => {
            const escola = r.search(/\bfiltrarPorEscola\b/);
            return escola === -1 || escola > r.search(/\bhorizontalFilter\b/);
        });
        expect(foraDeOrdem).toEqual([]);
    });
});
