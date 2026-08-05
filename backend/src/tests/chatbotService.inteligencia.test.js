/**
 * chatbotService.inteligencia.test.js
 * Upgrades v2 do cérebro do chatbot:
 *  - classificação insensível a acentos (frequencia == frequência)
 *  - sinônimos e flexões (faltou, prova, recado, docente...)
 *  - prioridade de dados sobre conversa social
 *  - resumo individual do aluno (fetchResumoAluno + formatarResposta)
 */
const {
    classifyIntent,
    formatarResposta,
} = require('../services/ChatbotService');

// ─────────────────────────────────────────────────────────
// Acentos: mensagens digitadas SEM acento devem classificar igual
// (antes caíam todas em INDEFINIDA)
// ─────────────────────────────────────────────────────────
describe('classifyIntent — insensível a acentos', () => {
    it('frequencia sem acento → FALTAS', () => {
        expect(classifyIntent('qual a frequencia do Pedro?')).toBe('FALTAS');
        expect(classifyIntent('qual a frequência do Pedro?')).toBe('FALTAS');
    });

    it('media sem acento → NOTAS', () => {
        expect(classifyIntent('media do Joao no bimestre')).toBe('NOTAS');
        expect(classifyIntent('média do João no bimestre')).toBe('NOTAS');
    });

    it('horario sem acento → HORARIO', () => {
        expect(classifyIntent('qual o horario da turma 3A')).toBe('HORARIO');
    });

    it('reuniao sem acento → COMUNICADOS', () => {
        expect(classifyIntent('tem reuniao marcada?')).toBe('COMUNICADOS');
    });
});

// ─────────────────────────────────────────────────────────
// Sinônimos e flexões novos
// ─────────────────────────────────────────────────────────
describe('classifyIntent — sinônimos e flexões', () => {
    it('flexões de falta (faltou/faltando) → FALTAS', () => {
        expect(classifyIntent('o Pedro faltou ontem?')).toBe('FALTAS');
        expect(classifyIntent('quantas vezes a Ana esteve ausente')).toBe('FALTAS');
    });

    it('prova/avaliação → NOTAS', () => {
        expect(classifyIntent('quanto a Maria tirou na prova?')).toBe('NOTAS');
        expect(classifyIntent('resultado da avaliação de ciencias')).toBe('NOTAS');
    });

    it('recado/notícia → COMUNICADOS', () => {
        expect(classifyIntent('algum recado da escola?')).toBe('COMUNICADOS');
        expect(classifyIntent('tem noticia nova?')).toBe('COMUNICADOS');
    });

    it('docente / quem dá aula → PROFESSORES', () => {
        expect(classifyIntent('quem da aula de matematica?')).toBe('PROFESSORES');
        expect(classifyIntent('lista de docentes')).toBe('PROFESSORES');
    });

    it('como está/como anda → RESUMO_GERAL', () => {
        expect(classifyIntent('como anda o Pedro?')).toBe('RESUMO_GERAL');
        expect(classifyIntent('panorama da escola')).toBe('RESUMO_GERAL');
    });
});

// ─────────────────────────────────────────────────────────
// Prioridade: pedido de dados vence saudação na mesma frase
// ─────────────────────────────────────────────────────────
describe('classifyIntent — prioridade de dados sobre social', () => {
    it('saudação + pedido de notas → NOTAS', () => {
        expect(classifyIntent('bom dia! quais as notas do Joao?')).toBe('NOTAS');
    });

    it('comportamentos originais preservados', () => {
        expect(classifyIntent('olá')).toBe('SAUDACAO');
        expect(classifyIntent('oi, tudo bem?')).toBe('SAUDACAO');
        expect(classifyIntent('obrigado!')).toBe('AGRADECIMENTO');
        expect(classifyIntent('asdf')).toBe('INDEFINIDA');
        expect(classifyIntent('notas do João')).toBe('NOTAS');
        expect(classifyIntent('faltas do Pedro')).toBe('FALTAS');
    });

    it('"oi" não dispara em palavras que contêm oi (foi/coisa)', () => {
        expect(classifyIntent('foi cancelada a coisa?')).not.toBe('SAUDACAO');
    });
});

// ─────────────────────────────────────────────────────────
// Resumo individual do aluno (formatarResposta)
// ─────────────────────────────────────────────────────────
describe('formatarResposta — RESUMO_GERAL individual', () => {
    it('monta resumo do aluno com médias, destaque e alerta de frequência', () => {
        const resposta = formatarResposta({
            intencao: 'RESUMO_GERAL',
            aluno: { nome: 'Ana Souza' },
            perfil: 'responsavel',
            dados: {
                resumoAluno: true,
                media: 7.25,
                totalNotas: 8,
                melhorMateria: { materia: 'História', media: 9.0 },
                piorMateria: { materia: 'Matemática', media: 5.2 },
                frequencia: 72.0,
                totalRegistros: 50,
                faltas: 14,
                alertaCritico: true,
                alertaObservacao: false,
            },
        });
        expect(resposta).toContain('Resumo de Ana Souza');
        expect(resposta).toContain('7.3');
        expect(resposta).toContain('História');
        expect(resposta).toContain('Matemática');
        expect(resposta).toContain('CRÍTICA');
    });

    it('sem dados de aluno mantém o resumo da escola', () => {
        const resposta = formatarResposta({
            intencao: 'RESUMO_GERAL',
            aluno: null,
            perfil: 'diretor',
            dados: { mediaEscola: 6.8, frequenciaGlobal: 91.2, totalComunicadosAtivos: 4 },
        });
        expect(resposta).toContain('Resumo da escola');
        expect(resposta).toContain('6.8');
    });
});
