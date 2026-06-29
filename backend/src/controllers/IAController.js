const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const Professor = require('../models/Professor');
const Comunicado = require('../models/Comunicado');
const GradeHoraria = require('../models/GradeHoraria');
const PedagogicoService = require('../services/PedagogicoService');
const logger = require('../utils/logger');
const ChatMensagem = require('../models/ChatMensagem');
const voiceService = require('../services/voiceService');
const ChatbotService = require('../services/ChatbotService');

// ─── Helpers de dados e Processamento ──────────────────────────────────────────

/** 
 * Verifica se a mensagem contém pelo menos uma palavra de um conjunto de termos
 */
function matchKeywords(msg, keywords) {
    return keywords.some(k => msg.includes(k.toLowerCase()));
}

const subjectTranslations = {
    'Math': 'Matemática',
    'Physics': 'Física',
    'Chemistry': 'Química',
    'History': 'História',
    'Geography': 'Geografia',
    'English': 'Inglês',
    'Biology': 'Biologia',
    'Portuguese': 'Português',
    'Arts': 'Artes',
    'Science': 'Ciências'
};

function translateSubject(s) {
    return subjectTranslations[s] || s;
}

/**
 * Detecta risco de abandono (evasão) baseado em padrões de faltas
 */
async function detectDropoutRisk(alunoId) {
    const faltas = await Falta.find({
        $or: [{ aluno: String(alunoId) }, { aluno: alunoId }]
    }).sort({ data: -1 }).limit(10).lean();

    if (faltas.length === 0) return { risk: 'baixo', reason: 'Sem faltas registradas' };

    const consecutivas = faltas.slice(0, 3).every(f => !f.presente);
    if (consecutivas && faltas.length >= 3) {
        return { risk: 'crítico', reason: '3 faltas consecutivas detectadas nos últimos dias' };
    }

    const totalFaltas = faltas.filter(f => !f.presente).length;
    const frequencia = ((faltas.length - totalFaltas) / faltas.length) * 100;

    if (frequencia < 70) return { risk: 'alto', reason: `Frequência recente de ${frequencia.toFixed(0)}% está muito baixa` };
    if (frequencia < 85) return { risk: 'médio', reason: 'Frequência em declínio gradual' };

    return { risk: 'baixo', reason: 'Frequência regular' };
}

/**
 * IAController - Inteligência Pedagógica (Redesign 3.0)
 */

