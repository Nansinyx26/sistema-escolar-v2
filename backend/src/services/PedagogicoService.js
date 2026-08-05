const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const Professor = require('../models/Professor');
const Comunicado = require('../models/Comunicado');
const voiceService = require('./voiceService');
const logger = require('../utils/logger');
const { escolaMatch } = require('../middleware/filtrarPorEscola');

/**
 * PedagogicoService: Camada de serviço para lógica de negócios complexa
 * e agregações de dados para BI e Insights de IA.
 */
class PedagogicoService {

    /**
     * Normaliza IDs obtidos de differentes fontes (Mixed) para String.
     */
    static normalizeId(id) {
        if (!id) return null;
        if (typeof id === 'object' && id.$oid) return id.$oid;
        if (typeof id === 'object' && id._id) return String(id._id);
        return String(id);
    }
    
    /**
     * Calcula a média geral da escola de forma otimizada.
     */
    static async getMediaEscola(ef = {}) {
        const pipeline = [
            { $match: { nota: { $exists: true, $ne: null }, ...ef } },
            { $addFields: { notaNum: { $convert: { input: "$nota", to: "double", onError: null, onNull: null } } } },
            { $match: { notaNum: { $ne: null } } },
            { $group: { _id: null, avg: { $avg: "$notaNum" } } }
        ];
        const result = await Nota.aggregate(pipeline);
        return (result.length > 0 && result[0].avg != null) ? result[0].avg.toFixed(1) : "0";
    }

    /**
     * Identifica alunos com frequência crítica.
     * Centraliza a lógica de "Alerta de Evasão".
     */
    static async getAlunosEmAlertaFrequencia(ef = {}, limit = 50) {
        // Busca todos os ativos (escopados por escola)
        const alunos = await Aluno.find({ ativo: { $ne: false }, ...ef }).select('_id nome turma faltasBimestre').lean();
        const emAlerta = [];

        for (const al of alunos) {
            let totalFaltas = 0;
            if (al.faltasBimestre) {
                const vals = al.faltasBimestre instanceof Map
                    ? Array.from(al.faltasBimestre.values())
                    : Object.values(al.faltasBimestre);
                totalFaltas = vals.reduce((s, v) => s + (Number(v) || 0), 0);
            } else {
                totalFaltas = await Falta.countDocuments({
                    $or: [{ aluno: String(al._id) }, { aluno: al._id }],
                    presente: false
                });
            }
            // Critério de alerta: Mais de 50 faltas (considerando ano letivo de 200 dias)
            if (totalFaltas > limit) {
                emAlerta.push({ ...al, totalFaltas });
            }
        }
        return emAlerta;
    }

    /**
     * Médias de nota agrupadas por turma (uma agregação só).
     */
    static async getMediasPorTurma(ef = {}) {
        const pipeline = [
            { $match: { nota: { $exists: true, $ne: null }, ...ef } },
            { $addFields: { notaNum: { $convert: { input: "$nota", to: "double", onError: null, onNull: null } }, turmaFinal: { $ifNull: ['$turmaId', 'Sem turma'] } } },
            { $match: { notaNum: { $ne: null } } },
            { $group: { _id: '$turmaFinal', media: { $avg: '$notaNum' }, qtdNotas: { $sum: 1 } } },
            { $sort: { media: 1 } },
        ];
        const rows = await Nota.aggregate(pipeline);
        return rows.map(r => ({ turma: r._id, media: r.media != null ? Number(r.media.toFixed(1)) : 0, qtdNotas: r.qtdNotas }));
    }

    /**
     * As N disciplinas com pior desempenho (não só a pior).
     */
    static async getMateriasCriticas(ef = {}, n = 3) {
        const rows = await Nota.aggregate([
            { $match: { nota: { $exists: true, $ne: null }, ...ef } },
            {
                $addFields: {
                    notaNum: { $convert: { input: "$nota", to: "double", onError: null, onNull: null } },
                    materiaFinal: { $ifNull: ['$materiaId', '$materia', 'Geral'] }
                }
            },
            { $match: { notaNum: { $ne: null } } },
            { $group: { _id: '$materiaFinal', media: { $avg: '$notaNum' }, qtd: { $sum: 1 } } },
            { $sort: { media: 1 } },
            { $limit: n }
        ]);
        return rows.map(r => ({ materia: r._id, media: r.media != null ? Number(r.media.toFixed(1)) : 0, qtd: r.qtd }));
    }

