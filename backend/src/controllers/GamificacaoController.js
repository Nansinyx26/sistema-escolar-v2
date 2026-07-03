const Badge = require('../models/Badge');
const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const logger = require('../utils/logger');

/**
 * GamificacaoController - Gerencia conquistas e insígnias
 */
exports.recalcularBadges = async (req, res) => {
    try {
        const { alunoId } = req.params;
        const al = await Aluno.findById(alunoId).lean();
        if (!al) return res.status(404).json({ success: false, error: 'Aluno não encontrado' });

        const conquistas = [];

        // 1. Verificação de Presença (EXCELÊNCIA EM ASSIDUIDADE)
        const totalFaltas = await Falta.countDocuments({ 
            $or: [{ aluno: String(alunoId) }, { aluno: alunoId }],
            presente: false
        });
        
        if (totalFaltas === 0) {
            conquistas.push({
                tipo: 'PRESENCA',
                nivel: 3,
                titulo: 'Sentinela da Escola',
                descricao: '100% de presença registrada no sistema.',
                icone: 'bi-shield-check'
            });
        } else if (totalFaltas < 5) {
            conquistas.push({
                tipo: 'PRESENCA',
                nivel: 1,
                titulo: 'Assíduo',
                descricao: 'Faltas mínimas registradas.',
                icone: 'bi-check-circle'
            });
        }

        // 2. Verificação de Notas (EXCELÊNCIA ACADÊMICA)
        const notas = await Nota.find({ alunoId: String(alunoId) }).select('nota').lean();
        const nums = notas.map(n => parseFloat(n.nota)).filter(v => !isNaN(v));
        const media = nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;

        if (media >= 9.5) {
            conquistas.push({
                tipo: 'EXCELENCIA',
                nivel: 3,
                titulo: 'Mestre do Conhecimento',
                descricao: 'Média geral superior a 9.5.',
                icone: 'bi-stars'
            });
        } else if (media >= 8.5) {
            conquistas.push({
                tipo: 'EXCELENCIA',
                nivel: 2,
                titulo: 'Estudante de Elite',
                descricao: 'Média geral superior a 8.5.',
                icone: 'bi-award'
            });
        }

        // 3. Salvar/Atualizar no Banco
        for (const c of conquistas) {
            try {
                await Badge.findOneAndUpdate(
                    { alunoId: String(alunoId), tipo: c.tipo, nivel: c.nivel },
                    { ...c, alunoId: String(alunoId) },
                    { upsate: true, new: true, upsert: true }
                );
            } catch (err) {
                // Ignora erros de duplicidade (único)
            }
        }

        const badgesAtuais = await Badge.find({ alunoId: String(alunoId) }).sort({ nivel: -1 }).lean();
        res.json({ success: true, data: badgesAtuais });

    } catch (error) {
        logger.error(`[Gamificacao] Erro: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro ao processar conquistas.' });
    }
};

exports.getBadgesAluno = async (req, res) => {
    try {
        const { alunoId } = req.params;
        const data = await Badge.find({ alunoId: String(alunoId) }).sort({ nivel: -1 }).lean();
        res.json({ success: true, data });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
};
