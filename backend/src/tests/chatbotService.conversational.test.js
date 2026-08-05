/**
 * chatbotService.conversational.test.js
 *
 * Unit tests for the conversational intent pipeline:
 * - classifyIntent (new conversational intents)
 * - isConversationalIntent
 * - getConversationalFallback
 * - buildConversationalPrompt
 */

const {
    classifyIntent,
    isConversationalIntent,
    getConversationalFallback,
    buildConversationalPrompt,
} = require('../services/ChatbotService');

// ─────────────────────────────────────────────────────────────────────────────
// classifyIntent — conversational intents
// ─────────────────────────────────────────────────────────────────────────────
describe('classifyIntent — conversational intents', () => {
    it('classifies greetings as SAUDACAO', () => {
        expect(classifyIntent('olá')).toBe('SAUDACAO');
        expect(classifyIntent('oi, tudo bem?')).toBe('SAUDACAO');
        expect(classifyIntent('bom dia')).toBe('SAUDACAO');
        expect(classifyIntent('boa tarde')).toBe('SAUDACAO');
        expect(classifyIntent('boa noite')).toBe('SAUDACAO');
    });

    it('classifies thanks as AGRADECIMENTO', () => {
        expect(classifyIntent('obrigado!')).toBe('AGRADECIMENTO');
        expect(classifyIntent('muito obrigada pela ajuda')).toBe('AGRADECIMENTO');
        expect(classifyIntent('valeu')).toBe('AGRADECIMENTO');
    });

    it('classifies goodbyes as DESPEDIDA', () => {
        expect(classifyIntent('tchau')).toBe('DESPEDIDA');
        expect(classifyIntent('até mais')).toBe('DESPEDIDA');
        expect(classifyIntent('bye')).toBe('DESPEDIDA');
        expect(classifyIntent('flw')).toBe('DESPEDIDA');
    });

    it('classifies system questions as SOBRE_SISTEMA', () => {
        expect(classifyIntent('o que você faz?')).toBe('SOBRE_SISTEMA');
        expect(classifyIntent('como funciona?')).toBe('SOBRE_SISTEMA');
        expect(classifyIntent('me ajuda')).toBe('SOBRE_SISTEMA');
    });

    it('classifies praise as ELOGIO', () => {
        expect(classifyIntent('parabéns pelo sistema!')).toBe('ELOGIO');
        expect(classifyIntent('muito bom!')).toBe('ELOGIO');
        expect(classifyIntent('adorei')).toBe('ELOGIO');
    });

    it('classifies complaints as RECLAMACAO', () => {
        expect(classifyIntent('não funciona isso')).toBe('RECLAMACAO');
        expect(classifyIntent('tem um erro aqui')).toBe('RECLAMACAO');
        expect(classifyIntent('tá ruim')).toBe('RECLAMACAO');
    });

    it('classifies unrecognized messages as INDEFINIDA', () => {
        expect(classifyIntent('asdf')).toBe('INDEFINIDA');
        expect(classifyIntent('xyz 123')).toBe('INDEFINIDA');
    });

    // Data intents still take priority over conversational
    it('data intents take priority over conversational keywords', () => {
        expect(classifyIntent('notas do João')).toBe('NOTAS');
        expect(classifyIntent('faltas do Pedro')).toBe('FALTAS');
        expect(classifyIntent('comunicados')).toBe('COMUNICADOS');
        expect(classifyIntent('horário')).toBe('HORARIO');
        expect(classifyIntent('professor')).toBe('PROFESSORES');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// isConversationalIntent
// ─────────────────────────────────────────────────────────────────────────────
describe('isConversationalIntent', () => {
    it('returns true for all conversational intents', () => {
        expect(isConversationalIntent('SAUDACAO')).toBe(true);
        expect(isConversationalIntent('AGRADECIMENTO')).toBe(true);
        expect(isConversationalIntent('DESPEDIDA')).toBe(true);
        expect(isConversationalIntent('SOBRE_SISTEMA')).toBe(true);
        expect(isConversationalIntent('ELOGIO')).toBe(true);
        expect(isConversationalIntent('RECLAMACAO')).toBe(true);
        expect(isConversationalIntent('FORA_CONTEXTO')).toBe(true);
        expect(isConversationalIntent('INDEFINIDA')).toBe(true);
    });

    it('returns false for data intents', () => {
        expect(isConversationalIntent('NOTAS')).toBe(false);
        expect(isConversationalIntent('FALTAS')).toBe(false);
        expect(isConversationalIntent('COMUNICADOS')).toBe(false);
        expect(isConversationalIntent('HORARIO')).toBe(false);
        expect(isConversationalIntent('PROFESSORES')).toBe(false);
        expect(isConversationalIntent('TURMA_GERAL')).toBe(false);
        expect(isConversationalIntent('RESUMO_GERAL')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getConversationalFallback
// ─────────────────────────────────────────────────────────────────────────────
describe('getConversationalFallback', () => {
    it('returns a non-empty string for every conversational intent', () => {
        const intents = [
            'SAUDACAO', 'AGRADECIMENTO', 'DESPEDIDA',
            'SOBRE_SISTEMA', 'ELOGIO', 'RECLAMACAO',
            'FORA_CONTEXTO', 'INDEFINIDA',
        ];
        for (const intent of intents) {
            const fallback = getConversationalFallback(intent);
            expect(typeof fallback).toBe('string');
            expect(fallback.trim().length).toBeGreaterThan(0);
        }
    });

    it('SAUDACAO fallback contains greeting', () => {
        expect(getConversationalFallback('SAUDACAO')).toContain('Olá');
    });

    it('DESPEDIDA fallback contains farewell', () => {
        expect(getConversationalFallback('DESPEDIDA')).toContain('Até mais');
    });

    it('RECLAMACAO fallback contains apology', () => {
        expect(getConversationalFallback('RECLAMACAO')).toContain('desculpas');
    });

    it('unknown intent falls back to INDEFINIDA response', () => {
        const fallback = getConversationalFallback('UNKNOWN_INTENT');
        expect(fallback).toBe(getConversationalFallback('INDEFINIDA'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildConversationalPrompt
// ─────────────────────────────────────────────────────────────────────────────
describe('buildConversationalPrompt', () => {
    const baseParams = {
        perfil: 'responsavel',
        nomeUsuario: 'Maria Silva',
        message: 'Olá, bom dia!',
    };

    it('returns a non-empty string', () => {
        const prompt = buildConversationalPrompt(baseParams);
        expect(typeof prompt).toBe('string');
        expect(prompt.trim().length).toBeGreaterThan(0);
    });

    it('includes user profile', () => {
        const prompt = buildConversationalPrompt(baseParams);
        expect(prompt).toContain('PERFIL (responsavel)');
    });

    it('includes user name', () => {
        const prompt = buildConversationalPrompt(baseParams);
        expect(prompt).toContain('nome Maria Silva');
    });

    it('includes user message', () => {
        const prompt = buildConversationalPrompt(baseParams);
        expect(prompt).toContain('"Olá, bom dia!"');
    });

    it('handles missing user name', () => {
        const prompt = buildConversationalPrompt({ ...baseParams, nomeUsuario: null });
        expect(prompt).not.toContain('nome null');
        expect(prompt).toContain('perfil responsavel');
    });

    it('includes instruction to not invent data', () => {
        const prompt = buildConversationalPrompt(baseParams);
        expect(prompt).toContain('NUNCA invente nome de aluno');
    });

    it('includes instruction to never mention Gemini', () => {
        const prompt = buildConversationalPrompt(baseParams);
        expect(prompt).toContain('Nunca mencione "Gemini"');
    });

    it('includes instruction for short responses', () => {
        const prompt = buildConversationalPrompt(baseParams);
        expect(prompt).toContain('1 a 3 frases');
    });

    it('does NOT contain [Dados consultados do banco] section', () => {
        const prompt = buildConversationalPrompt(baseParams);
        expect(prompt).not.toContain('[Dados consultados do banco]');
    });

    it('does NOT contain JSON.stringify output', () => {
        const prompt = buildConversationalPrompt(baseParams);
        expect(prompt).not.toContain('JSON.stringify');
        expect(prompt).not.toContain('"notas"');
    });
});
