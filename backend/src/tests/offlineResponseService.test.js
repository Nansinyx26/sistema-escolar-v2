/**
 * offlineResponseService.test.js
 *
 * Cobre:
 * - Variação de templates (não repetir sempre o mesmo texto).
 * - Ausência de dados inventados (placeholders sem valor viram texto neutro).
 * - Presença da persona/tom em todos os tipos suportados.
 */

const offlineResponseService = require('../services/offlineResponseService');
const { buildOfflineResponse, listTipos } = offlineResponseService;

describe('offlineResponseService — variação de templates', () => {
    it('retorna pelo menos 2 textos diferentes em várias chamadas do mesmo tipo', () => {
        const outputs = new Set();
        for (let i = 0; i < 30; i++) {
            outputs.add(buildOfflineResponse({ tipo: 'chatbot_saudacao' }));
        }
        expect(outputs.size).toBeGreaterThanOrEqual(2);
    });

    it('varia também para tipos pedagógicos (analise_turma)', () => {
        const outputs = new Set();
        for (let i = 0; i < 30; i++) {
            outputs.add(buildOfflineResponse({
                tipo: 'analise_turma',
                contexto: { turma: '9A', media: '7.5', frequencia: '92.0%' },
            }));
        }
        expect(outputs.size).toBeGreaterThanOrEqual(2);
    });
});

describe('offlineResponseService — sem dados inventados', () => {
    it('não insere números/nomes quando o contexto está vazio', () => {
        // Roda várias vezes para cobrir todas as variações de template.
        for (let i = 0; i < 30; i++) {
            const texto = buildOfflineResponse({ tipo: 'analise_turma', contexto: {} });
            // Placeholders sem valor devem virar "informação não disponível",
            // nunca um valor fabricado.
            expect(texto).toContain('informação não disponível');
        }
    });

    it('usa exatamente os dados reais fornecidos, sem alterá-los', () => {
        // Testa todas as variações verificando que os valores aparecem quando presentes.
        let achouMedia = false;
        for (let i = 0; i < 40; i++) {
            const texto = buildOfflineResponse({
                tipo: 'analise_turma',
                contexto: { turma: 'TURMA-X', media: '8.3', frequencia: '95.5%' },
            });
            expect(texto).toContain('TURMA-X');
            if (texto.includes('8.3')) achouMedia = true;
            // nunca deve conter "informação não disponível" quando os dados existem
            expect(texto).not.toContain('informação não disponível');
        }
        expect(achouMedia).toBe(true);
    });
});

describe('offlineResponseService — persona/tom consistente', () => {
    it('nunca menciona "Gemini" nem "IA do Google" em nenhum tipo', () => {
        for (const tipo of listTipos()) {
            for (let i = 0; i < 20; i++) {
                const texto = buildOfflineResponse({
                    tipo,
                    contexto: {
                        materia: 'Matemática', ano: '9º ano', tema: 'Frações',
                        aluno: 'João', turma: '9A', predicao: '7.0',
                        media: '7.5', frequencia: '90%',
                        totalAlunos: 30, mediaEscola: '7.2',
                    },
                }).toLowerCase();
                expect(texto).not.toContain('gemini');
                expect(texto).not.toContain('ia do google');
            }
        }
    });

    it('retorna string não vazia para todos os tipos suportados', () => {
        for (const tipo of listTipos()) {
            const texto = buildOfflineResponse({ tipo, contexto: {} });
            expect(typeof texto).toBe('string');
            expect(texto.length).toBeGreaterThan(0);
        }
    });

    it('retorna resposta neutra na voz do assistente para tipo desconhecido', () => {
        const texto = buildOfflineResponse({ tipo: 'tipo_inexistente', contexto: {} });
        expect(texto).toContain('assistente da escola');
    });
});
