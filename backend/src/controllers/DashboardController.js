const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const { escolaMatch } = require('../middleware/filtrarPorEscola');
const logger = require('../utils/logger');

exports.getPublicSummary = async (req, res) => {
    try {
        const mongoose = require('mongoose');
        const totalAlunos = await Aluno.countDocuments({ ativo: { $ne: false } });
        let totalProfessores = 0;
        let totalTurmas = 0;
        try {
            totalProfessores = await mongoose.connection.db
                .collection('professores')
                .countDocuments();
            totalTurmas = await mongoose.connection.db.collection('turmas').countDocuments();
        } catch (e) {
            console.error('Error fetching public stats:', e);
        }
        const totalPresencas = await Falta.countDocuments({ presente: true });
        const totalRegistrosPresenca = await Falta.countDocuments({ presente: { $exists: true } });
        const disponibilidade =
            totalRegistrosPresenca > 0
                ? Math.round((totalPresencas / totalRegistrosPresenca) * 100)
                : 100;

        // Escolas cadastradas na rede (multi-escola) — métrica real da landing
        let totalEscolas = 0;
        try {
            const Escola = require('../models/Escola');
            totalEscolas = await Escola.countDocuments();
        } catch (e) {
            // Métrica opcional: a landing tem fallback, então não propaga o erro —
            // mas um Mongo fora do ar não pode passar despercebido.
            logger.warn('Falha ao contar escolas para a landing (usando fallback 0)', {
                err: e,
                action: 'dashboard.metricasPublicas',
            });
        }

        res.json({
            success: true,
            data: {
                totalAlunos,
                professoresAtivos: totalProfessores,
                totalTurmas,
                totalEscolas,
                disponibilidade,
            },
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Erro ao processar resumo público: ' + error.message,
        });
    }
};

