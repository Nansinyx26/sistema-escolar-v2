const GradeHoraria = require('../models/GradeHoraria');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');

// Helper to convert time "HH:mm" to minutes
const timeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
};

// Helper for days (0=Sunday to 6=Saturday)
const getDayOfWeek = (date) => {
    const d = new Date(date);
    return d.getDay();
};

const verifyTimetable = async (req, res, next) => {
    try {
        // 1. Identificar Data e Hora (Com Fuso Correto BRT)

        let dataInput = req.body.data; // Esperado YYYY-MM-DD
        const timeZone = 'America/Sao_Paulo';
        let agoraLocal;

        if (dataInput) {
            // Se veio data manual (ex: 2025-12-17), usamos "meio-dia" para evitar virada utc
            // Isso garante que se o usuário mandou dia 17, o getDay() retorne o dia da semana corrreto de 17.
            agoraLocal = new Date(`${dataInput}T12:00:00`);
        } else {
            // Tempo real (sem data no body, assume hoje agora)
            const strDate = new Date().toLocaleString("en-US", { timeZone });
            agoraLocal = new Date(strDate);
        }

        let diaSemana = agoraLocal.getDay(); // 0-6
        const minutosAtuais = agoraLocal.getHours() * 60 + agoraLocal.getMinutes();

        // 2. Extrair dados da requisição
        const { nomeProfessor, professorId, turma, classe, turmaId, disciplina, materia } = req.body;

        // Normalização de campos
        let targetProfessorId = professorId;
        let targetTurmaId = turmaId;

        // 3. Lookup: Professor (Se veio string nomeProfessor)
        if (!targetProfessorId && nomeProfessor) {
            const profDoc = await Professor.findOne({ nome: nomeProfessor });
            if (profDoc) targetProfessorId = profDoc._id;
        }

        // 4. Lookup: Turma (Se veio string turma/classe)
        const targetTurmaName = turma || classe;
        if (!targetTurmaId && targetTurmaName) {
            const turmaDoc = await Turma.findOne({ nome: targetTurmaName });
            if (turmaDoc) targetTurmaId = turmaDoc._id;
        }

        if (!targetProfessorId) {
            console.warn('[Validation] Professor não identificado no payload:', req.body);
            return res.status(400).json({
                success: false,
                error: 'Não foi possível identificar o professor para validação de horário (ID ausente).'
            });
        }

        if (!targetTurmaId) {
            console.warn('[Validation] Turma não identificada no payload:', req.body);
            return res.status(400).json({
                success: false,
                error: 'Não foi possível identificar a turma para validação de horário.'
            });
        }

        // 5. Consultar Grade
        // Ajuste Híbrido: Verifica tanto pelo ID resolvido quanto pelo Nome da Turma (Legado/String)
        const turmaConditions = [];
        if (targetTurmaId) turmaConditions.push({ turmaId: String(targetTurmaId) });
        if (targetTurmaName) turmaConditions.push({ turmaId: targetTurmaName });

        const finalQuery = {
            professorId: String(targetProfessorId),
            diaSemana: diaSemana,
            ativo: true,
            $or: turmaConditions.length > 0 ? turmaConditions : [{ turmaId: "NENHUMA" }]
        };

        console.log('[Middleware Verify] Query Grade:', JSON.stringify(finalQuery));
        console.log('  -> Dia Semana:', diaSemana, 'Minutos:', minutosAtuais);

        const grades = await GradeHoraria.find(finalQuery);

        // 6. Verificar horário (Range)
        // 6. Verificar horário (Range)
        // Lógica Híbrida:
        // - Se for Retroativo (req.body.data presente): Validamos se ele TEM aula naquele Dia com aquela Turma (Relaxado)
        // - Se for Tempo Real (sem data no body): Validamos o Horário exato (Estrito)

        const isRetroactive = !!dataInput;
        let gradeAutorizada = null;

        if (isRetroactive) {
            // Se tem alguma grade para este professor/turma/dia, permitimos
            gradeAutorizada = grades[0]; // Pega a primeira que achar (MVP)
            // Poderíamos validar se quantidadeAulas <= soma das grades do dia? 
            // Vamos manter simples: Se existe grade no dia, ok.
        } else {
            // Tempo Real: Valida minutos
            gradeAutorizada = grades.find(grade => {
                const inicio = timeToMinutes(grade.horaInicio);
                const fim = timeToMinutes(grade.horaFim);
                return minutosAtuais >= inicio && minutosAtuais < fim;
            });
        }

        if (gradeAutorizada) {
            // Validação Extra: Quantidade de Aulas (Mantida)
            const qtdSolicitada = req.body.quantidadeAulas ? parseInt(req.body.quantidadeAulas) : 1;
            const maxPermitido = gradeAutorizada.aulasSeguidas || 1;

            if (qtdSolicitada > maxPermitido) {
                return res.status(400).json({
                    success: false,
                    error: `A quantidade de aulas (${qtdSolicitada}) excede o permitido pela grade (${maxPermitido}).`,
                    limite: maxPermitido
                });
            }

            req.gradeHoraria = gradeAutorizada;
            next();
        } else {
            return res.status(403).json({
                success: false,
                error: isRetroactive
                    ? `Nesta data (${dataInput || 'Hoje'}, dia ${diaSemana}) você não possui grade cadastrada com esta turma.`
                    : 'Este horário não pertence à sua grade. Verifique seu horário cadastrado.',
                debug: { diaSemana, minutos: minutosAtuais, retroactive: isRetroactive }
            });
        }

    } catch (error) {
        console.error('Erro no middleware de validação:', error);
        return res.status(500).json({ success: false, error: 'Erro interno na validação de horário.' });
    }
};

module.exports = verifyTimetable;
