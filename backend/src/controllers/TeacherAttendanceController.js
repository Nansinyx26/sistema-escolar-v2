const FrequenciaProfessor = require('../models/FrequenciaProfessor');
const Falta = require('../models/Falta');
const Config = require('../models/Config');
const Professor = require('../models/Professor');

exports.create = async (req, res) => {
    try {
        const { data, nomeProfessor, professorId, disciplina, escola, classe, quantidadeAulas, observacao } = req.body;

        // Validation
        if (!disciplina || !escola || !classe || !quantidadeAulas) {
            return res.status(400).json({ success: false, error: 'Campos obrigatórios faltando.' });
        }

        let finalProfId = professorId;
        let finalProfName = nomeProfessor;

        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR e Spoofing) ---
        if (req.user && req.user.perfil === 'professor') {
            const prof = await Professor.findOne({ email: req.user.email }).lean();
            if (!prof) {
                return res.status(403).json({ success: false, error: 'Perfil de professor não encontrado para o usuário logado.' });
            }

            // Força os dados reais do professor autenticado
            finalProfId = prof._id.toString();
            finalProfName = prof.nome;

            // Valida se a turma (classe) pertence às turmas permitidas do professor
            const allowed = req.allowedTurmas || [];
            if (!allowed.includes(classe)) {
                return res.status(403).json({ 
                    success: false, 
                    error: `Acesso negado. Você não tem permissão para registrar aulas para a turma ${classe}.` 
                });
            }
        }
        
        if (!finalProfName) {
            return res.status(400).json({ success: false, error: 'Nome do professor é obrigatório.' });
        }
        // -------------------------------------------------------------------------

        // --- TRAVA DE SEGURANÇA: Exigir Chamada de Alunos ---
        const config = await Config.findOne();
        if (config && config.exigirChamadaAntesDeAula) {
            const dataAula = data ? new Date(data) : new Date();
            const start = new Date(dataAula); start.setHours(0, 0, 0, 0);
            const end = new Date(dataAula); end.setHours(23, 59, 59, 999);

            // Verifica se existe algum registro de frequência para esta turma e matéria no dia
            const temChamada = await Falta.findOne({
                turma: classe,
                materia: disciplina,
                data: { $gte: start, $lte: end }
            });

            if (!temChamada) {
                return res.status(403).json({
                    success: false,
                    code: 'CHAMADA_PENDENTE',
                    error: `A frequência dos alunos para a turma ${classe} (${disciplina}) ainda não foi lançada hoje. Realize a chamada antes de registrar a aula.`
                });
            }
        }

        const attendance = await FrequenciaProfessor.create({
            data: data ? new Date(data) : new Date(),
            nomeProfessor: finalProfName,
            professorId: finalProfId,
            disciplina,
            escola,
            classe,
            quantidadeAulas,
            observacao
        });

        res.json({ success: true, data: attendance, message: 'Frequência lançada com sucesso!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.list = async (req, res) => {
    try {
        const { professor, dataInicio, dataFim } = req.query;
        const filter = {};

        if (professor) filter.nomeProfessor = professor;
        if (dataInicio && dataFim) {
            filter.data = { $gte: new Date(dataInicio), $lte: new Date(dataFim) };
        }

        // --- SEGURANÇA: Verificação Horizontal para Professor (Prevenção IDOR) ---
        if (req.user && req.user.perfil === 'professor') {
            const prof = await Professor.findOne({ email: req.user.email }).lean();
            if (prof) {
                // Restringe a busca apenas às aulas do próprio professor
                filter.professorId = prof._id.toString();
            } else {
                filter.professorId = "ACESSO_NEGADO";
            }
        }
        // -------------------------------------------------------------------------

        const list = await FrequenciaProfessor.find(filter).sort({ data: -1 });
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.listPendencias = async (req, res) => {
    try {
        let { professorName } = req.query;

        // --- SEGURANÇA: Força o nome do próprio professor se logado como professor ---
        if (req.user && req.user.perfil === 'professor') {
            const prof = await Professor.findOne({ email: req.user.email }).lean();
            if (!prof) {
                return res.status(403).json({ success: false, error: 'Perfil de professor não encontrado.' });
            }
            professorName = prof.nome;
        }

        if (!professorName) return res.status(400).json({ success: false, error: 'Nome do professor é obrigatório' });

        // 1. Busca todas as aulas registradas pelo professor
        const DATA_IMPLANTACAO = new Date('2025-01-01');
        const filter = {
            nomeProfessor: professorName,
            createdAt: { $gte: DATA_IMPLANTACAO }
        };
        const aulas = await FrequenciaProfessor.find(filter);

        const pendencias = [];

        for (const aula of aulas) {
            const start = new Date(aula.data); start.setHours(0, 0, 0, 0);
            const end = new Date(aula.data); end.setHours(23, 59, 59, 999);

            const count = await Falta.countDocuments({
                turma: aula.classe,
                data: { $gte: start, $lte: end }
            });

            if (count === 0) {
                pendencias.push({
                    data: aula.data,
                    turma: aula.classe,
                    disciplina: aula.disciplina,
                    mensagem: 'Aula registrada sem frequência de alunos lançada.'
                });
            }
        }

        return res.json({
            success: true,
            totalAulas: aulas.length,
            totalPendencias: pendencias.length,
            pendencias
        });

    } catch (error) {
        console.error('Erro ao listar pendências:', error);
        return res.status(500).json({ success: false, error: 'Erro ao verificar pendências.' });
    }
};