exports.analisarDesempenho = async(req, res) => {
    try {
        const { alunoId } = req.params;
        const al = await Aluno.findById(alunoId).lean();
        if (!al) return res.status(404).json({ success: false, error: 'Aluno não encontrado' });

        const [notas, faltas] = await Promise.all([
            Nota.find({ alunoId }).sort({ data: 1 }).lean(),
            Falta.find({ aluno: alunoId }).lean()
        ]);

        const notasNumericas = notas.map(n => parseFloat(n.nota)).filter(v => !isNaN(v));
        let tendencia = 'estavel';
        let status = 'verde';
        let insight = 'Desempenho dentro do esperado.';

        if (notasNumericas.length >= 2) {
            const recentes = notasNumericas.slice(-2);
            const anteriores = notasNumericas.slice(0, -2);
            const mediaRecente = recentes.reduce((a, b) => a + b, 0) / recentes.length;
            const mediaAnterior = anteriores.length > 0 ? (anteriores.reduce((a, b) => a + b, 0) / anteriores.length) : mediaRecente;

            if (mediaRecente < mediaAnterior - 1.5) { tendencia = 'queda';
                status = 'vermelho';
                insight = 'Queda significativa de rendimento.'; } else if (mediaRecente < mediaAnterior - 0.5) { tendencia = 'alerta';
                status = 'amarelo';
                insight = 'Leve queda de rendimento.'; } else if (mediaRecente > mediaAnterior + 0.5) { tendencia = 'subida';
                insight = 'Evolução positiva detectada!'; }
        }

        const totalAulas = faltas.length;
        const totalFaltas = faltas.filter(f => !f.presente).length;
        const frequencia = totalAulas > 0 ? ((totalAulas - totalFaltas) / totalAulas) * 100 : 100;

        if (frequencia < 75) { status = 'vermelho';
            insight += ' Alerta: Frequência crítica (<75%).'; } else if (frequencia < 85) { if (status !== 'vermelho') status = 'amarelo';
            insight += ' Frequência em observação.'; }

        const prediction = await PedagogicoService.predictFinalGrade(alunoId);

        res.json({
            success: true,
            data: {
                aluno: al.nome,
                status,
                tendencia,
                metrics: {
                    mediaGeral: notasNumericas.length > 0 ? (notasNumericas.reduce((a, b) => a + b, 0) / notasNumericas.length).toFixed(1) : '-',
                    frequencia: `${frequencia.toFixed(1)}%`,
                    prediction: prediction.prediction
                },
                analise: insight,
                sugestao: status === 'vermelho' ? 'Reunião com responsáveis e reforço.' : 'Monitoramento contínuo.'
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Geração de Insights Globais para o Dashboard BI
 */
exports.getGlobalInsights = async(req, res) => {
    try {
        const insights = await PedagogicoService.getGlobalInsights();
        res.json({ success: true, data: insights });
    } catch (error) {
        logger.error(`[IAController] Error in getGlobalInsights: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro ao gerar insights pedagógicos.' });
    }
};

/**
 * Chatbot Inteligente - Integrado com Gemini
 */
exports.chatbot = async(req, res) => {
    try {
        let { message, alunoId } = req.body;
        const perfil = (req.user?.perfil || '').toLowerCase();
        const userId = req.user?.id || req.user?._id;
        const nomeUsuario = req.user?.nome || 'Usuário';

        // 16.1 — validate message
        if (!message || !message.trim()) {
            return res.status(400).json({ success: false, error: 'Mensagem vazia.' });
        }

        // 16.2 — validate perfil
        if (!perfil) {
            return res.status(403).json({ success: false, error: 'Perfil de usuário não autorizado.' });
        }

        // 16.4 — truncate message if > 1000 chars
        if (message.length > 1000) {
            logger.warn(`[Chatbot] Mensagem truncada de ${message.length} para 1000 chars`);
            message = message.substring(0, 1000);
        }

        // 17.1 — delegate to ChatbotService
        const { response, alunoId: resolvedAlunoId, options } = await ChatbotService.process({
            message,
            alunoId,
            perfil,
            userId,
            nomeUsuario,
            userEmail: req.user?.email,
        });
        logger.warn(`[IAController] response="${response?.substring(0,60)}" options=${JSON.stringify(options)}`);

        // 15.1 — persist history (silent failure per 15.2)
        const perfilParaSalvar = ['admin', 'diretor', 'professor', 'responsavel'].includes(perfil) ?
            perfil :
            'admin';
        await ChatMensagem.create({
            usuarioId: String(userId),
            usuarioPerfil: perfilParaSalvar,
            usuarioNome: nomeUsuario,
            alunoId: resolvedAlunoId || null,
            pergunta: message,
            resposta: response,
        }).catch(e => logger.warn(`[Chatbot] Erro ao salvar histórico: ${e.message}`));

        // 17.1 — return response (inclui options quando houver ambiguidade)
        return res.json({ success: true, data: { response, alunoId: resolvedAlunoId, options: options || null } });

    } catch (error) {
        // 16.3 — catch-all; no stack trace exposed
        logger.error(`[Chatbot] Erro: ${error.message}`);
        return res.status(500).json({ success: false, error: 'Não foi possível processar sua pergunta. Tente novamente.' });
    }
};

// ─── GERAÇÃO COM GEMINI ───────────────────────────────────────────────────────

exports.gerarPlanoAula = async(req, res) => {
    try {
        const { tema, materia, ano, objetivos } = req.body;
        if (!tema || !materia || !ano) return res.status(400).json({ success: false, error: 'Campos obrigatórios ausentes.' });

        const prompt = `Gere um plano de aula em HTML (sem tags body/html) para: ${materia}, ${ano}, Tema: ${tema}. Objetivos: ${objetivos || 'Gerais'}. Inclua Metodologia, Recursos e Avaliação.`;
        const planoHtml = await voiceService.generateInsightText(prompt);
        res.json({ success: true, data: { planoHtml } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.gerarPlanoEstudo = async(req, res) => {
    try {
        const { alunoId, objetivos } = req.body;
        const al = await Aluno.findById(alunoId).lean();
        if (!al) return res.status(404).json({ success: false, error: 'Aluno não encontrado' });

        const prediction = await PedagogicoService.predictFinalGrade(alunoId);
        const prompt = `Crie um Plano de Estudos Individualizado (PEI) em HTML para o aluno ${al.nome} (${al.turma}). Objetivos: ${objetivos || 'Melhorar notas'}. Predição de nota: ${prediction.prediction || 'N/A'}.`;

        const planoHtml = await voiceService.generateInsightText(prompt);
        res.json({ success: true, data: { planoHtml } });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Analisar desempenho global de uma turma (Diretor/Admin)
 */
exports.analisarTurma = async(req, res) => {
    try {
        const { turmaId } = req.params;

        // 1. Coleta dados da turma
        const alunos = await Aluno.find({ turmaId }).select('_id nome').lean();
        if (alunos.length === 0) return res.status(404).json({ success: false, error: 'Nenhum aluno encontrado nesta turma.' });

        const alunoIds = alunos.map(a => String(a._id));

        const [notas, faltas] = await Promise.all([
            Nota.find({ alunoId: { $in: alunoIds } }).lean(),
            Falta.find({ aluno: { $in: alunoIds } }).lean()
        ]);

        const totalNotas = notas.length;
        const mediaGeral = totalNotas > 0 ? (notas.reduce((acc, n) => acc + (parseFloat(n.nota) || 0), 0) / totalNotas) : 0;

        const totalAulas = faltas.length;
        const totalFaltas = faltas.filter(f => !f.presente).length;
        const frequencia = totalAulas > 0 ? (((totalAulas - totalFaltas) / totalAulas) * 100) : 100;

        // 2. prompt para Gemini
        const prompt = `Analise a Turma ${turmaId}: Média Geral ${mediaGeral.toFixed(1)}, Frequência ${frequencia.toFixed(1)}%. Gere um insight pedagógico curto (máx 3 frases) em Português-BR.`;
        const insight = await voiceService.generateInsightText(prompt);

        res.json({
            success: true,
            data: {
                turmaId,
                metrics: {
                    mediaGeral: mediaGeral.toFixed(1),
                    frequencia: `${frequencia.toFixed(1)}%`,
                    totalAlunos: alunos.length
                },
                insight
            }
        });
    } catch (error) {
        logger.error(`[IAController] Erro em analisarTurma: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro ao analisar a turma.' });
    }
};

/**
 * Gera dados para o Mapa de Calor (Agregação Global)
 * Retorna: [{ materia, turma, media, totalNotas }]
 */
exports.gerarMapaCalor = async(req, res) => {
    try {
        const pipeline = [
            // Garante que nota seja numérica
            { $addFields: { notaNum: { $toDouble: "$nota" } } },
            // Remove documentos onde a conversão falhou (nota inválida)
            { $match: { notaNum: { $ne: null }, materiaId: { $exists: true, $ne: null }, turmaId: { $exists: true, $ne: null } } },
            {
                $group: {
                    _id: { materia: "$materiaId", turma: "$turmaId" },
                    media: { $avg: "$notaNum" },
                    totalNotas: { $sum: 1 }
                }
            },
            { $sort: { "_id.turma": 1, "_id.materia": 1 } }
        ];

        const aggregatedData = await Nota.aggregate(pipeline);

        // Normaliza para o formato esperado pelo frontend
        const data = aggregatedData.map(item => ({
            materia: item._id.materia,
            turma: item._id.turma,
            media: item.media != null ? parseFloat(item.media.toFixed(2)) : 0,
            totalNotas: item.totalNotas || 0
        }));

        logger.info(`[MapaCalor] ${data.length} combinações matéria×turma retornadas.`);
        res.json({ success: true, data });
    } catch (error) {
        logger.error(`[IAController] Erro em gerarMapaCalor: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro ao gerar mapa de calor.' });
    }
};