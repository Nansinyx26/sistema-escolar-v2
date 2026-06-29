/**
 * chatbotService.fetchFaltas.test.js
 *
 * Unit tests for ChatbotService.fetchFaltas()
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */

const mongoose = require('mongoose');
const { conectarBanco, limparBanco, desconectarBanco } = require('./helpers');
const Falta = require('../models/Falta');
const { fetchFaltas } = require('../services/ChatbotService');

beforeAll(async () => {
    await conectarBanco();
});

afterEach(async () => {
    await limparBanco();
});

afterAll(async () => {
    await desconectarBanco();
});

// Helper to create Falta documents
async function criarFalta(alunoId, presente) {
    return Falta.create({
        aluno: String(alunoId),
        turma: 'Turma A',
        data: new Date(),
        presente,
    });
}

describe('fetchFaltas', () => {
    // Requisito 9.5: sem registros → retornar objeto adequado sem fabricar dados
    it('retorna objeto com valores zerados/nulos quando não há registros para o aluno', async () => {
        const result = await fetchFaltas({ alunoContexto: 'aluno-inexistente' });

        expect(result).toEqual({
            faltas: [],
            total: 0,
            presentes: 0,
            frequencia: null,
            alertaCritico: false,
            alertaObservacao: false,
        });
    });

    // Requisito 9.1: busca por aluno correto
    it('retorna somente as faltas do aluno especificado', async () => {
        const alunoId = new mongoose.Types.ObjectId().toString();
        const outroId = new mongoose.Types.ObjectId().toString();

        await criarFalta(alunoId, true);
        await criarFalta(alunoId, false);
        await criarFalta(outroId, true); // não deve aparecer

        const result = await fetchFaltas({ alunoContexto: alunoId });

        expect(result.total).toBe(2);
        expect(result.faltas).toHaveLength(2);
        result.faltas.forEach(f => expect(String(f.aluno)).toBe(alunoId));
    });

    // Requisito 9.2: calcular frequência corretamente
    it('calcula frequência como (presentes / total) * 100', async () => {
        const alunoId = new mongoose.Types.ObjectId().toString();

        // 3 presentes, 1 ausente → 75%
        await criarFalta(alunoId, true);
        await criarFalta(alunoId, true);
        await criarFalta(alunoId, true);
        await criarFalta(alunoId, false);

        const result = await fetchFaltas({ alunoContexto: alunoId });

        expect(result.total).toBe(4);
        expect(result.presentes).toBe(3);
        expect(result.frequencia).toBeCloseTo(75, 5);
    });

    // Requisito 9.3: alertaCritico quando frequência < 75%
    it('define alertaCritico=true quando frequência é menor que 75%', async () => {
        const alunoId = new mongoose.Types.ObjectId().toString();

        // 1 presente, 3 ausentes → 25%
        await criarFalta(alunoId, true);
        await criarFalta(alunoId, false);
        await criarFalta(alunoId, false);
        await criarFalta(alunoId, false);

        const result = await fetchFaltas({ alunoContexto: alunoId });

        expect(result.frequencia).toBeCloseTo(25, 5);
        expect(result.alertaCritico).toBe(true);
        expect(result.alertaObservacao).toBe(false);
    });

    // Requisito 9.4: alertaObservacao quando frequência entre 75% e 84,9%
    it('define alertaObservacao=true quando frequência está entre 75% e 84,9%', async () => {
        const alunoId = new mongoose.Types.ObjectId().toString();

        // 4 presentes, 1 ausente → 80%
        await criarFalta(alunoId, true);
        await criarFalta(alunoId, true);
        await criarFalta(alunoId, true);
        await criarFalta(alunoId, true);
        await criarFalta(alunoId, false);

        const result = await fetchFaltas({ alunoContexto: alunoId });

        expect(result.frequencia).toBeCloseTo(80, 5);
        expect(result.alertaCritico).toBe(false);
        expect(result.alertaObservacao).toBe(true);
    });

    // Sem alertas quando frequência >= 85%
    it('não define alertas quando frequência é 85% ou superior', async () => {
        const alunoId = new mongoose.Types.ObjectId().toString();

        // 17 presentes, 3 ausentes → 85%
        for (let i = 0; i < 17; i++) await criarFalta(alunoId, true);
        for (let i = 0; i < 3; i++) await criarFalta(alunoId, false);

        const result = await fetchFaltas({ alunoContexto: alunoId });

        expect(result.frequencia).toBeCloseTo(85, 5);
        expect(result.alertaCritico).toBe(false);
        expect(result.alertaObservacao).toBe(false);
    });

    // Frequência de 100% (todos presentes)
    it('retorna frequencia=100 e sem alertas quando todos os registros são presentes', async () => {
        const alunoId = new mongoose.Types.ObjectId().toString();

        await criarFalta(alunoId, true);
        await criarFalta(alunoId, true);
        await criarFalta(alunoId, true);

        const result = await fetchFaltas({ alunoContexto: alunoId });

        expect(result.total).toBe(3);
        expect(result.presentes).toBe(3);
        expect(result.frequencia).toBe(100);
        expect(result.alertaCritico).toBe(false);
        expect(result.alertaObservacao).toBe(false);
    });

    // Frequência de 0% (nenhum presente)
    it('retorna frequencia=0 e alertaCritico=true quando nenhum registro é presente', async () => {
        const alunoId = new mongoose.Types.ObjectId().toString();

        await criarFalta(alunoId, false);
        await criarFalta(alunoId, false);

        const result = await fetchFaltas({ alunoContexto: alunoId });

        expect(result.total).toBe(2);
        expect(result.presentes).toBe(0);
        expect(result.frequencia).toBe(0);
        expect(result.alertaCritico).toBe(true);
        expect(result.alertaObservacao).toBe(false);
    });

    // alunoContexto é convertido para string (Requisito 9.1)
    it('aceita alunoContexto como ObjectId e converte para string na query', async () => {
        const alunoObjectId = new mongoose.Types.ObjectId();

        await criarFalta(alunoObjectId.toString(), true);

        // Passa como ObjectId (não string)
        const result = await fetchFaltas({ alunoContexto: alunoObjectId });

        expect(result.total).toBe(1);
        expect(result.presentes).toBe(1);
    });
});
