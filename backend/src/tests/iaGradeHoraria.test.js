/**
 * iaGradeHoraria.test.js — Issue #702
 *
 * A ferramenta `consultarGradeHoraria` do copiloto responde "qual o horário da
 * turma?", que o chatbot antigo respondia. O recorte é o das outras consultas:
 * gestão vê a escola, professor só as próprias turmas e o responsável SÓ a
 * turma dos filhos vinculados — nunca outra turma, nem a homônima de outra
 * escola.
 *
 * O último bloco trava o catálogo do responsável: uma ferramenta nova só chega
 * a ele se este teste for atualizado de propósito.
 */

const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Professor = require('../models/Professor');
const GradeHoraria = require('../models/GradeHoraria');
const ToolRegistry = require('../services/ia/ToolRegistry');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');

let A;
let B;

beforeAll(async () => {
    await conectarBanco();
});
afterAll(async () => {
    await desconectarBanco();
});
beforeEach(async () => {
    await limparBanco();
    A = String((await Escola.create({ nome: 'EMEF Alfa', tipo: 'EMEF', ativo: true }))._id);
    B = String((await Escola.create({ nome: 'EMEF Beta', tipo: 'EMEF', ativo: true }))._id);
    invalidarCacheEscolas();

    const conta = await criarUsuario({ nome: 'Prof. Carla', escolaId: A });
    const prof = await Professor.create({
        idUsuario: String(conta._id),
        nome: 'Prof. Carla',
        email: 'carla@escola.test',
        telefone: '(19) 99999-0000',
        vinculos: [{ escolaId: A, cargo: 'professor' }],
    });
    const aula = (escolaId, turmaId, disciplina, diaSemana, horaInicio) => ({
        escolaId,
        turmaId,
        disciplina,
        diaSemana,
        horaInicio,
        horaFim: '08:50',
        professorId: String(prof._id),
    });
    await GradeHoraria.create([
        aula(A, '1A', 'Matemática', 1, '07:00'),
        aula(A, '1A', 'História', 2, '07:00'),
        aula(A, '2B', 'Ciências', 1, '07:00'),
        aula(B, '1A', 'Artes', 1, '07:00'),
    ]);
    await Aluno.create([
        { nome: 'Filho', turma: '1ºA', escolaId: A, responsavel: 'mae@escola.test' },
        { nome: 'Outro', turma: '2B', escolaId: A, responsavel: 'outra@escola.test' },
        { nome: 'Filho da Beta', turma: '2B', escolaId: B, responsavel: 'mae@escola.test' },
    ]);
});

function ctxDe({ perfil, escolaId = A, allowedTurmas = [], email = 'x@escola.test' }) {
    return ToolRegistry.construirContextoFerramenta({
        user: { id: 'u1', perfil, email, nome: 'Fulano' },
        escolaId,
        allowedTurmas,
    });
}

const grade = (params, ctx) => ToolRegistry.executar('consultarGradeHoraria', params, ctx);
const disciplinas = (r) => r.dados.aulas.map((a) => a.disciplina).sort();

describe('gestão', () => {
    it('vê a grade de qualquer turma da escola, e não a da homônima de outra escola', async () => {
        const r = await grade({ turma: '1A' }, ctxDe({ perfil: 'diretor' }));

        expect(r.ok).toBe(true);
        expect(disciplinas(r)).toEqual(['História', 'Matemática']);
        expect(r.dados.aulas[0]).toMatchObject({ turma: '1A', professor: 'Prof. Carla' });
    });

    it('filtra pelo dia da semana', async () => {
        const r = await grade({ turma: '1A', diaSemana: 2 }, ctxDe({ perfil: 'secretaria' }));

        expect(disciplinas(r)).toEqual(['História']);
        expect(r.dados.aulas[0].dia).toBe('terça');
    });

    it('sem turma, pergunta qual em vez de trazer a escola inteira', async () => {
        const r = await grade({}, ctxDe({ perfil: 'diretor' }));

        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/qual turma/);
    });

    it('o professor sai só com o nome, sem e-mail nem telefone', async () => {
        const r = await grade({ turma: '1A' }, ctxDe({ perfil: 'diretor' }));

        expect(JSON.stringify(r.dados)).not.toMatch(/carla@escola\.test|99999/);
    });
});

describe('professor', () => {
    it('vê a grade da própria turma', async () => {
        const r = await grade(
            { turma: '2B' },
            ctxDe({ perfil: 'professor', allowedTurmas: ['2B'] })
        );

        expect(disciplinas(r)).toEqual(['Ciências']);
    });

    it('não vê a grade de turma que não é dele', async () => {
        const r = await grade(
            { turma: '1A' },
            ctxDe({ perfil: 'professor', allowedTurmas: ['2B'] })
        );

        expect(r.ok).toBe(false);
        expect(r.dados).toBeUndefined();
    });

    it('sem turma, recebe a grade das próprias turmas', async () => {
        const r = await grade({}, ctxDe({ perfil: 'professor', allowedTurmas: ['2B'] }));

        expect(disciplinas(r)).toEqual(['Ciências']);
    });
});

describe('responsável', () => {
    const mae = (extra = {}) =>
        ctxDe({ perfil: 'responsavel', email: 'mae@escola.test', ...extra });

    it('vê a grade da turma do filho ("1ºA" e "1A" são a mesma turma)', async () => {
        const r = await grade({}, mae());

        expect(disciplinas(r)).toEqual(['História', 'Matemática']);
    });

    it('não vê a grade de outra turma, mesmo pedindo pelo nome', async () => {
        const r = await grade({ turma: '2B' }, mae());

        expect(r.ok).toBe(false);
        expect(r.dados).toBeUndefined();
        expect(r.erro).toMatch(/turma dos seus filhos/);
    });

    it('filho em outra escola não abre a grade desta', async () => {
        // O filho da Beta é do 2B; na Alfa o 2B é de outra família.
        const r = await grade({ turma: '2B' }, mae());

        expect(r.ok).toBe(false);
    });

    it('sem filho vinculado na escola, não recebe grade nenhuma', async () => {
        const r = await grade({}, ctxDe({ perfil: 'responsavel', email: 'sem.filho@escola.test' }));

        expect(r.ok).toBe(false);
        expect(r.erro).toMatch(/vínculo/);
    });
});

describe('catálogo do responsável', () => {
    it('só tem consultas dos próprios filhos e da rotina da escola', () => {
        expect(ToolRegistry.nomesPara('responsavel', { incluirMutates: true }).sort()).toEqual([
            'buscarAluno',
            'consultarFrequencia',
            'consultarGradeHoraria',
            'consultarNotas',
            'listarComunicados',
            'listarEventos',
        ]);
    });
});
