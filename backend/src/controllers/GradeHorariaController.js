const GradeHoraria = require('../models/GradeHoraria');
const mongoose = require('mongoose');

// Helper para converter "HH:mm" em minutos desde meia-noite
const timeToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
};

module.exports = {
    // 1. Criar novo item de grade
    create: async (req, res) => {
        try {
            const { professorId, turmaId, disciplina, diaSemana, horaInicio, horaFim, aulasSeguidas } = req.body;

            // Validação simples de sobreposição poderia ser adicionada aqui

            const novaGrade = await GradeHoraria.create({
                professorId,
                turmaId,
                disciplina,
                diaSemana,
                horaInicio,
                horaFim,
                aulasSeguidas
            });

            return res.status(201).json({ success: true, data: novaGrade });
        } catch (error) {
            console.error('Erro ao criar grade:', error);
            return res.status(500).json({ success: false, error: 'Erro ao criar grade horária: ' + error.message });
        }
    },

    // 2. Listar grade (filtro opcional por professor ou turma)
    list: async (req, res) => {
        try {
            const { professorId, turmaId } = req.query;
            const query = { ativo: { $ne: false } };

            if (professorId) query.professorId = professorId;
            if (turmaId) query.turmaId = turmaId;

            const grade = await GradeHoraria.find(query)
                .populate('professorDetails', 'nome email')
                .populate('turmaDetails', 'nome ano turno')
                .lean();

            const normalizedGrade = grade.map(g => ({
                ...g,
                id: g.id || g._id
            }));

            return res.json({ success: true, data: normalizedGrade });
        } catch (error) {
            console.error('Erro ao listar grade:', error);
            return res.status(500).json({ success: false, error: 'Erro ao listar grade' });
        }
    },

    // 3. SEMÁFORO: Validação em Tempo Real
    validarPermissaoAgora: async (req, res) => {
        try {
            const { professorId, turmaId } = req.query; // Recebendo turmaId para comparação direta
            if (!professorId) {
                return res.status(400).json({ success: false, error: 'ProfessorID é obrigatório' });
            }

            // Timezone Setup
            const agora = new Date();
            const timeZone = 'America/Sao_Paulo';
            const strDate = agora.toLocaleString("en-US", { timeZone });
            const agoraLocal = new Date(strDate);

            const diaSemanaAtual = agoraLocal.getDay();
            const horas = agoraLocal.getHours();
            const minutos = agoraLocal.getMinutes();
            const minutosAtuais = horas * 60 + minutos;

            console.log(`[Validar] Prof: ${professorId}, TurmaAlvo: ${turmaId}, Dia: ${diaSemanaAtual}, Hora: ${horas}:${minutos}`);

            // 1. Busca TODAS as grades deste professor para HOJE e para a TURMA específica
            // Assim permitimos que ele lance retroativamente no mesmo dia
            const query = {
                professorId,
                diaSemana: diaSemanaAtual,
                ativo: { $ne: false }
            };

            // Se a turmaId foi enviada, filtramos por ela também
            if (turmaId) {
                query.turmaId = String(turmaId);
            }

            const gradesTurmaHoje = await GradeHoraria.find(query);

            if (gradesTurmaHoje.length > 0) {
                // Existe grade para esta turma hoje! 
                // Agora verificamos se ALGUMA delas bate com o horário atual (com tolerância)

                const aulaNoHorario = gradesTurmaHoje.find(g => {
                    const inicio = timeToMinutes(g.horaInicio);
                    const fim = timeToMinutes(g.horaFim);
                    return minutosAtuais >= (inicio - 15) && minutosAtuais < (fim + 15);
                });

                // Se houver aula no horário, é permissão total/standard
                // Se não houver, permitimos mas sinalizamos que é retroativo
                const aulaReferencia = aulaNoHorario || gradesTurmaHoje[0];

                return res.json({
                    success: true,
                    permitido: true,
                    tipo: aulaNoHorario ? 'horario_exato' : 'retroativo_hoje',
                    mensagem: aulaNoHorario ? 'Horário confirmado na grade.' : 'Grade identificada para hoje (lançamento retroativo).',
                    detalhes: {
                        disciplina: aulaReferencia.disciplina,
                        turma: String(aulaReferencia.turmaId),
                        horaInicio: aulaReferencia.horaInicio,
                        horaFim: aulaReferencia.horaFim,
                        aulasSeguidas: aulaReferencia.aulasSeguidas || 1
                    }
                });
            } else {
                console.log(`[Validar] Nenhuma grade para Prof ${professorId} na Turma ${turmaId} no Dia ${diaSemanaAtual}`);
                return res.json({
                    success: true,
                    permitido: false,
                    mensagem: 'Você não possui aula agendada com esta turma para hoje.',
                    horarioAtual: `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}`,
                    diaSemana: diaSemanaAtual
                });
            }

        } catch (error) {
            console.error('Erro na validação de permissão:', error);
            // Retorna detalhes do erro para o front (ajuda no debug)
            return res.status(500).json({ success: false, error: 'Erro interno: ' + error.message });
        }
    },

    // Deletar item de grade
    delete: async (req, res) => {
        try {
            const { id } = req.params;
            await GradeHoraria.findByIdAndUpdate(id, { ativo: false });
            return res.json({ success: true, message: 'Grade removida (soft delete)' });
        } catch (error) {
            return res.status(500).json({ success: false, error: 'Erro ao deletar' });
        }
    }
};