    /**
     * Busca a disciplina com desempenho mais baixo (Matéria Crítica).
     */
    static async getMateriaCritica(ef = {}) {
        const heatmapData = await Nota.aggregate([
            { $match: { nota: { $exists: true, $ne: null }, ...ef } },
            {
                $addFields: {
                    notaNum: { $convert: { input: "$nota", to: "double", onError: null, onNull: null } },
                    materiaFinal: { $ifNull: ["$materiaId", "$materia", "Geral"] }
                }
            },
            { $match: { notaNum: { $ne: null } } },
            { $group: { _id: "$materiaFinal", media: { $avg: "$notaNum" } } },
            { $sort: { media: 1 } },
            { $limit: 1 }
        ]);

        if (heatmapData.length === 0 || !heatmapData[0].media) return null;
        return {
            materia: heatmapData[0]._id,
            media: heatmapData[0].media.toFixed(1)
        };
    }

    /**
     * Gera Insights Globais Narrativos (Unificado).
     */
    static async getGlobalInsights(escolaId = null) {
        // Escopo por escola do diretor logado (tolerante a registros legados)
        const ef = escolaMatch(escolaId);

        const [totalAlunos, mediaEscola, alunosAlerta, totalComunicados, materiaCriticaInfo, mediasPorTurma, materiasCriticas] = await Promise.all([
            Aluno.countDocuments({ ativo: { $ne: false }, ...ef }),
            this.getMediaEscola(ef),
            this.getAlunosEmAlertaFrequencia(ef),
            Comunicado.countDocuments({ ativo: true, ...ef }),
            this.getMateriaCritica(ef),
            this.getMediasPorTurma(ef),
            this.getMateriasCriticas(ef, 3)
        ]);

        const turmasEmRisco = mediasPorTurma.filter(t => t.media < 6);
        const melhorTurma = mediasPorTurma.length ? mediasPorTurma[mediasPorTurma.length - 1] : null;
        const piorTurma = mediasPorTurma.length ? mediasPorTurma[0] : null;
        // Nomes de até 5 alunos em alerta — dados REAIS para o insight citar
        const alertaAmostra = alunosAlerta.slice(0, 5).map(a => `${a.nome} (${a.turma || 'sem turma'}, ${a.totalFaltas} faltas)`);

        // Geração do Sumário (Lógica movida do Controller)
        let sumario = `Análise Pedagógica Global finalizada. Atualmente, contamos com **${totalAlunos}** alunos ativos. `;
        sumario += `A média geral da instituição é **${mediaEscola}**, o que indica um desempenho `;
        
        const mediaNum = parseFloat(mediaEscola);
        if (mediaNum >= 8) sumario += "excelente e acima da meta. ";
        else if (mediaNum >= 6) sumario += "estável, dentro dos parâmetros esperados. ";
        else sumario += "preocupante, exigindo intervenção imediata. ";

        if (alunosAlerta.length > 0) {
            sumario += `Identificamos **${alunosAlerta.length}** alunos em zona de risco de evasão devido à baixa frequência. `;
        } else {
            sumario += "A assiduidade dos alunos está exemplar, sem casos críticos de evasão. ";
        }

        if (materiaCriticaInfo) {
            sumario += `A disciplina de **${materiaCriticaInfo.materia}** apresenta o maior desafio no momento, com média de **${materiaCriticaInfo.media}**. `;
        }

        sumario += `Há **${totalComunicados}** comunicados ativos mantendo a comunidade informada. `;
        sumario += "Recomendamos foco em reforço escolar para as turmas com média abaixo de 6.0.";

        // Fallback determinístico com plano de ação concreto
        if (turmasEmRisco.length > 0) {
            sumario += `Turmas com média abaixo de 6.0: ${turmasEmRisco.map(t => `${t.turma} (${t.media})`).join(', ')}. `;
        }

        const fallbackResult = {
            totalAlunos,
            mediaEscola,
            alunosRisco: alunosAlerta.length,
            materiaCritica: materiaCriticaInfo?.materia || "N/A",
            turmasEmRisco: turmasEmRisco.map(t => t.turma),
            melhorTurma: melhorTurma?.turma || null,
            sumario,
            timestamp: new Date()
        };

        try {
            const prompt = `Você é o assistente pedagógico da escola, escrevendo o painel de insights do BI para a DIREÇÃO. Nunca mencione Gemini, Google ou IA.

DADOS REAIS DA ESCOLA (use somente estes números — nunca invente):
- Alunos ativos: ${totalAlunos}
- Média geral: ${mediaEscola}
- Alunos em alerta de evasão (frequência crítica): ${alunosAlerta.length}${alertaAmostra.length ? `
- Casos mais graves: ${alertaAmostra.join('; ')}` : ''}
- Disciplinas com pior desempenho: ${materiasCriticas.map(m => `${m.materia} (média ${m.media})`).join(', ') || 'sem dados'}
- Médias por turma (da pior para a melhor): ${mediasPorTurma.map(t => `${t.turma}: ${t.media}`).join(', ') || 'sem dados'}
- Turmas com média abaixo de 6.0: ${turmasEmRisco.length ? turmasEmRisco.map(t => t.turma).join(', ') : 'nenhuma'}
- Comunicados ativos: ${totalComunicados}

ESCREVA EM PORTUGUÊS-BR, TEXTO PURO (sem markdown), NESTA ESTRUTURA:
1ª linha — visão geral em UMA frase direta (o diretor lê em 5 segundos).
Depois, três blocos curtos separados por quebra de linha:
"Destaques:" 1-2 pontos positivos concretos citando turma/matéria/números reais.
"Pontos de atenção:" 1-3 riscos concretos, citando os alunos/turmas/matérias dos dados (nomes reais quando fornecidos).
"Ações recomendadas:" 2-3 ações práticas e específicas que a direção pode executar esta semana (ex.: convocar responsáveis dos alunos citados, plano de reforço na matéria X para a turma Y). Nada genérico como "melhorar o ensino".

Máximo de 130 palavras no total.`;

            const naturalSummary = await voiceService.generateInsightText(prompt, { maxOutputTokens: 700, temperature: 0.5 });
            if (naturalSummary && naturalSummary.trim().length > 10) {
                return {
                    ...fallbackResult,
                    sumario: naturalSummary.trim()
                };
            }
        } catch (error) {
            logger.warn(`[PedagogicoService] Gemini indisponível para Insights Globais: ${error.message}`);
        }

        return fallbackResult;
    }

    /**
     * Predição de Nota Final (Tendência).
     */
    static async predictFinalGrade(alunoId) {
        const idStr = String(alunoId);
        const notas = await Nota.find({ alunoId: idStr }).sort({ data: 1 }).lean();
        const vals = notas.map(n => parseFloat(n.nota)).filter(v => !isNaN(v));
        
        if (vals.length < 2) return { prediction: null, trend: 'estável', confidence: 'baixa' };
        
        const n = vals.length;
        let totalChange = 0;
        for (let i = 1; i < n; i++) totalChange += (vals[i] - vals[i-1]);
        const avgChange = totalChange / (n - 1);
        const prediction = Math.min(10, Math.max(0, vals[n-1] + avgChange));
        
        let trend = 'estável';
        if (avgChange > 0.5) trend = 'subida';
        else if (avgChange < -0.5) trend = 'queda';
        
        return { 
            prediction: parseFloat(prediction.toFixed(1)), 
            trend, 
            confidence: n > 3 ? 'alta' : 'média' 
        };
    }
}

module.exports = PedagogicoService;