exports.getSummary = async (req, res) => {
    try {
        const { turmaId, bimestre, materiaId } = req.query;
        // Multi-escola: isola todas as métricas pela escola ativa da sessão
        const ef = escolaMatch(req.escolaId);

        // Base filters for counts
        const studentFilter = { ativo: { $ne: false }, ...ef };
        const noteFilter = { ...ef };

        if (turmaId) {
            studentFilter.turmaId = turmaId;
            noteFilter.turmaId = turmaId;
        }
        if (bimestre) noteFilter.bimestre = parseInt(bimestre);
        if (materiaId) noteFilter.materiaId = materiaId;

        // 1. Total Students
        const totalAlunos = await Aluno.countDocuments(studentFilter);

        // 2. Total Evaluations (Notes)
        const totalAvaliacoes = await Nota.countDocuments(noteFilter);

        // Fetch Professors, Turmas, and Absences
        const Turma = require('../models/Turma');
        let totalProfessores = 0;
        let totalTurmas = 0;
        try {
            // NOTA: professores usam vinculos[].escolaId (não um campo plano),
            // então esta contagem permanece global. É apenas um inteiro sem PII.
            totalProfessores = await require('mongoose')
                .connection.db.collection('professores')
                .countDocuments();
            totalTurmas = await Turma.countDocuments(ef); // escopado por escola
        } catch (e) {
            console.error('Error fetching additional dashboard stats:', e);
        }

        // 3. Average Grade
        const notes = await Nota.find(noteFilter).select('nota alunoId');
        let mediaGeral = 0;
        let alunosRisco = 0;

        if (notes.length > 0) {
            const sum = notes.reduce((acc, n) => acc + n.nota, 0);
            mediaGeral = sum / notes.length;

            // Students at risk (avg < 5)
            const studentGrades = {};
            notes.forEach((n) => {
                if (!studentGrades[n.alunoId]) studentGrades[n.alunoId] = [];
                studentGrades[n.alunoId].push(n.nota);
            });

            Object.values(studentGrades).forEach((grades) => {
                const avg = grades.reduce((a, b) => a + b, 0) / grades.length;
                if (avg < 5) alunosRisco++;
            });
        }

        res.json({
            success: true,
            data: {
                totalAlunos,
                totalAvaliacoes,
                totalProfessores,
                totalTurmas,
                mediaGeral: parseFloat(mediaGeral.toFixed(1)),
                alunosRisco,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getChartData = async (req, res) => {
    try {
        const { turmaId, bimestre, materiaId } = req.query;
        const noteFilter = { ...escolaMatch(req.escolaId) }; // Escopo por escola (tolerante a legados)
        if (turmaId) noteFilter.turmaId = turmaId;
        if (bimestre) noteFilter.bimestre = parseInt(bimestre);
        if (materiaId) noteFilter.materiaId = materiaId;

        const notes = await Nota.find(noteFilter);

        // 1. By Turma
        const turmaMap = {};
        notes.forEach((n) => {
            const val = Number(n.nota);
            if (!isNaN(val)) {
                const key = n.turmaId || 'Sem Turma';
                if (!turmaMap[key]) turmaMap[key] = [];
                turmaMap[key].push(val);
            }
        });
        const turmasData = Object.keys(turmaMap).map((id) => ({
            label: id,
            value: (turmaMap[id].reduce((a, b) => a + b, 0) / turmaMap[id].length).toFixed(1),
        }));

        // 2. By Materia
        const materiaMap = {};
        notes.forEach((n) => {
            const val = Number(n.nota);
            if (!isNaN(val)) {
                const key = n.materiaId || n.materia || 'Geral';
                if (!materiaMap[key]) materiaMap[key] = [];
                materiaMap[key].push(val);
            }
        });
        const materiasData = Object.keys(materiaMap).map((id) => ({
            label: id,
            value: (materiaMap[id].reduce((a, b) => a + b, 0) / materiaMap[id].length).toFixed(1),
        }));

        // 3. Evolution (Bimestre)
        const bimMap = { 1: [], 2: [], 3: [], 4: [] };
        notes.forEach((n) => {
            const val = Number(n.nota);
            if (!isNaN(val) && bimMap[n.bimestre]) {
                bimMap[n.bimestre].push(val);
            }
        });
        const evolucaoData = [1, 2, 3, 4].map((b) => ({
            label: `${b}º Bim`,
            value:
                bimMap[b].length > 0
                    ? (bimMap[b].reduce((a, c) => a + c, 0) / bimMap[b].length).toFixed(1)
                    : null,
        }));

        res.json({
            success: true,
            data: {
                turmas: turmasData,
                materias: materiasData,
                evolucao: evolucaoData,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getRanking = async (req, res) => {
    try {
        const { turmaId, bimestre, materiaId } = req.query;
        // Multi-escola: isola o ranking pela escola ativa da sessão
        const ef = escolaMatch(req.escolaId);
        const noteFilter = { ...ef };
        if (turmaId) noteFilter.turmaId = turmaId;
        if (bimestre) noteFilter.bimestre = parseInt(bimestre);
        if (materiaId) noteFilter.materiaId = materiaId;

        const notes = await Nota.find(noteFilter);

        // Aggregate by Student
        const studentMap = {};
        const studentIds = new Set();

        notes.forEach((n) => {
            if (!studentMap[n.alunoId]) studentMap[n.alunoId] = [];
            studentMap[n.alunoId].push(n.nota);
            studentIds.add(n.alunoId);
        });

        // Fetch Student Names (Robust search by _id or id)
        const ids = Array.from(studentIds);
        const students = await Aluno.find({
            ...ef,
            $or: [{ _id: { $in: ids } }, { id: { $in: ids } }],
        }).lean();

        const studentInfoMap = {};
        students.forEach((s) => {
            if (s.id) studentInfoMap[s.id] = s;
            if (s._id) studentInfoMap[s._id.toString()] = s;
        });

        const ranking = Object.keys(studentMap).map((alunoId) => {
            const grades = studentMap[alunoId];
            const avg = grades.reduce((a, b) => a + b, 0) / grades.length;

            const info = studentInfoMap[alunoId] || {};
            const nome = info.nome || 'Desconhecido';
            const turma = info.turmaId || info.turma || '?'; // Fallback robusto

            return {
                id: alunoId,
                nome: nome,
                turma: turma,
                media: parseFloat(avg.toFixed(1)),
            };
        });

        // Sort descending
        ranking.sort((a, b) => b.media - a.media);

        res.json({
            success: true,
            data: ranking.slice(0, 10), // Top 10
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getTeacherPanel = async (req, res) => {
    try {
        const userId = req.user.id || req.user._id;
        const mongoose = require('mongoose');
        const Usuario = require('../models/Usuario');
        const Notificacao = require('../models/Notificacao');
        const Professor = require('../models/Professor');
        const Nota = require('../models/Nota');
        const Falta = require('../models/Falta');
        const Aluno = require('../models/Aluno');

        // Multi-escola: escopa as buscas pela escola ativa da sessão. Sem isto,
        // turmas com nome idêntico em escolas diferentes (ex.: "3A") colidem e
        // vazam notas/notificações entre tenants.
        const ef = escolaMatch(req.escolaId);

        const user = await Usuario.findById(userId).lean();
        if (!user || user.perfil !== 'professor') {
            return res.status(403).json({ success: false, error: 'Acesso negado' });
        }

        // Buscar dados do professor vinculado
        const prof = await Professor.findOne({ email: user.email }).lean();

        const nomeProfessor = user.nome ? user.nome.split(' ')[0] : 'Docente';
        let turmas = [];
        if (prof) {
            if (prof.turmas && prof.turmas.length > 0) {
                turmas = prof.turmas;
            } else {
                if (prof.salaPrincipal) turmas.push(prof.salaPrincipal);
                if (prof.salasAdicionais && prof.salasAdicionais.length > 0) {
                    turmas = [...turmas, ...prof.salasAdicionais];
                }
            }
        }

        // Normaliza e limpa duplicatas (ex: remove '1C' se '1ºC' estiver presente ou vice-versa, limpa strings vazias)
        turmas = [...new Set(turmas)].map((t) => t.trim()).filter(Boolean);

        // Se turmas for vazio, tenta buscar no banco de dados na collection de Turmas pelo vinculo com professor
        if (turmas.length === 0) {
            const Turma = require('../models/Turma');
            const dbTurmas = await Turma.find({
                ...ef,
                $or: [
                    { professor: prof ? prof._id : '' },
                    { professor: prof ? prof.id : '' },
                    { professor: user.nome },
                ],
            }).lean();
            if (dbTurmas.length > 0) {
                turmas = dbTurmas.map((t) => t.nome || t.id).filter(Boolean);
            }
        }

        // Fallback visual se o professor não tiver nenhuma turma cadastrada de fato no banco
        if (turmas.length === 0) {
            turmas = [];
        }

        // Avisos ativos usando a estrutura real do banco de dados (destinatarios)
        const queryNotif = {
            ...ef,
            destinatarios: { $in: ['todos', 'professores', ...turmas] },
        };
        const avisosCount = await Notificacao.countDocuments(queryNotif);
        const avisos = await Notificacao.find(queryNotif).sort({ dataCriacao: -1 }).limit(1).lean();

        // ================================================================
        // FUSO HORÁRIO BRASIL — Todas as datas/horas devem usar Sao_Paulo
        // O servidor Render roda em UTC; sem esta correção, o painel
        // mostra status de aulas 3 horas adiantado.
        // ================================================================
        const brasilNow = new Date(
            new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })
        );
        const brasilHour = brasilNow.getHours();
        const brasilMinute = brasilNow.getMinutes();
        const brasilDay = brasilNow.getDay(); // 0=Dom, 1=Seg, ..., 6=Sab

        const diasSemana = [
            'Domingo',
            'Segunda-feira',
            'Terça-feira',
            'Quarta-feira',
            'Quinta-feira',
            'Sexta-feira',
            'Sábado',
        ];
        const hojeNome = diasSemana[brasilDay];

        // Média Geral baseada UNICAMENTE nas notas reais da(s) sala(s) deste professor
        let mediaGeral = 0;
        if (turmas.length > 0) {
            const queryNota = { ...ef, turmaId: { $in: turmas } };
            const notes = await Nota.find(queryNota).lean();
            if (notes.length > 0) {
                const totalNotas = notes.reduce((acc, n) => acc + (Number(n.nota) || 0), 0);
                mediaGeral = totalNotas / notes.length;
            }
        }

        // Frequência real removida a pedido do usuário
        const frequenciaGeral = 0;
        const frequenciaPorTurma = [];

        // --- AGENDA DO DIA: SÓ A GRADE CADASTRADA (Issue #371) ---
        // A agenda sai da `tabela_geral` da escola ativa e de mais nada. Sem
        // grade para hoje, a lista vem vazia e a tela mostra o estado vazio —
        // nunca uma agenda de exemplo com nomes de colegas.
        const Turma = require('../models/Turma');
        const TabelaGeral = require('../models/TabelaGeral');

        const disciplinaName = prof
            ? prof.disciplina || (prof.materias && prof.materias[0]) || 'PEB I'
            : 'PEB I';
        const disciplinaUpper = disciplinaName.toUpperCase();
        const isPeb2 =
            disciplinaUpper.includes('PEB II') ||
            disciplinaUpper.includes('PEB 2') ||
            disciplinaUpper.includes('PEBII') ||
            disciplinaUpper.includes('PEB2') ||
            (prof && prof.tipoAtuacao === 'materia') ||
            turmas.length > 1;

        const currentTotalMinutes = brasilHour * 60 + brasilMinute;

        // Chave do professor na grade: só a do cadastro. Deduzir pelo nome
        // da pessoa ou pelo texto da disciplina ligava um professor à grade
        // de outro.
        const professorKey = prof && typeof prof.professorKey === 'string' ? prof.professorKey : '';

        // Salas das turmas da escola ativa, para mostrar onde é a aula
        const dbTurmasList = await Turma.find(ef).lean();
        const turmasSalaMap = {};
        dbTurmasList.forEach((t) => {
            const nameKey = (t.nome || '').replace(/\s/g, '').toUpperCase();
            const idKey = (t.id || '').replace(/\s/g, '').toUpperCase();
            if (nameKey) turmasSalaMap[nameKey] = t.sala || '';
            if (idKey) turmasSalaMap[idKey] = t.sala || '';
        });

        const normalizarTurma = (turmaName) =>
            String(turmaName || '')
                .replace(/º/g, '')
                .replace(/ANO/g, '')
                .replace(/\s/g, '')
                .toUpperCase();

        const getSalaForTurma = (turmaName) => {
            if (!turmaName) return '';
            return turmasSalaMap[normalizarTurma(turmaName)] || '';
        };

        // Sábado e domingo não têm grade: nada de cair na segunda-feira.
        const diasSemanaMap = {
            'Segunda-feira': 'SEGUNDA',
            'Terça-feira': 'TERÇA',
            'Quarta-feira': 'QUARTA',
            'Quinta-feira': 'QUINTA',
            'Sexta-feira': 'SEXTA',
        };
        const diaBusca = diasSemanaMap[hojeNome] || null;

        const periodTimes = [
            { start: 7 * 60 + 30, end: 8 * 60 + 20, startStr: '07:30', rangeStr: '07:30 - 08:20' },
            { start: 8 * 60 + 20, end: 9 * 60 + 10, startStr: '08:20', rangeStr: '08:20 - 09:10' },
            { start: 9 * 60 + 30, end: 10 * 60 + 20, startStr: '09:30', rangeStr: '09:30 - 10:20' },
            {
                start: 10 * 60 + 20,
                end: 11 * 60 + 10,
                startStr: '10:20',
                rangeStr: '10:20 - 11:10',
            },
            { start: 11 * 60 + 10, end: 12 * 60 + 0, startStr: '11:10', rangeStr: '11:10 - 12:00' },
            { start: 13 * 60 + 0, end: 13 * 60 + 50, startStr: '13:00', rangeStr: '13:00 - 13:50' },
            {
                start: 13 * 60 + 50,
                end: 14 * 60 + 40,
                startStr: '13:50',
                rangeStr: '13:50 - 14:40',
            },
        ];

        const statusDoHorario = (timeInfo) => {
            if (currentTotalMinutes >= timeInfo.end) {
                return { status: 'Concluída', statusColor: 'badge-ok' };
            }
            if (currentTotalMinutes >= timeInfo.start) {
                return { status: 'Agora', statusColor: 'badge-ok' };
            }
            return { status: `Às ${timeInfo.startStr}`, statusColor: 'badge-warn' };
        };

        let proximasAulas = [];

        if (diaBusca && turmas.length > 0 && isPeb2 && professorKey) {
            // Especialista (PEB II): as células onde a chave dele aparece hoje
            const cells = await TabelaGeral.find({
                ...ef,
                professorKey: professorKey,
                dia: diaBusca,
            }).lean();

            if (cells.length > 0) {
                const cellsMap = {};
                cells.forEach((c) => {
                    cellsMap[c.aulaIdx] = c;
                });

                proximasAulas = periodTimes.map((timeInfo, i) => {
                    const cell = cellsMap[i];
                    const base = {
                        hora: timeInfo.startStr,
                        horarioRange: timeInfo.rangeStr,
                        ...statusDoHorario(timeInfo),
                    };
                    if (!cell) {
                        return {
                            ...base,
                            materia: 'Horário de planejamento',
                            turma: '',
                            sala: '',
                            livre: true,
                            barColor: 'rgba(255,255,255,0.06)',
                        };
                    }
                    return {
                        ...base,
                        materia: disciplinaName,
                        turma: cell.turmaNome,
                        sala: getSalaForTurma(cell.turmaNome),
                        livre: false,
                        barColor: '#a855f7',
                    };
                });
            }
        } else if (diaBusca && turmas.length > 0 && !isPeb2) {
            // Polivalente (PEB I): a grade da turma dele, todos os dias igual
            const turmaGrade = normalizarTurma(turmas[0]);
            const cells = await TabelaGeral.find({
                ...ef,
                turmaId: turmaGrade,
                dia: diaBusca,
            }).lean();

            if (cells.length > 0) {
                const cellsMap = {};
                cells.forEach((c) => {
                    cellsMap[c.aulaIdx] = c;
                });

                const abrevNomes = {
                    EF: 'Ed. Física',
                    I: 'Inglês',
                    A: 'Artes',
                    MK: 'Of. Maker',
                    OL: 'Oficina de Leitura',
                    DSE: 'Oficina Sebrae/DSE',
                    PROERD: 'PROERD',
                    LIMA: 'PROERD',
                };

                proximasAulas = periodTimes.map((timeInfo, i) => {
                    const cell = cellsMap[i];
                    const abrev = cell ? String(cell.abrev || '').trim() : '';
                    let materia = 'Aula regular';

                    if (abrev) {
                        materia = abrevNomes[abrev.toUpperCase()] || abrev;
                        const key = TabelaGeral.getProfessorKey(abrev, turmaGrade);
                        const professorNome = TabelaGeral.PROFESSOR_NOME[key] || '';
                        if (professorNome) {
                            materia = `${materia} (${professorNome.split(' ')[0]})`;
                        }
                    }

                    return {
                        hora: timeInfo.startStr,
                        horarioRange: timeInfo.rangeStr,
                        materia: materia,
                        turma: turmas[0],
                        sala: getSalaForTurma(turmas[0]),
                        livre: false,
                        ...statusDoHorario(timeInfo),
                        barColor: abrev ? '#a855f7' : 'var(--a)',
                    };
                });
            }
        }

        const isSegunda = brasilDay === 1;
        const ultimoAvisoText =
            avisos.length > 0 ? avisos[0].mensagem || avisos[0].titulo : 'Nenhum aviso pendente';

        let saudacao = 'Bom dia';
        if (brasilHour >= 12 && brasilHour < 18) {
            saudacao = 'Boa tarde';
        } else if (brasilHour >= 18 || brasilHour < 5) {
            saudacao = 'Boa noite';
        }

        const turmaLabel = turmas.length > 0 ? turmas.join(', ') : 'Nenhuma turma';

        res.json({
            success: true,
            data: {
                nomeProfessor: nomeProfessor,
                diaSemana: hojeNome,
                totalTurmas: turmas.length,
                frequencia: frequenciaGeral,
                mediaGeral: parseFloat(mediaGeral.toFixed(1)),
                avisosAtivos: avisosCount,
                ultimoAviso: ultimoAvisoText,
                proximasAulas: proximasAulas,
                frequenciaPorTurma: frequenciaPorTurma,
                isSegunda: isSegunda,
                turmas: turmas,
                turmaLabel: turmaLabel,
                saudacao: saudacao,
            },
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getDirectorNotices = async (req, res) => {
    try {
        const Notificacao = require('../models/Notificacao');
        const Aluno = require('../models/Aluno');
        const Turma = require('../models/Turma');

        // Busca as notificações da escola ativa para o mural completo do Diretor.
        // Multi-escola: escopa por escolaId — antes varria a rede inteira,
        // vazando comunicados e nomes de alunos de todas as escolas.
        const notices = await Notificacao.find(escolaMatch(req.escolaId))
            .sort({ dataCriacao: -1 })
            .lean();

        // Resolve os IDs de destinatários para nomes amigáveis
        const resolvedNotices = await Promise.all(
            notices.map(async (notice) => {
                let destName = notice.destinatarios;
                if (notice.destinatarios === 'todos') {
                    destName = 'Todos';
                } else if (notice.destinatarios === 'professores') {
                    destName = 'Professores';
                } else if (notice.destinatarios === 'diretores') {
                    destName = 'Diretores';
                } else if (
                    notice.destinatarios &&
                    notice.destinatarios.length === 24 &&
                    /^[0-9a-fA-F]{24}$/.test(notice.destinatarios)
                ) {
                    // É um ObjectID de Aluno
                    const aluno = await Aluno.findById(notice.destinatarios).lean();
                    if (aluno) {
                        destName = `${aluno.nome} ${aluno.sobrenome || ''}`.trim();
                    }
                } else if (notice.destinatarios) {
                    // Tenta buscar se é uma Turma
                    const turma = await Turma.findOne({
                        $or: [
                            { _id: notice.destinatarios },
                            { id: notice.destinatarios },
                            { nome: notice.destinatarios },
                        ],
                    }).lean();
                    if (turma) {
                        destName = `Turma: ${turma.nome || turma.id}`;
                    }
                }
                return {
                    ...notice,
                    destinatarioNome: destName,
                };
            })
        );

        res.json({
            success: true,
            data: resolvedNotices,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getSummaryNotices = async (req, res) => {
    try {
        const Notificacao = require('../models/Notificacao');
        const Aluno = require('../models/Aluno');
        const Turma = require('../models/Turma');

        // Busca as notificacoes da escola ativa, excluindo tipo 'cadastro'
        // e limitando a 5 no banco (Issue #331)
        const notices = await Notificacao.find({
            ...escolaMatch(req.escolaId),
            tipo: { $ne: 'cadastro' },
        })
            .sort({ dataCriacao: -1 })
            .limit(5)
            .lean();

        // Resolve os IDs de destinatarios para nomes amigaveis apenas para os 5 avisos
        const resolvedNotices = await Promise.all(
            notices.map(async (notice) => {
                let destName = notice.destinatarios;
                if (notice.destinatarios === 'todos') {
                    destName = 'Todos';
                } else if (notice.destinatarios === 'professores') {
                    destName = 'Professores';
                } else if (notice.destinatarios === 'diretores') {
                    destName = 'Diretores';
                } else if (
                    notice.destinatarios &&
                    notice.destinatarios.length === 24 &&
                    /^[0-9a-fA-F]{24}$/.test(notice.destinatarios)
                ) {
                    const aluno = await Aluno.findById(notice.destinatarios).lean();
                    if (aluno) {
                        destName = `${aluno.nome} ${aluno.sobrenome || ''}`.trim();
                    }
                } else if (notice.destinatarios) {
                    const turma = await Turma.findOne({
                        $or: [
                            { _id: notice.destinatarios },
                            { id: notice.destinatarios },
                            { nome: notice.destinatarios },
                        ],
                    }).lean();
                    if (turma) {
                        destName = `Turma: ${turma.nome || turma.id}`;
                    }
                }
                return {
                    ...notice,
                    destinatarioNome: destName,
                };
            })
        );

        res.json({
            success: true,
            data: resolvedNotices,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.getSummaryActivity = async (req, res) => {
    try {
        const Usuario = require('../models/Usuario');
        const Aluno = require('../models/Aluno');
        const Avaliacao = require('../models/Avaliacao');
        const DocumentoEmitido = require('../models/DocumentoEmitido');
        const JustificativaFalta = require('../models/JustificativaFalta');

        const filter = escolaMatch(req.escolaId);

        const [usuarios, alunos, avaliacoes, documentos, justificativas] = await Promise.all([
            Usuario.find({
                ...filter,
                perfil: { $in: ['professor', 'diretor', 'secretaria', 'responsavel'] },
            })
                .sort({ createdAt: -1 })
                .limit(10)
                .select('nome perfil createdAt criadoEm')
                .lean(),
            Aluno.find(filter)
                .sort({ createdAt: -1 })
                .limit(10)
                .select('nome turma createdAt')
                .lean(),
            Avaliacao.find(filter)
                .sort({ createdAt: -1 })
                .limit(10)
                .select('titulo turmaId materiaId createdAt')
                .lean(),
            DocumentoEmitido.find(filter)
                .sort({ createdAt: -1 })
                .limit(10)
                .select('tipo titulo alunoNome createdAt')
                .lean(),
            JustificativaFalta.find(filter)
                .sort({ createdAt: -1 })
                .limit(10)
                .select('alunoNome motivo categoria createdAt')
                .lean(),
        ]);

        const perfilLabels = {
            professor: 'professor',
            diretor: 'membro da direção',
            secretaria: 'membro da secretaria',
            responsavel: 'responsável',
        };
        const tipoDocNomes = {
            declaracao_matricula: 'Declaração de Matrícula',
            declaracao_frequencia: 'Declaração de Frequência',
            historico_escolar: 'Histórico Escolar',
            transferencia: 'Guia de Transferência',
        };

        const list = [
            ...usuarios.map((u) => {
                const label = perfilLabels[u.perfil] || 'usuário';
                return {
                    tipo: 'usuario',
                    texto: `Novo ${label} cadastrado: ${u.nome}`,
                    data: u.createdAt || u.criadoEm,
                    cor: '#3b82f6',
                };
            }),
            ...alunos.map((a) => ({
                tipo: 'aluno',
                texto: `Aluno matriculado: ${a.nome}${a.turma ? ` (Turma ${a.turma})` : ''}`,
                data: a.createdAt,
                cor: '#10b981',
            })),
            ...avaliacoes.map((av) => ({
                tipo: 'avaliacao',
                texto: `Avaliação criada: ${av.titulo}${av.turmaId ? ` (${av.turmaId})` : ''}`,
                data: av.createdAt,
                cor: '#f59e0b',
            })),
            ...documentos.map((d) => {
                const docNome = tipoDocNomes[d.tipo] || d.titulo || 'Documento';
                return {
                    tipo: 'documento',
                    texto: `Documento emitido: ${docNome}${d.alunoNome ? ` (${d.alunoNome})` : ''}`,
                    data: d.createdAt,
                    cor: '#8b5cf6',
                };
            }),
            ...justificativas.map((jf) => ({
                tipo: 'justificativa',
                texto: `Justificativa de falta recebida: ${jf.alunoNome || 'Aluno'}${jf.motivo ? ` — ${jf.motivo}` : ''}`,
                data: jf.createdAt,
                cor: '#ec4899',
            })),
        ];

        const dataValida = (d) => d && !Number.isNaN(new Date(d).getTime());
        const atividades = list
            .filter((item) => dataValida(item.data))
            .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())
            .slice(0, 10);

        res.json({
            success: true,
            data: atividades,
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
