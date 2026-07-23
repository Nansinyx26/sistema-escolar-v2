/**
 * chatbotService.fetchGradeHoraria.test.js
 *
 * Unit tests for ChatbotService.fetchGradeHoraria()
 * Requirements: 3.4, 4.4, 11.1, 11.2, 11.3
 */

const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const GradeHoraria = require('../models/GradeHoraria');
const { fetchGradeHoraria } = require('../services/ChatbotService');

beforeAll(async () => {
    await conectarBanco();
});

afterEach(async () => {
    await limparBanco();
});

afterAll(async () => {
    await desconectarBanco();
});

// Helper to create a GradeHoraria document
async function criarGrade(overrides = {}) {
    const defaults = {
        professorId: 'prof001',
        turmaId: 'turma-1A',
        disciplina: 'Matemática',
        diaSemana: 1,
        horaInicio: '08:00',
        horaFim: '09:00',
        ativo: true,
    };
    return GradeHoraria.create({ ...defaults, ...overrides });
}

describe('fetchGradeHoraria', () => {

    // Requisito 11.3: sem registros → retornar array vazio
    it('retorna array vazio quando não há registros para a turma', async () => {
        const result = await fetchGradeHoraria({ turmaId: 'turma-inexistente' });

        expect(result).toEqual([]);
    });

    // Guard: turmaId ausente (null/undefined) → retornar array vazio sem lançar erro
    it('retorna array vazio quando turmaId não é fornecido', async () => {
        await criarGrade({ turmaId: 'turma-1A' });

        const result = await fetchGradeHoraria({ turmaId: null });

        expect(result).toEqual([]);
    });

    // Requisito 11.1: filtra por turmaId
    it('retorna somente registros da turma solicitada', async () => {
        await criarGrade({ turmaId: 'turma-1A', disciplina: 'Matemática' });
        await criarGrade({ turmaId: 'turma-2B', disciplina: 'Português' }); // outra turma

        const result = await fetchGradeHoraria({ turmaId: 'turma-1A' });

        expect(result).toHaveLength(1);
        expect(result[0].disciplina).toBe('Matemática');
        expect(result[0].turmaId).toBe('turma-1A');
    });

    // Requisito 11.2: ordenar por diaSemana crescente, depois horaInicio crescente
    it('ordena os registros por diaSemana crescente', async () => {
        await criarGrade({ turmaId: 'turma-1A', diaSemana: 3, horaInicio: '10:00', disciplina: 'Quarta' });
        await criarGrade({ turmaId: 'turma-1A', diaSemana: 1, horaInicio: '08:00', disciplina: 'Segunda' });
        await criarGrade({ turmaId: 'turma-1A', diaSemana: 2, horaInicio: '09:00', disciplina: 'Terça' });

        const result = await fetchGradeHoraria({ turmaId: 'turma-1A' });

        expect(result[0].diaSemana).toBe(1);
        expect(result[1].diaSemana).toBe(2);
        expect(result[2].diaSemana).toBe(3);
    });

    it('ordena registros do mesmo dia por horaInicio crescente', async () => {
        await criarGrade({ turmaId: 'turma-1A', diaSemana: 1, horaInicio: '14:00', disciplina: 'Tarde' });
        await criarGrade({ turmaId: 'turma-1A', diaSemana: 1, horaInicio: '08:00', disciplina: 'Manhã' });
        await criarGrade({ turmaId: 'turma-1A', diaSemana: 1, horaInicio: '11:00', disciplina: 'Meio-dia' });

        const result = await fetchGradeHoraria({ turmaId: 'turma-1A' });

        expect(result[0].horaInicio).toBe('08:00');
        expect(result[1].horaInicio).toBe('11:00');
        expect(result[2].horaInicio).toBe('14:00');
    });

    // Requisito 11.1: retorna todos os campos do registro
    it('retorna os campos esperados em cada registro', async () => {
        await criarGrade({ turmaId: 'turma-1A', professorId: 'prof42', disciplina: 'Física', diaSemana: 2, horaInicio: '10:00', horaFim: '11:00' });

        const result = await fetchGradeHoraria({ turmaId: 'turma-1A' });

        expect(result).toHaveLength(1);
        expect(result[0].turmaId).toBe('turma-1A');
        expect(result[0].professorId).toBe('prof42');
        expect(result[0].disciplina).toBe('Física');
        expect(result[0].diaSemana).toBe(2);
        expect(result[0].horaInicio).toBe('10:00');
        expect(result[0].horaFim).toBe('11:00');
    });

    // Retorna objetos plain (lean) — não instâncias Mongoose
    it('retorna objetos plain (lean) e não instâncias do Mongoose', async () => {
        await criarGrade({ turmaId: 'turma-1A' });

        const result = await fetchGradeHoraria({ turmaId: 'turma-1A' });

        expect(result[0]).not.toBeInstanceOf(GradeHoraria);
        expect(result[0].disciplina).toBe('Matemática');
    });
});
