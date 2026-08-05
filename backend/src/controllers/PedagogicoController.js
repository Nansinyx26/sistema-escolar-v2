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
        const insights = await PedagogicoService.getGlobalInsights(req.escolaId);
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

        const prompt = withPersona(`Crie um plano de aula COMPLETO e pronto para usar, em HTML simples (apenas h3, h4, p, ul, li, strong; sem body/html/style), para uma escola pública municipal brasileira.

DADOS DA AULA:
- Disciplina: ${materia}
- Ano/Turma: ${ano}
- Tema: ${tema}
- Objetivos do professor: ${objetivos || 'a seu critério, alinhados à BNCC'}

ESTRUTURA OBRIGATÓRIA (nesta ordem, com h3 em cada seção):
1. Objetivos de aprendizagem: 3 a 4, iniciando com verbos de ação, alinhados à BNCC (cite o código da habilidade apenas quando tiver certeza; não invente códigos).
2. Duração e organização: tempo sugerido por etapa (ex.: 50 min divididos).
3. Metodologia passo a passo: abertura (engajamento), desenvolvimento e fechamento, indicando o que o PROFESSOR faz e o que os ALUNOS fazem.
4. Recursos: apenas materiais viáveis em escola pública (quadro, papel, itens do cotidiano).
5. Avaliação: como verificar a aprendizagem NESTA aula (rápida e observável) + 1 tarefa opcional.
6. Adaptação inclusiva: 1 sugestão para alunos com dificuldade e 1 para alunos avançados.

Tom: prático e direto, escrito PARA o professor. Português-BR.`);

        try {
            const planoHtml = await voiceService.generateInsightText(prompt, { maxOutputTokens: 1400 });
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

        const [prediction, notasAluno] = await Promise.all([
            PedagogicoService.predictFinalGrade(alunoId),
            Nota.find({ alunoId: String(alunoId) }).lean(),
        ]);

        // Médias reais por matéria: o PEI ataca as dificuldades DESTE aluno
        const porMateria = {};
        for (const n of notasAluno) {
            const mat = n.materiaId || n.materia || 'Geral';
            const val = parseFloat(n.nota);
            if (isNaN(val)) continue;
            if (!porMateria[mat]) porMateria[mat] = { soma: 0, qtd: 0 };
            porMateria[mat].soma += val;
            porMateria[mat].qtd += 1;
        }
        const mediasMaterias = Object.entries(porMateria)
            .map(([mat, agg]) => ({ mat, media: agg.soma / agg.qtd }))
            .sort((a, b) => a.media - b.media);
        const fracas = mediasMaterias.filter(m => m.media < 6).map(m => `${m.mat} (média ${m.media.toFixed(1)})`);
        const fortes = mediasMaterias.filter(m => m.media >= 7).map(m => `${m.mat} (média ${m.media.toFixed(1)})`);

        const prompt = withPersona(`Crie um Plano de Estudos Individualizado (PEI) prático, em HTML simples (apenas h3, h4, p, ul, li, strong; sem body/html/style), para o aluno abaixo.

DADOS REAIS DO ALUNO (use somente estes; nunca invente notas):
- Nome: ${al.nome} | Turma: ${al.turma || '-'}
- Matérias com dificuldade: ${fracas.length ? fracas.join(', ') : 'nenhuma abaixo de 6 registrada'}
- Pontos fortes: ${fortes.length ? fortes.join(', ') : 'sem médias acima de 7 registradas'}
- Tendência prevista de nota: ${prediction.prediction || 'sem dados suficientes'} (${prediction.trend})
- Objetivo do professor/responsável: ${objetivos || 'melhorar o desempenho geral'}

ESTRUTURA OBRIGATÓRIA (h3 em cada seção):
1. Diagnóstico: 2 frases sobre a situação atual citando as matérias e médias reais acima.
2. Metas para 4 semanas: 2 a 3 metas mensuráveis (ex.: subir a média de X de 5.2 para 6.5).
3. Rotina semanal de estudos: lista dia da semana com matéria e atividade de 30-40 min, priorizando as matérias com dificuldade.
4. Estratégias por matéria: para CADA matéria com dificuldade, 2 técnicas concretas de estudo adequadas à idade.
5. Acompanhamento: como o responsável verifica o progresso a cada semana, sem ferramentas pagas.

Tom: encorajador e realista. Português-BR.`);

        try {
            const planoHtml = await voiceService.generateInsightText(prompt, { maxOutputTokens: 1400 });
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

        // Enriquecimento em memória (as notas já foram buscadas):
        // médias por matéria e quantos alunos estão abaixo de 6
        const porMateriaTurma = {};
        const porAluno = {};
        for (const n of notas) {
            const val = parseFloat(n.nota);
            if (isNaN(val)) continue;
            const mat = n.materiaId || n.materia || 'Geral';
            if (!porMateriaTurma[mat]) porMateriaTurma[mat] = { soma: 0, qtd: 0 };
            porMateriaTurma[mat].soma += val;
            porMateriaTurma[mat].qtd += 1;
            const aid = String(n.alunoId);
            if (!porAluno[aid]) porAluno[aid] = { soma: 0, qtd: 0 };
            porAluno[aid].soma += val;
            porAluno[aid].qtd += 1;
        }
        const materiasTurma = Object.entries(porMateriaTurma)
            .map(([mat, agg]) => `${mat}: ${(agg.soma / agg.qtd).toFixed(1)}`)
            .join(', ') || 'sem notas lançadas';
        const alunosAbaixo6 = Object.values(porAluno).filter(a => (a.soma / a.qtd) < 6).length;

        const prompt = withPersona(`Você escreve o insight pedagógico da turma no painel de BI da direção. Nunca mencione Gemini, Google ou IA.

DADOS REAIS DA TURMA ${turmaId} (use somente estes números):
- Alunos: ${alunos.length} | Média geral: ${mediaGeral.toFixed(1)} | Frequência: ${frequencia.toFixed(1)}%
- Médias por matéria: ${materiasTurma}
- Alunos com média abaixo de 6.0: ${alunosAbaixo6}

Escreva em Português-BR, texto puro, em NO MÁXIMO 4 frases:
1. Diagnóstico direto da turma (cite a matéria mais fraca pelos números acima).
2. O risco concreto se nada for feito.
3-4. Duas ações práticas e específicas para esta turma nesta semana.`);

        try {
            const insight = await voiceService.generateInsightText(prompt, { maxOutputTokens: 400, temperature: 0.5 });
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