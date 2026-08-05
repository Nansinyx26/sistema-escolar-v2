const FrequenciaProfessor = require('../models/FrequenciaProfessor');
const GradeHoraria = require('../models/GradeHoraria');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');

// Reutilizando helpers (idealmente moveria para utils, mas manterei self-contained por segurança)
const timeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
};

const getDayOfWeek = (date) => date.getDay();

const checkDuplicateClass = async (req, res, next) => {
    try {
        const { nomeProfessor, professorId, turma, classe, disciplina, materia, data } = req.body;

        // 1. Setup da Data/Hora (Com fuso BRT)
        // Se data vier, usar meio-dia para garantir dia correto
        const timeZone = 'America/Sao_Paulo';
        let dataReferencia;
        if (data) {
            dataReferencia = new Date(`${data}T12:00:00`);
        } else {
            const strDate = new Date().toLocaleString("en-US", { timeZone });
            dataReferencia = new Date(strDate);
        }

        const minutosAtuais = dataReferencia.getHours() * 60 + dataReferencia.getMinutes();
        const diaSemana = dataReferencia.getDay();

        // 2. Identificadores
        let targetClasse = turma || classe; // Nome da turma (5D)
        let targetDisciplina = disciplina || materia;
        let targetProfessorId = professorId;

        // Se professorId não vier, tentar buscar pelo nome (mesmo padrão do verifyTimetable)
        if (!targetProfessorId && nomeProfessor) {
            const profDoc = await Professor.findOne({ nome: nomeProfessor });
            if (profDoc) targetProfessorId = profDoc._id;
        }

        // Precisamos encontrar qual é o "Slot" da grade atual para ver se já há registro NELE

        // Resolver turmaId se possível
        let targetTurmaId = null;
        if (targetClasse) {
            const turmaDoc = await Turma.findOne({ nome: targetClasse });
            if (turmaDoc) targetTurmaId = turmaDoc._id;
        }

        if (targetProfessorId) {
            // Query Híbrida de Grade (Igual verifyTimetable)
            const turmaConditions = [];
            if (targetTurmaId) turmaConditions.push({ turmaId: String(targetTurmaId) });
            if (targetClasse) turmaConditions.push({ turmaId: targetClasse });

            const queryGrade = {
                professorId: String(targetProfessorId),
                diaSemana: diaSemana,
                ativo: true,
                $or: turmaConditions.length > 0 ? turmaConditions : [{ turmaId: "NENHUMA" }]
            };

            const grades = await GradeHoraria.find(queryGrade);

            const slotAtual = grades.find(g => {
                const inicio = timeToMinutes(g.horaInicio);
                const fim = timeToMinutes(g.horaFim);
                // Tolerância ou strict? Strict.
                return minutosAtuais >= inicio && minutosAtuais < fim;
            });

            if (slotAtual) {
                // Se existe um slot definido par AGORA, vamos ver se já existe TeacherAttendance
                // cuja 'data' caia dentro deste slot no dia de hoje.

                // Definir range do slot para o dia específico
                const dataSlotInicio = new Date(dataReferencia);
                const [hI, mI] = slotAtual.horaInicio.split(':');
                dataSlotInicio.setHours(hI, mI, 0, 0);

                const dataSlotFim = new Date(dataReferencia);
                const [hF, mF] = slotAtual.horaFim.split(':');
                dataSlotFim.setHours(hF, mF, 0, 0);

                const duplicata = await FrequenciaProfessor.findOne({
                    classe: targetClasse,
                    disciplina: targetDisciplina,
                    data: { $gte: dataSlotInicio, $lte: dataSlotFim }
                });

                if (duplicata) {
                    return res.status(409).json({ // 409 Conflict
                        success: false,
                        error: 'Já existe um registro de aula para esta turma neste horário.'
                    });
                }
            } else {
                // Se não achou slot na grade, o verifyTimetable já deve ter barrado.
                // Mas se passou (ex: admin), verificamos duplicação genérica (mesmo dia/turma/materia)?
                // O prompt diz "neste horário". Se não tem horário definido, difícil validar.
                // Vamos seguir silenciosamente se não bateu grade, pois o verifyTimetable é quem barra permissão.
            }
        }

        next();
    } catch (error) {
        console.error('Erro no checkDuplicateClass:', error);
        // Em caso de erro técnico, melhor não bloquear fluxo crítico ou bloquear?
        // Prompt é "Validação Cruzada". Melhor falhar closed se der erro.
        return res.status(500).json({ success: false, error: 'Erro ao validar duplicidade de aula.' });
    }
};

const ensureClassRecord = async (req, res, next) => {
    try {
        // Validação para Faltas (Attendance)
        // Requer que exista um FrequenciaProfessor prévio
        const { turma, data, materia } = req.body;

        if (!turma || !materia) {
            // Se faltar dados, deixa o controller reclamar ou rejeita?
            // Vamos deixar passar para o controller tratar validação de campos obrigatórios,
            // ou rejeitar aqui se o objetivo é strict.
            // Vamos logar e next(), pois pode ser um update que não tem todos campos.
            // Mas create geralmente tem.
            // Se for POST:
            if (req.method === 'POST') {
                if (!turma || !data || !materia) return next(); // Deixa controller validar schema
            } else {
                return next();
            }
        }

        // Busca registro de aula (FrequenciaProfessor)
        // Matching: Turma (classe) + Materia (disciplina) + Data (Dia)

        let dataBusca = new Date(data);
        const startOfDay = new Date(dataBusca); startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(dataBusca); endOfDay.setHours(23, 59, 59, 999);

        // A lógica "Frequência sempre referencia um registro de aula"
        const aulaExiste = await FrequenciaProfessor.findOne({
            classe: turma,
            disciplina: materia,
            data: { $gte: startOfDay, $lte: endOfDay }
        });

        if (!aulaExiste) {
            return res.status(400).json({
                success: false,
                error: 'Não foi possível registrar a frequência. Nenhuma aula registrada para esta turma/disciplina nesta data.'
            });
        }

        next();

    } catch (error) {
        console.error('Erro no ensureClassRecord:', error);
        return res.status(500).json({ success: false, error: 'Erro ao verificar registro de aula.' });
    }
};

module.exports = { checkDuplicateClass, ensureClassRecord };
