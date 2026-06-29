const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const Professor = require('../models/Professor');
const Comunicado = require('../models/Comunicado');
const logger = require('../utils/logger');

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
    static async getMediaEscola() {
        const pipeline = [
            { $match: { nota: { $exists: true, $ne: null } } },
            { $addFields: { notaNum: { $toDouble: "$nota" } } },
            { $group: { _id: null, avg: { $avg: "$notaNum" } } }
        ];
        const result = await Nota.aggregate(pipeline);
        return result.length > 0 ? result[0].avg.toFixed(1) : "0";
    }

    /**
     * Identifica alunos com frequência crítica.
     * Centraliza a lógica de "Alerta de Evasão".
     */
    static async getAlunosEmAlertaFrequencia(limit = 50) {
        // Busca todos os ativos
        const alunos = await Aluno.find({ ativo: { $ne: false } }).select('_id nome turma faltasBimestre').lean();
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
     * Busca a disciplina com desempenho mais baixo (Matéria Crítica).
     */
    static async getMateriaCritica() {
        const heatmapData = await Nota.aggregate([
            { $match: { nota: { $exists: true, $ne: null } } },
            { 
                $addFields: { 
                    notaNum: { $toDouble: "$nota" },
                    materiaFinal: { $ifNull: ["$materiaId", "$materia", "Geral"] }
                } 
            },
            { $group: { _id: "$materiaFinal", media: { $avg: "$notaNum" } } },
            { $sort: { media: 1 } },
            { $limit: 1 }
        ]);

        if (heatmapData.length === 0) return null;
        return {
            materia: heatmapData[0]._id,
            media: heatmapData[0].media.toFixed(1)
        };
    }

    /**
     * Gera Insights Globais Narrativos (Unificado).
     */
    static async getGlobalInsights() {
        const [totalAlunos, mediaEscola, alunosAlerta, totalComunicados, materiaCriticaInfo] = await Promise.all([
            Aluno.countDocuments({ ativo: { $ne: false } }),
            this.getMediaEscola(),
            this.getAlunosEmAlertaFrequencia(),
            Comunicado.countDocuments({ ativo: true }),
            this.getMateriaCritica()
        ]);

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

        return {
            totalAlunos,
            mediaEscola,
            alunosRisco: alunosAlerta.length,
            materiaCritica: materiaCriticaInfo?.materia || "N/A",
            sumario,
            timestamp: new Date()
        };
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
