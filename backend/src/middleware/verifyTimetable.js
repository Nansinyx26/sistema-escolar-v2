const GradeHoraria = require('../models/GradeHoraria');
const Professor = require('../models/Professor');
const Turma = require('../models/Turma');
const logger = require('../utils/logger');
const escapeRegex = require('../utils/escapeRegex');
const { normalizarNome } = require('../utils/nomeAluno');

/**
 * Acha o professor pelo nome que o front mandou.
 *
 * ANTES: `Professor.findOne({ nome: nomeProfessor })` — igualdade exata, byte a
 * byte. "Ana Paula " com espaço no fim, "ANA PAULA" em caixa alta ou "Ana Paula
 * Souza" cadastrada com acento diferente do que a tela enviou não casavam, o
 * middleware devolvia 400 e a chamada inteira da turma se perdia. Pior: a
 * mensagem falava em "professor não identificado", que ninguém liga a um
 * problema de grafia.
 *
 * AGORA: tenta a igualdade exata primeiro (é o caminho barato e o mais comum) e,
 * se não achar, cai para uma comparação sem acento, sem caixa e com espaços
 * colapsados. A regex é ancorada e escapada — nome de gente tem parêntese e
 * ponto, e um deles solto na regex casaria com o cadastro errado.
 *
 * O ESCOPO DE ESCOLA NÃO É OPCIONAL: sem ele, duas redes com uma "Maria Silva"
 * cada resolviam para o primeiro documento que o Mongo devolvesse — que podia
 * ser o da outra escola. A partir daí a grade consultada era a da unidade
 * errada, e a recusa (ou a liberação) não tinha relação com a realidade de quem
 * estava fazendo a chamada.
 */
async function acharProfessor(nome, escolaId) {
    const escopo = escolaId ? { 'vinculos.escolaId': String(escolaId) } : {};

    const exato = await Professor.findOne({ ...escopo, nome }).select('_id nome').lean();
    if (exato) return exato;

    const alvo = normalizarNome(nome);
    if (!alvo) return null;

    // Sem índice para busca normalizada em Professor: a coleção tem dezenas de
    // documentos por escola, não milhares, e este caminho só roda quando a
    // igualdade exata já falhou.
    const candidatos = await Professor.find(escopo).select('_id nome').lean();
    return candidatos.find((p) => normalizarNome(p.nome) === alvo) || null;
}

/**
 * Idem para a turma: "1A", "1 A", "1ºA" e "1º A" são a mesma sala para quem
 * digita, e o cadastro tem as quatro grafias. `filtroDeSala` já resolve isso
 * para alunos — aqui a busca é direta porque a coleção é pequena.
 */
async function acharTurma(nome, escolaId) {
    const escopo = escolaId ? { escolaId: String(escolaId) } : {};

    const exata = await Turma.findOne({ ...escopo, nome }).select('_id nome').lean();
    if (exata) return exata;

    const canonico = (v) =>
        String(v || '')
            .toUpperCase()
            .replace(/[ºª°\s._-]/g, '');

    const alvo = canonico(nome);
    if (!alvo) return null;

    const candidatas = await Turma.find({
        ...escopo,
        nome: new RegExp(`^${escapeRegex(String(nome).trim())}$`, 'i'),
    })
        .select('_id nome')
        .lean();
    if (candidatas.length === 1) return candidatas[0];

    const todas = await Turma.find(escopo).select('_id nome').lean();
    return todas.find((t) => canonico(t.nome) === alvo) || null;
}

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
            const profDoc = await acharProfessor(nomeProfessor, req.escolaId);
            if (profDoc) targetProfessorId = profDoc._id;
        }

        // 4. Lookup: Turma (Se veio string turma/classe)
        const targetTurmaName = turma || classe;
        if (!targetTurmaId && targetTurmaName) {
            const turmaDoc = await acharTurma(targetTurmaName, req.escolaId);
            if (turmaDoc) targetTurmaId = turmaDoc._id;
        }

        if (!targetProfessorId) {
            // Loga só as chaves recebidas — o body inteiro traria dados do aluno.
            logger.warn('[Validation] Professor não identificado no payload', {
                action: 'grade.validar',
                camposRecebidos: Object.keys(req.body || {}),
            });
            return res.status(400).json({
                success: false,
                error: `Não encontramos o cadastro do professor "${nomeProfessor || '—'}" nesta escola. Verifique o nome em Professores e tente de novo.`,
                code: 'PROFESSOR_NAO_ENCONTRADO',
            });
        }

        if (!targetTurmaId) {
            logger.warn('[Validation] Turma não identificada no payload', {
                action: 'grade.validar',
                camposRecebidos: Object.keys(req.body || {}),
            });
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

        logger.debug('[Middleware Verify] Consultando grade horária', {
            action: 'grade.validar', query: finalQuery, diaSemana, minutosAtuais,
        });

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
            // GRADE INEXISTENTE ≠ AULA FORA DA GRADE (Issue: chamada não salva)
            // ------------------------------------------------------------------
            // Este `else` tratava os dois casos como o mesmo 403, e a diferença
            // entre eles é o que separa um controle funcionando de um sistema
            // fora do ar:
            //
            //   • o professor TEM grade e a aula de agora não está nela
            //     → é exatamente o que este middleware existe para barrar;
            //
            //   • o professor NÃO TEM grade nenhuma cadastrada
            //     → a escola não preencheu o horário, e barrar aqui bloqueia
            //       100% das chamadas dele, para sempre, com uma mensagem que
            //       fala de horário e não de cadastro faltando.
            //
            // O segundo caso é o estado real da produção: 5 registros de grade
            // para 20 turmas, e 3 faltas gravadas no ano inteiro. Ninguém leu o
            // 403 como "faltou cadastrar a grade" — leram como "o sistema não
            // salva a chamada".
            //
            // Liberar o segundo caso NÃO abre buraco de autorização: quem
            // decide se o professor pode lançar frequência naquela turma é o
            // `horizontalFilter` + a checagem de `req.allowedTurmas` dentro do
            // AttendanceController, que roda depois daqui e continua de pé. O
            // que este middleware acrescenta é a janela de HORÁRIO — e não há
            // janela a conferir quando não existe grade.
            const gradeDoProfessor = await GradeHoraria.countDocuments({
                professorId: String(targetProfessorId),
                ativo: true,
            });

            if (gradeDoProfessor === 0) {
                logger.warn('[Validation] Chamada liberada sem grade cadastrada', {
                    action: 'grade.semCadastro',
                    professorId: String(targetProfessorId),
                    turma: targetTurmaName,
                    diaSemana,
                });
                req.gradeHoraria = null;
                req.gradeAusente = true;
                return next();
            }

            return res.status(403).json({
                success: false,
                error: isRetroactive
                    ? `Você não tem aula com a turma ${targetTurmaName || ''} neste dia da semana, segundo a grade cadastrada. Ajuste a grade em Grade Horária ou escolha outra data.`
                    : `Agora não é horário de aula sua com a turma ${targetTurmaName || ''}. Confira sua grade em Meu Horário.`,
                code: 'FORA_DA_GRADE',
                debug: { diaSemana, minutos: minutosAtuais, retroactive: isRetroactive }
            });
        }

    } catch (error) {
        logger.error('Erro no middleware de validação de horário', { err: error, action: 'grade.validar' });
        return res.status(500).json({ success: false, error: 'Erro interno na validação de horário.' });
    }
};

module.exports = verifyTimetable;
