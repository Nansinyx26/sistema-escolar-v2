const FrequenciaProfessor = require('../models/FrequenciaProfessor');
const Falta = require('../models/Falta');
const Config = require('../models/Config');

exports.create = async (req, res) => {
    try {
        const { data, nomeProfessor, professorId, disciplina, escola, classe, quantidadeAulas, observacao } = req.body;

        // Validation
        if (!nomeProfessor || !disciplina || !escola || !classe || !quantidadeAulas) {
            return res.status(400).json({ success: false, error: 'Campos obrigatórios faltando.' });
        }

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
            nomeProfessor,
            professorId,
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

        const list = await FrequenciaProfessor.find(filter).sort({ data: -1 });
        res.json({ success: true, data: list });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};


exports.listPendencias = async (req, res) => {
    try {
        const { professorName } = req.query;
        if (!professorName) return res.status(400).json({ success: false, error: 'Nome do professor é obrigatório' });

        // 1. Busca todas as aulas registradas pelo professor
        const DATA_IMPLANTACAO = new Date('2025-01-01'); // Ajuste conforme necessidade ou use Date.now() fixo no código se for deploy "hoje"
        // Para garantir que não pegamos o passado sujo, filtramos:
        const filter = {
            nomeProfessor: professorName,
            createdAt: { $gte: DATA_IMPLANTACAO } // Só valida pendências de aulas criadas APÓS a implantação
            // Se quisesse usar data da aula: data: { $gte: DATA_IMPLANTACAO }
        };
        const aulas = await FrequenciaProfessor.find(filter);

        const pendencias = [];

        // 2. Para cada aula, verifica se existe registro de frequência de alunos
        // Isso pode ser pesado se tiver milhares. Ideal seria aggregation.
        // Como MVP, faremos loop controlado.

        for (const aula of aulas) {
            // Define range do dia da aula para buscar Faltas
            const start = new Date(aula.data); start.setHours(0, 0, 0, 0);
            const end = new Date(aula.data); end.setHours(23, 59, 59, 999);

            // Conta quantos registros de Attendance existem para essa turma nesse dia
            // Attendance model tem campos: turma (String), data (Date)
            const count = await Falta.countDocuments({
                turma: aula.classe, // "1A"
                data: { $gte: start, $lte: end }
                // Pode adicionar materia se Attendance tiver esse campo populado corretamente
                // materia: aula.disciplina 
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
