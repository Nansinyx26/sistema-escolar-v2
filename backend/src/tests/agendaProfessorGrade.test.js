/**
 * agendaProfessorGrade.test.js — Issue #371
 *
 * A agenda do dia do painel do professor (GET /api/dashboard/teacher-panel)
 * sai só da grade cadastrada (`tabela_geral`) da escola ativa. Antes, toda
 * segunda-feira um professor PEB I recebia uma lista fixa escrita no código
 * ("Artes (PEB 2) — Prof. Mirian", "Reunião Pedagógica"…), o especialista
 * tinha a chave de grade deduzida pelo nome da pessoa e o fim de semana caía
 * na grade de segunda.
 *
 * O relógio é fixado só no `Date`: timers e `nextTick` continuam reais, senão
 * o driver do Mongo para de responder.
 */

const request = require('supertest');
const app = require('../app');
const Escola = require('../models/Escola');
const Professor = require('../models/Professor');
const TabelaGeral = require('../models/TabelaGeral');
const { invalidarCacheEscolas } = require('../middleware/filtrarPorEscola');
const { conectarBanco, limparBanco, desconectarBanco, criarUsuario } = require('./helpers');
const { assinarTokenSessao } = require('../utils/sessionToken');

// 14/09/2026 é segunda-feira; 10h em São Paulo (UTC-3).
const SEGUNDA_10H = new Date('2026-09-14T13:00:00Z');
const SABADO_10H = new Date('2026-09-19T13:00:00Z');

function fixarRelogio(data) {
    jest.useFakeTimers({
        now: data,
        doNotFake: [
            'nextTick',
            'setImmediate',
            'clearImmediate',
            'setTimeout',
            'clearTimeout',
            'setInterval',
            'clearInterval',
            'queueMicrotask',
            'hrtime',
            'performance',
        ],
    });
}

beforeAll(async () => {
    await conectarBanco();
});

beforeEach(() => {
    invalidarCacheEscolas();
});

afterEach(async () => {
    jest.useRealTimers();
    await limparBanco();
    invalidarCacheEscolas();
});

afterAll(async () => {
    await desconectarBanco();
});

async function criarProfessor(escola, dadosProfessor) {
    const usuario = await criarUsuario({
        perfil: 'professor',
        nome: dadosProfessor.nome,
        escolaId: String(escola._id),
    });
    await Professor.create({
        idUsuario: String(usuario._id),
        email: usuario.email,
        vinculos: [{ escolaId: String(escola._id), cargo: 'professor' }],
        ...dadosProfessor,
    });
    return [`escola_jwt=${assinarTokenSessao(usuario, { escolaId: String(escola._id) })}`];
}

async function gradeDoDia(escola, turmaId, dia, abrevs) {
    await TabelaGeral.insertMany(
        abrevs.map((abrev, aulaIdx) => ({
            escolaId: String(escola._id),
            turmaId,
            turmaNome: `${turmaId[0]}º${turmaId[1]}`,
            dia,
            aulaIdx,
            horarioLabel: TabelaGeral.HORARIO_LABELS[aulaIdx],
            abrev,
            professorKey: TabelaGeral.getProfessorKey(abrev, turmaId),
        }))
    );
}

