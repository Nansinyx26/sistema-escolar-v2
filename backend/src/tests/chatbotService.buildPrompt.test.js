/**
 * chatbotService.buildPrompt.test.js
 *
 * Unit tests for ChatbotService.buildPrompt()
 * Requirements: 13.1, 13.2, 14.2
 */

const { buildPrompt } = require('../services/ChatbotService');

describe('buildPrompt', () => {
    const baseParams = {
        perfil: 'responsavel',
        intencao: 'NOTAS',
        message: 'Quais são as notas do meu filho?',
        dados: { notas: [{ materia: 'Matemática', nota: 8.5 }], media: 8.5 },
        historico: [],
    };

    // Requisito 13.2: instrução do sistema deve conter PT-BR, tom empático, sem JSON bruto, sem markdown
    it('inclui instrução de responder sempre em Português-BR', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('Português-BR');
    });

    it('inclui instrução de tom empático e humanizado', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('humana');
    });

    it('inclui instrução de não retornar JSON bruto', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('NÃO retorne JSON');
    });

    it('inclui instrução de não usar markdown', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('NÃO use markdown');
    });

    // Requisito 13.1: prompt deve conter perfil, intenção, dados consultados e mensagem original
    it('inclui o perfil do usuário no prompt', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('Perfil do usuário: responsavel');
    });

    it('inclui a intenção identificada no prompt', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('Intenção identificada: NOTAS');
    });

    it('inclui a pergunta original no prompt', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('Pergunta original: "Quais são as notas do meu filho?"');
    });

    it('serializa os dados consultados com JSON.stringify', () => {
        const prompt = buildPrompt(baseParams);
        const dadosSerializados = JSON.stringify(baseParams.dados, null, 2);
        expect(prompt).toContain(dadosSerializados);
    });

    // Requisito 14.2: histórico incluído no formato [Usuário]: ... \n[Assistente]: ...
    it('formata o histórico no formato [Usuário]/[Assistente]', () => {
        const params = {
            ...baseParams,
            historico: [
                { pergunta: 'Como vai?', resposta: 'Tudo bem!' },
            ],
        };
        const prompt = buildPrompt(params);
        expect(prompt).toContain('[Usuário]: Como vai?');
        expect(prompt).toContain('[Assistente]: Tudo bem!');
    });

    it('exibe (sem histórico) quando historico é array vazio', () => {
        const prompt = buildPrompt({ ...baseParams, historico: [] });
        expect(prompt).toContain('(sem histórico)');
    });

    it('exibe (sem histórico) quando historico é undefined', () => {
        const params = { ...baseParams };
        delete params.historico;
        const prompt = buildPrompt(params);
        expect(prompt).toContain('(sem histórico)');
    });

    it('exibe (sem histórico) quando historico é null', () => {
        const prompt = buildPrompt({ ...baseParams, historico: null });
        expect(prompt).toContain('(sem histórico)');
    });

    it('ordena o histórico do mais antigo para o mais recente (reverse)', () => {
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

    it('formata múltiplas entradas de histórico separadas por nova linha', () => {
        const params = {
            ...baseParams,
            historico: [
                { pergunta: 'P2', resposta: 'R2' },
                { pergunta: 'P1', resposta: 'R1' },
            ],
        };
        const prompt = buildPrompt(params);
        // After reverse: P1 appears before P2
        expect(prompt).toContain('[Usuário]: P1\n[Assistente]: R1');
        expect(prompt).toContain('[Usuário]: P2\n[Assistente]: R2');
    });

    it('retorna uma string não vazia', () => {
        const prompt = buildPrompt(baseParams);
        expect(typeof prompt).toBe('string');
        expect(prompt.trim().length).toBeGreaterThan(0);
    });

    it('inclui seção de dados consultados do banco', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('[Dados reais consultados]');
    });

    it('inclui seção de histórico recente', () => {
        const prompt = buildPrompt(baseParams);
        expect(prompt).toContain('[Histórico recente da conversa]');
    });
});
