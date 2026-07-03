/**
 * chatbotService.deterministic.test.js
 *
 * Unit tests for the Layer 1 deterministic helpers:
 * - normalizeText (accent stripping + lowercase)
 * - validateButtons (1:1 DB correspondence)
 * - buildPrompt (Layer 3 strict rules)
 */

const { normalizeText, validateButtons, buildPrompt } = require('../services/ChatbotService');

// ─────────────────────────────────────────────────────────────────────────────
// normalizeText
// ─────────────────────────────────────────────────────────────────────────────
describe('normalizeText', () => {
    it('removes accents and lowercases', () => {
        expect(normalizeText('João')).toBe('joao');
        expect(normalizeText('André')).toBe('andre');
        expect(normalizeText('MÁRCIA')).toBe('marcia');
        expect(normalizeText('Ção')).toBe('cao');
    });

    it('trims whitespace', () => {
        expect(normalizeText('  Ana  ')).toBe('ana');
    });

    it('handles empty/null input', () => {
        expect(normalizeText('')).toBe('');
        expect(normalizeText(null)).toBe('');
        expect(normalizeText(undefined)).toBe('');
    });

    it('preserves unaccented text', () => {
        expect(normalizeText('maria')).toBe('maria');
        expect(normalizeText('Pedro Silva')).toBe('pedro silva');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateButtons
// ─────────────────────────────────────────────────────────────────────────────
describe('validateButtons', () => {
    const matches = [
        { _id: 'abc123', nome: 'João Silva', turma: '1A' },
        { _id: 'def456', nome: 'João Santos', turma: '2B' },
    ];

    it('keeps buttons that match DB results', () => {
        const buttons = [
            { label: 'João Silva — Turma 1A', value: 'abc123' },
            { label: 'João Santos — Turma 2B', value: 'def456' },
        ];
        const result = validateButtons(buttons, matches);
        expect(result).toHaveLength(2);
        expect(result[0].value).toBe('abc123');
        expect(result[1].value).toBe('def456');
    });

    it('discards buttons with no matching DB record', () => {
        const buttons = [
            { label: 'João Silva — Turma 1A', value: 'abc123' },
            { label: 'Inventado', value: 'zzz999' },
        ];
        const result = validateButtons(buttons, matches);
        expect(result).toHaveLength(1);
        expect(result[0].value).toBe('abc123');
    });

    it('returns empty array for null/undefined inputs', () => {
        expect(validateButtons(null, null)).toEqual([]);
        expect(validateButtons(undefined, undefined)).toEqual([]);
        expect(validateButtons([], [])).toEqual([]);
    });

    it('discards buttons with no value property', () => {
        const buttons = [
            { label: 'No value', value: null },
            { label: 'Has value', value: 'abc123' },
        ];
        const result = validateButtons(buttons, matches);
        expect(result).toHaveLength(1);
        expect(result[0].label).toBe('Has value');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildPrompt (Layer 3 strict rules)
// ─────────────────────────────────────────────────────────────────────────────
describe('buildPrompt', () => {
    const baseParams = {
        perfil: 'responsavel',
        intencao: 'NOTAS',
        message: 'Quais são as notas do meu filho?',
        dados: { notas: [{ materia: 'Matemática', nota: 8.5 }], media: 8.5 },
        historico: [],
    };

    it('includes strict rule about not inventing names', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('Não invente nomes');
    });

    it('includes strict rule about not generating buttons', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('NÃO gere botões');
    });

    it('includes rule about saying info not available for null fields', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('informação não está disponível');
    });

    it('includes Português-BR instruction', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('Português-BR');
    });

    it('includes empático e humanizado', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('empático');
        expect(prompt).toContain('humanizado');
    });

    it('includes NÃO retorne JSON bruto', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('NÃO retorne JSON bruto');
    });

    it('includes NÃO use markdown', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('NÃO use markdown');
    });

    it('includes user profile', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('Perfil do usuário: responsavel');
    });

    it('includes classified intent', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('Intenção identificada: NOTAS');
    });

    it('includes original question', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('Pergunta original: Quais são as notas do meu filho?');
    });

    it('serializes dados with JSON.stringify', () => {
        const prompt = buildPrompt(baseParams);
        const dadosSerialized = JSON.stringify(baseParams.dados, null, 2);
        expect(prompt).toContain(dadosSerialized);
    });

    it('shows (sem histórico) for empty history', () => {
        const prompt = buildPrompt({ ...baseParams, historico: [] });
        expect(prompt).toContain('(sem histórico)');
    });

    it('shows (sem histórico) for null history', () => {
        const prompt = buildPrompt({ ...baseParams, historico: null });
        expect(prompt).toContain('(sem histórico)');
    });

    it('shows (sem histórico) for undefined history', () => {
        const params = { ...baseParams };
        delete params.historico;
        const prompt = buildPrompt(params);
        expect(prompt).toContain('(sem histórico)');
    });

    it('formats history in [Usuário]/[Assistente] format', () => {
        const params = {
            ...baseParams,
            historico: [{ pergunta: 'Como vai?', resposta: 'Tudo bem!' }],
        };
        const prompt = buildPrompt(params);
        expect(prompt).toContain('[Usuário]: Como vai?');
        expect(prompt).toContain('[Assistente]: Tudo bem!');
    });

    it('reverses history order (oldest first)', () => {
        const params = {
            ...baseParams,
            historico: [
                { pergunta: 'Segunda pergunta', resposta: 'Segunda resposta' },
                { pergunta: 'Primeira pergunta', resposta: 'Primeira resposta' },
            ],
        };
        const prompt = buildPrompt(params);
        const posFirst = prompt.indexOf('Primeira pergunta');
        const posSecond = prompt.indexOf('Segunda pergunta');
        expect(posFirst).toBeLessThan(posSecond);
    });

    it('includes [Dados consultados do banco] section', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('[Dados consultados do banco]');
    });

    it('includes [Histórico recente] section', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('[Histórico recente]');
    });

    it('returns a non-empty string', () => {
        const prompt = buildPrompt(baseParams);
        expect(typeof prompt).toBe('string');
        expect(prompt.trim().length).toBeGreaterThan(0);
    });
});