describe('Agenda do dia do professor vem só da grade (Issue #371)', () => {
    let escolaA;
    let escolaB;

    beforeEach(async () => {
        escolaA = await Escola.create({
            nome: 'Escola Municipal Alpha',
            tipo: 'EMEF',
            ativo: true,
        });
        escolaB = await Escola.create({ nome: 'Escola Municipal Beta', tipo: 'EMEF', ativo: true });
    });

    it('segunda-feira sem grade cadastrada devolve agenda vazia, sem aula fixa', async () => {
        fixarRelogio(SEGUNDA_10H);
        const cookie = await criarProfessor(escolaA, { nome: 'Paula Lima', salaPrincipal: '3A' });

        const res = await request(app).get('/api/dashboard/teacher-panel').set('Cookie', cookie);

        expect(res.status).toBe(200);
        expect(res.body.data.diaSemana).toBe('Segunda-feira');
        expect(res.body.data.proximasAulas).toEqual([]);
        expect(JSON.stringify(res.body.data)).not.toMatch(/Reunião Pedagógica|Mirian|Raquel/);
    });

    it('segunda-feira com grade segue a mesma regra dos outros dias', async () => {
        fixarRelogio(SEGUNDA_10H);
        const cookie = await criarProfessor(escolaA, { nome: 'Paula Lima', salaPrincipal: '3A' });
        await gradeDoDia(escolaA, '3A', 'SEGUNDA', ['', '', 'I', '', '', '', '']);

        const res = await request(app).get('/api/dashboard/teacher-panel').set('Cookie', cookie);
        const aulas = res.body.data.proximasAulas;

        expect(aulas).toHaveLength(7);
        expect(aulas[0]).toMatchObject({
            hora: '07:30',
            materia: 'Aula regular',
            status: 'Concluída',
        });
        expect(aulas[2].materia).toMatch(/^Inglês/);
        expect(aulas[3]).toMatchObject({ hora: '10:20', status: 'Às 10:20' });
        expect(aulas.some((a) => /Reunião/.test(a.materia))).toBe(false);
    });

    it('não usa a grade de outra escola com a mesma turma', async () => {
        fixarRelogio(SEGUNDA_10H);
        const cookie = await criarProfessor(escolaA, { nome: 'Paula Lima', salaPrincipal: '3A' });
        await gradeDoDia(escolaB, '3A', 'SEGUNDA', ['', '', 'I', '', '', '', '']);

        const res = await request(app).get('/api/dashboard/teacher-panel').set('Cookie', cookie);

        expect(res.body.data.proximasAulas).toEqual([]);
    });

    it('especialista sem professorKey no cadastro não tem a chave deduzida pelo nome', async () => {
        fixarRelogio(SEGUNDA_10H);
        const cookie = await criarProfessor(escolaA, {
            nome: 'Marcos Souza',
            disciplina: 'Ed. Física',
            tipoAtuacao: 'materia',
            salasAdicionais: ['4A', '5A'],
        });
        await gradeDoDia(escolaA, '4A', 'SEGUNDA', ['EF', '', '', '', '', '', '']);

        const res = await request(app).get('/api/dashboard/teacher-panel').set('Cookie', cookie);

        expect(res.body.data.proximasAulas).toEqual([]);
    });

    it('especialista com professorKey no cadastro vê as aulas dele na grade', async () => {
        fixarRelogio(SEGUNDA_10H);
        const cookie = await criarProfessor(escolaA, {
            nome: 'Marcos Souza',
            disciplina: 'Ed. Física',
            tipoAtuacao: 'materia',
            professorKey: 'MARCOS',
            salasAdicionais: ['4A', '5A'],
        });
        await gradeDoDia(escolaA, '4A', 'SEGUNDA', ['EF', '', '', '', '', '', '']);

        const res = await request(app).get('/api/dashboard/teacher-panel').set('Cookie', cookie);
        const aulas = res.body.data.proximasAulas;

        expect(aulas).toHaveLength(7);
        expect(aulas[0]).toMatchObject({ turma: '4ºA', livre: false });
        expect(aulas[1]).toMatchObject({ livre: true });
    });

    it('sábado não cai na grade de segunda-feira', async () => {
        fixarRelogio(SABADO_10H);
        const cookie = await criarProfessor(escolaA, { nome: 'Paula Lima', salaPrincipal: '3A' });
        await gradeDoDia(escolaA, '3A', 'SEGUNDA', ['', '', 'I', '', '', '', '']);

        const res = await request(app).get('/api/dashboard/teacher-panel').set('Cookie', cookie);

        expect(res.body.data.diaSemana).toBe('Sábado');
        expect(res.body.data.proximasAulas).toEqual([]);
    });
});
