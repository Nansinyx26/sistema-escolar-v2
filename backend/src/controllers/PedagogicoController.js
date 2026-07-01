const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const PedagogicoService = require('../services/PedagogicoService');
const voiceService = require('../services/voiceService');
const { withPersona } = require('../services/assistantPersona');
const offlineResponseService = require('../services/offlineResponseService');
const logger = require('../utils/logger');

// Opções sugeridas exibidas no front quando a resposta é gerada em modo offline.
const OPCOES_OFFLINE = [
    { label: 'Tentar novamente', action: 'retry' },
    { label: 'Gerar versão simplificada sem IA', action: 'simplificado' },
    { label: 'Ver dados brutos', action: 'dados' },
];

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

            if (mediaRecente < mediaAnterior - 1.5) {
                tendencia = 'queda';
                status = 'vermelho';
                insight = 'Queda significativa de rendimento.';
            } else if (mediaRecente < mediaAnterior - 0.5) {
                tendencia = 'alerta';
                status = 'amarelo';
                insight = 'Leve queda de rendimento.';
            } else if (mediaRecente > mediaAnterior + 0.5) {
                tendencia = 'subida';
                insight = 'Evolução positiva detectada!';
            }
        }

        const totalAulas = faltas.length;
        const totalFaltas = faltas.filter(f => !f.presente).length;
        const frequencia = totalAulas > 0 ? ((totalAulas - totalFaltas) / totalAulas) * 100 : 100;

        if (frequencia < 75) {
            status = 'vermelho';
            insight += ' Alerta: Frequência crítica (<75%).';
        } else if (frequencia < 85) {
            if (status !== 'vermelho') status = 'amarelo';
            insight += ' Frequência em observação.';
        }

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

exports.getGlobalInsights = async(req, res) => {
    try {
        const insights = await PedagogicoService.getGlobalInsights();
        res.json({ success: true, data: insights });
    } catch (error) {
        logger.error(`[PedagogicoController] Error in getGlobalInsights: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro ao gerar insights pedagógicos.' });
    }
};

exports.gerarPlanoAula = async(req, res) => {
    try {
        const { tema, materia, ano, objetivos } = req.body;
        if (!tema || !materia || !ano) return res.status(400).json({ success: false, error: 'Campos obrigatórios ausentes.' });

        const prompt = withPersona(`Gere um plano de aula em HTML (sem tags body/html) para: ${materia}, ${ano}, Tema: ${tema}. Objetivos: ${objetivos || 'Gerais'}. Inclua Metodologia, Recursos e Avaliação.`);

        try {
            const planoHtml = await voiceService.generateInsightText(prompt);
            return res.json({ success: true, data: { planoHtml } });
        } catch (iaError) {
            logger.warn(`[PedagogicoController] IA indisponível em gerarPlanoAula: ${iaError.message} — usando resposta offline.`);
            const planoHtml = offlineResponseService.buildOfflineResponse({
                tipo: 'plano_aula',
                contexto: { materia, ano, tema },
            });
            return res.json({
                success: true,
                data: {
                    planoHtml,
                    modoOffline: true,
                    opcoesSugeridas: OPCOES_OFFLINE,
                },
            });
        }
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
        const prompt = withPersona(`Crie um Plano de Estudos Individualizado (PEI) em HTML para o aluno ${al.nome} (${al.turma}). Objetivos: ${objetivos || 'Melhorar notas'}. Predição de nota: ${prediction.prediction || 'N/A'}.`);

        try {
            const planoHtml = await voiceService.generateInsightText(prompt);
            return res.json({ success: true, data: { planoHtml } });
        } catch (iaError) {
            logger.warn(`[PedagogicoController] IA indisponível em gerarPlanoEstudo: ${iaError.message} — usando resposta offline.`);
            const planoHtml = offlineResponseService.buildOfflineResponse({
                tipo: 'plano_estudo',
                contexto: {
                    aluno: al.nome,
                    turma: al.turma,
                    predicao: prediction.prediction,
                },
            });
            return res.json({
                success: true,
                data: {
                    planoHtml,
                    modoOffline: true,
                    opcoesSugeridas: OPCOES_OFFLINE,
                },
            });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.analisarTurma = async(req, res) => {
    try {
        const { turmaId } = req.params;
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

        const metrics = {
            mediaGeral: mediaGeral.toFixed(1),
            frequencia: `${frequencia.toFixed(1)}%`,
            totalAlunos: alunos.length
        };

        const prompt = withPersona(`Analise a Turma ${turmaId}: Média Geral ${mediaGeral.toFixed(1)}, Frequência ${frequencia.toFixed(1)}%. Gere um insight pedagógico curto (máx 3 frases) em Português-BR.`);

        try {
            const insight = await voiceService.generateInsightText(prompt);
            return res.json({ success: true, data: { turmaId, metrics, insight } });
        } catch (iaError) {
            logger.warn(`[PedagogicoController] IA indisponível em analisarTurma: ${iaError.message} — usando resposta offline.`);
            const insight = offlineResponseService.buildOfflineResponse({
                tipo: 'analise_turma',
                contexto: {
                    turma: turmaId,
                    media: metrics.mediaGeral,
                    frequencia: metrics.frequencia,
                },
            });
            return res.json({
                success: true,
                data: {
                    turmaId,
                    metrics,
                    insight,
                    modoOffline: true,
                    opcoesSugeridas: OPCOES_OFFLINE,
                },
            });
        }
    } catch (error) {
        logger.error(`[PedagogicoController] Erro em analisarTurma: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro ao analisar a turma.' });
    }
};