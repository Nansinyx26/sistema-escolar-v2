const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');
const { escolaMatch } = require('../middleware/filtrarPorEscola');

exports.getPublicSummary = async (req, res) => {
    try {
        const mongoose = require('mongoose');
        const totalAlunos = await Aluno.countDocuments({ ativo: { $ne: false } });
        let totalProfessores = 0;
        let totalTurmas = 0;
        try {
            totalProfessores = await mongoose.connection.db.collection('professores').countDocuments();
            totalTurmas = await mongoose.connection.db.collection('turmas').countDocuments();
        } catch (e) {
            console.error('Error fetching public stats:', e);
        }
        const totalPresencas = await Falta.countDocuments({ presente: true });
        const totalRegistrosPresenca = await Falta.countDocuments({ presente: { $exists: true } });
        const disponibilidade = totalRegistrosPresenca > 0
            ? Math.round((totalPresencas / totalRegistrosPresenca) * 100)
            : 100;

        // Escolas cadastradas na rede (multi-escola) — métrica real da landing
        let totalEscolas = 0;
        try {
            const Escola = require('../models/Escola');
            totalEscolas = await Escola.countDocuments();
        } catch (e) { /* opcional — landing tem fallback */ }

        res.json({
            success: true,
            data: {
                totalAlunos,
                professoresAtivos: totalProfessores,
                totalTurmas,
                totalEscolas,
                disponibilidade
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Erro ao processar resumo público: ' + error.message });
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
            totalProfessores = await require('mongoose').connection.db.collection('professores').countDocuments();
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
            notes.forEach(n => {
                if (!studentGrades[n.alunoId]) studentGrades[n.alunoId] = [];
                studentGrades[n.alunoId].push(n.nota);
            });

            Object.values(studentGrades).forEach(grades => {
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
                alunosRisco
            }
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
        notes.forEach(n => {
            const val = Number(n.nota);
            if (!isNaN(val)) {
                const key = n.turmaId || 'Sem Turma';
                if (!turmaMap[key]) turmaMap[key] = [];
                turmaMap[key].push(val);
            }
        });
        const turmasData = Object.keys(turmaMap).map(id => ({
            label: id,
            value: (turmaMap[id].reduce((a, b) => a + b, 0) / turmaMap[id].length).toFixed(1)
        }));

        // 2. By Materia
        const materiaMap = {};
        notes.forEach(n => {
            const val = Number(n.nota);
            if (!isNaN(val)) {
                const key = n.materiaId || n.materia || 'Geral';
                if (!materiaMap[key]) materiaMap[key] = [];
                materiaMap[key].push(val);
            }
        });
        const materiasData = Object.keys(materiaMap).map(id => ({
            label: id,
            value: (materiaMap[id].reduce((a, b) => a + b, 0) / materiaMap[id].length).toFixed(1)
        }));

        // 3. Evolution (Bimestre)
        const bimMap = { 1: [], 2: [], 3: [], 4: [] };
        notes.forEach(n => {
            const val = Number(n.nota);
            if (!isNaN(val) && bimMap[n.bimestre]) {
                bimMap[n.bimestre].push(val);
            }
        });
        const evolucaoData = [1, 2, 3, 4].map(b => ({
            label: `${b}º Bim`,
            value: bimMap[b].length > 0 ? (bimMap[b].reduce((a, c) => a + c, 0) / bimMap[b].length).toFixed(1) : null
        }));

        res.json({
            success: true,
            data: {
                turmas: turmasData,
                materias: materiasData,
                evolucao: evolucaoData
            }
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

        notes.forEach(n => {
            if (!studentMap[n.alunoId]) studentMap[n.alunoId] = [];
            studentMap[n.alunoId].push(n.nota);
            studentIds.add(n.alunoId);
        });

        // Fetch Student Names (Robust search by _id or id)
        const ids = Array.from(studentIds);
        const students = await Aluno.find({
            ...ef,
            $or: [
                { _id: { $in: ids } },
                { id: { $in: ids } }
            ]
        }).lean();

        const studentInfoMap = {};
        students.forEach(s => {
            if (s.id) studentInfoMap[s.id] = s;
            if (s._id) studentInfoMap[s._id.toString()] = s;
        });

        const ranking = Object.keys(studentMap).map(alunoId => {
            const grades = studentMap[alunoId];
            const avg = grades.reduce((a, b) => a + b, 0) / grades.length;

            const info = studentInfoMap[alunoId] || {};
            const nome = info.nome || 'Desconhecido';
            const turma = info.turmaId || info.turma || '?'; // Fallback robusto

            return {
                id: alunoId,
                nome: nome,
                turma: turma,
                media: parseFloat(avg.toFixed(1))
            };
        });

        // Sort descending
        ranking.sort((a, b) => b.media - a.media);

        res.json({
            success: true,
            data: ranking.slice(0, 10) // Top 10
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
        
        let nomeProfessor = user.nome ? user.nome.split(' ')[0] : 'Docente';
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
        turmas = [...new Set(turmas)].map(t => t.trim()).filter(Boolean);

        // Se turmas for vazio, tenta buscar no banco de dados na collection de Turmas pelo vinculo com professor
        if (turmas.length === 0) {
            const Turma = require('../models/Turma');
            const dbTurmas = await Turma.find({
                ...ef,
                $or: [
                    { professor: prof ? prof._id : '' },
                    { professor: prof ? prof.id : '' },
                    { professor: user.nome }
                ]
            }).lean();
            if (dbTurmas.length > 0) {
                turmas = dbTurmas.map(t => t.nome || t.id).filter(Boolean);
            }
        }

        // Fallback visual se o professor não tiver nenhuma turma cadastrada de fato no banco
        if (turmas.length === 0) {
            turmas = [];
        }

        // Avisos ativos usando a estrutura real do banco de dados (destinatarios)
        const queryNotif = {
            ...ef,
            destinatarios: { $in: ['todos', 'professores', ...turmas] }
        };
        const avisosCount = await Notificacao.countDocuments(queryNotif);
        const avisos = await Notificacao.find(queryNotif).sort({ dataCriacao: -1 }).limit(1).lean();

        // ================================================================
        // FUSO HORÁRIO BRASIL — Todas as datas/horas devem usar Sao_Paulo
        // O servidor Render roda em UTC; sem esta correção, o painel
        // mostra status de aulas 3 horas adiantado.
        // ================================================================
        const brasilNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
        const brasilHour = brasilNow.getHours();
        const brasilMinute = brasilNow.getMinutes();
        const brasilDay = brasilNow.getDay(); // 0=Dom, 1=Seg, ..., 6=Sab

        const diasSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
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

        // --- GESTÃO DE HORÁRIO DINÂMICO E GRADE POR PERÍODO ---
        const Turma = require('../models/Turma');
        // Descobre o período da turma principal do professor
        const turmaPrincipalInfo = (turmas.length > 0) ? await Turma.findOne({
            ...ef,
            $or: [
                { _id: turmas[0] },
                { id: turmas[0] },
                { nome: turmas[0] }
            ]
        }).lean() : null;
        const periodo = 'Manhã';

        const disciplinaName = prof ? (prof.disciplina || (prof.materias && prof.materias[0]) || 'PEB I') : 'PEB I';
        const isPeb2 = disciplinaName.toUpperCase().includes('PEB II') || 
                       disciplinaName.toUpperCase().includes('PEB 2') || 
                       disciplinaName.toUpperCase().includes('PEBII') || 
                       disciplinaName.toUpperCase().includes('PEB2') ||
                       (prof && prof.tipoAtuacao === 'materia') || 
                       turmas.length > 1;

        // Definição de horários padrão baseados no período escolar e tipo de cargo (PEB I vs PEB II)
        let horarios = [];
        let horarioRanges = [];
        if (isPeb2) {
            // PEB II - Períodos de aula de 50 minutos (especialistas)
            if (periodo === 'Tarde') {
                horarios = ['13:00', '13:50', '14:40'];
                horarioRanges = ['13:00 - 13:50', '13:50 - 14:40', '14:40 - 15:30'];
            } else if (periodo === 'Noite') {
                horarios = ['19:00', '19:45', '20:30'];
                horarioRanges = ['19:00 - 19:45', '19:45 - 20:30', '20:30 - 21:15'];
            } else {
                horarios = ['07:30', '08:20', '09:30', '10:20', '11:10', '13:00', '13:50'];
                horarioRanges = ['07:30 - 08:20', '08:20 - 09:10', '09:30 - 10:20', '10:20 - 11:10', '11:10 - 12:00', '13:00 - 13:50', '13:50 - 14:40'];
            }
        } else {
            // PEB I - Blocos de aula maiores (polivalentes)
            if (periodo === 'Tarde') {
                horarios = ['13:00', '14:20', '16:00'];
                horarioRanges = ['13:00 - 14:20', '14:20 - 15:40', '16:00 - 17:20'];
            } else if (periodo === 'Noite') {
                horarios = ['19:00', '20:15', '21:30'];
                horarioRanges = ['19:00 - 20:15', '20:15 - 21:30', '21:30 - 22:45'];
            } else {
                horarios = ['07:30', '08:20', '09:30', '10:20', '11:10', '13:00', '13:50'];
                horarioRanges = ['07:30 - 08:20', '08:20 - 09:10', '09:30 - 10:20', '10:20 - 11:10', '11:10 - 12:00', '13:00 - 13:50', '13:50 - 14:40'];
            }
        }

        let proximasAulas = [];

        // Usar hora do Brasil (já calculada acima)
        const currentHour = brasilHour;
        const currentMinute = brasilMinute;
        const currentTotalMinutes = currentHour * 60 + currentMinute;

        // Resolvendo o professorKey do docente logado para buscar na tabela_geral
        let professorKey = prof ? prof.professorKey : '';
        if (!professorKey || professorKey === 'undefined' || professorKey === '') {
            const disc = (prof && prof.disciplina || '').toUpperCase();
            const name = (user.nome || '').toUpperCase();
            if (disc.includes('INGLÊS') || disc.includes('INGLES') || disc.includes('INGL')) {
                professorKey = 'INGLS';
            } else if (disc.includes('ARTES') || disc.includes('ARTE')) {
                professorKey = 'MIRIAN';
            } else if (disc.includes('MAKER') || disc.includes('MK')) {
                professorKey = 'OFMAKER';
            } else if (disc.includes('LEITURA') || disc.includes('OL')) {
                professorKey = 'OFLEITURA';
            } else if (disc.includes('SEBRAE') || disc.includes('DSE') || disc.includes('EMPREENDEDORISMO')) {
                professorKey = 'OFSEBRAE';
            } else if (disc.includes('PROERD') || disc.includes('LIMA')) {
                professorKey = 'LIMA';
            } else if (disc.includes('FÍSICA') || disc.includes('FISICA') || disc.includes('EF')) {
                if (name.includes('MARCOS')) {
                    professorKey = 'MARCOS';
                } else {
                    professorKey = 'MARJORIE';
                }
            }
        }

        // Buscar salas associadas para busca dinâmica de nome de sala
        const dbTurmasList = await Turma.find(ef).lean();
        const turmasSalaMap = {};
        dbTurmasList.forEach(t => {
            const nameKey = (t.nome || '').replace(/\s/g, '').toUpperCase();
            const idKey = (t.id || '').replace(/\s/g, '').toUpperCase();
            if (nameKey) turmasSalaMap[nameKey] = t.sala || '';
            if (idKey) turmasSalaMap[idKey] = t.sala || '';
        });

        const getSalaForTurma = (turmaName) => {
            if (!turmaName) return 'Sala de Aula';
            const cleanKey = turmaName.replace(/º/g, '').replace(/ANO/g, '').replace(/\s/g, '').toUpperCase();
            return turmasSalaMap[cleanKey] || 'Sala de Aula';
        };

        const diasSemanaMap = {
            'Segunda-feira': 'SEGUNDA',
            'Terça-feira': 'TERÇA',
            'Quarta-feira': 'QUARTA',
            'Quinta-feira': 'QUINTA',
            'Sexta-feira': 'SEXTA'
        };
        const diaBusca = diasSemanaMap[hojeNome] || 'SEGUNDA';

        const periodTimes = [
            { start: 7 * 60 + 30, end: 8 * 60 + 20, startStr: '07:30', rangeStr: '07:30 - 08:20' },
            { start: 8 * 60 + 20, end: 9 * 60 + 10, startStr: '08:20', rangeStr: '08:20 - 09:10' },
            { start: 9 * 60 + 30, end: 10 * 60 + 20, startStr: '09:30', rangeStr: '09:30 - 10:20' },
            { start: 10 * 60 + 20, end: 11 * 60 + 10, startStr: '10:20', rangeStr: '10:20 - 11:10' },
            { start: 11 * 60 + 10, end: 12 * 60 + 0, startStr: '11:10', rangeStr: '11:10 - 12:00' },
            { start: 13 * 60 + 0, end: 13 * 60 + 50, startStr: '13:00', rangeStr: '13:00 - 13:50' },
            { start: 13 * 60 + 50, end: 14 * 60 + 40, startStr: '13:50', rangeStr: '13:50 - 14:40' }
        ];

        if (turmas.length === 0) {
            proximasAulas = [];
        } else if (isPeb2) {
            // ========================================================
            // CRONOGRAMA DE HOJE PARA ESPECIALISTA (PEB II)
            // ========================================================
            // Busca as células do cronograma onde este professor leciona hoje no fuso do Brasil
            const TabelaGeral = require('../models/TabelaGeral');
            const cells = professorKey ? await TabelaGeral.find({
                professorKey: professorKey,
                dia: diaBusca
            }).lean() : [];

            const cellsMap = {};
            cells.forEach(c => {
                cellsMap[c.aulaIdx] = c;
            });

            proximasAulas = [];
            for (let i = 0; i < 7; i++) {
                const cell = cellsMap[i];
                const timeInfo = periodTimes[i];
                
                let status = 'Mais tarde';
                let statusColor = '';
                if (currentTotalMinutes >= timeInfo.end) {
                    status = 'Concluída';
                    statusColor = 'badge-ok';
                } else if (currentTotalMinutes >= timeInfo.start && currentTotalMinutes < timeInfo.end) {
                    status = 'Agora';
                    statusColor = 'badge-ok';
                } else {
                    status = `Às ${timeInfo.startStr}`;
                    statusColor = 'badge-warn';
                }

                if (cell) {
                    proximasAulas.push({
                        hora: timeInfo.startStr,
                        horarioRange: timeInfo.rangeStr,
                        materia: `${disciplinaName} (${cell.turmaNome})`,
                        turma: cell.turmaNome,
                        sala: getSalaForTurma(cell.turmaNome),
                        status: status,
                        statusColor: statusColor,
                        barColor: '#a855f7'
                    });
                } else {
                    // Horário Livre / Vagante / Planejamento
                    proximasAulas.push({
                        hora: timeInfo.startStr,
                        horarioRange: timeInfo.rangeStr,
                        materia: 'Horário de Planejamento',
                        turma: '-',
                        sala: 'Sala dos Professores',
                        status: status,
                        statusColor: statusColor,
                        barColor: 'rgba(255,255,255,0.06)'
                    });
                }
            }
        } else {
            // ========================================================
            // CRONOGRAMA DE HOJE PARA PROFESSOR REGULAR (PEB I)
            // ========================================================
            if (diaBusca === 'SEGUNDA') {
                // Grade exata da imagem do professor na segunda-feira (Mock do enunciado)
                const monAulas = [
                    {
                        hora: '07:30',
                        horarioRange: '07:30 – 09:10',
                        materia: 'Aula Regular (PEB 1)',
                        turma: '',
                        sala: 'Sala 16',
                        barColor: 'var(--primary-color)',
                        startMin: 7 * 60 + 30,
                        endMin: 9 * 60 + 10
                    },
                    {
                        hora: '09:30',
                        horarioRange: '09:30 – 11:10',
                        materia: 'Artes (PEB 2) — Prof. Mirian',
                        turma: '',
                        sala: 'Sala de Artes',
                        barColor: '#a855f7',
                        startMin: 9 * 60 + 30,
                        endMin: 11 * 60 + 10
                    },
                    {
                        hora: '11:10',
                        horarioRange: '11:10 – 12:00',
                        materia: 'Oficina de Leitura — Prof. Raquel',
                        turma: '',
                        sala: 'Biblioteca',
                        barColor: '#eab308',
                        startMin: 11 * 60 + 10,
                        endMin: 12 * 60 + 0
                    },
                    {
                        hora: '15:00',
                        horarioRange: '15:00 – 18:00',
                        materia: 'Reunião Pedagógica',
                        turma: '',
                        sala: 'Biblioteca',
                        barColor: '#ef4444',
                        startMin: 15 * 60 + 0,
                        endMin: 18 * 60 + 0
                    }
                ];

                proximasAulas = monAulas.map(aula => {
                    let status = 'Mais tarde';
                    let statusColor = '';

                    if (currentTotalMinutes >= aula.endMin) {
                        status = 'Concluída';
                        statusColor = 'badge-ok';
                    } else if (currentTotalMinutes >= aula.startMin && currentTotalMinutes < aula.endMin) {
                        status = 'Agora';
                        statusColor = 'badge-ok';
                    } else {
                        status = `Às ${aula.hora}`;
                        statusColor = 'badge-warn';
                    }

                    return {
                        hora: aula.hora,
                        horarioRange: aula.horarioRange,
                        materia: aula.materia,
                        turma: aula.turma || turmas[0],
                        sala: aula.sala,
                        status: status,
                        statusColor: statusColor,
                        barColor: aula.barColor
                    };
                });
            } else {
                // Outros dias da semana, carrega horários reais da turma do banco de dados
                const TabelaGeral = require('../models/TabelaGeral');
                const normalizedTurma = turmas[0].replace(/º/g, '').replace(/ANO/g, '').replace(/\s/g, '').toUpperCase();
                
                // Buscar células da turma no banco
                const cells = await TabelaGeral.find({
                    turmaId: normalizedTurma,
                    dia: diaBusca
                }).lean();

                const cellsMap = {};
                cells.forEach(c => {
                    cellsMap[c.aulaIdx] = c;
                });

                const abrevNomes = {
                    'EF': 'Ed. Física',
                    'I': 'Inglês',
                    'A': 'Artes',
                    'MK': 'Oficina Maker',
                    'OL': 'Oficina de Leitura',
                    'DSE': 'Oficina Sebrae/DSE',
                    'PROERD': 'PROERD',
                    'LIMA': 'PROERD'
                };

                proximasAulas = [];
                for (let i = 0; i < 7; i++) {
                    const cell = cellsMap[i];
                    let abrev = cell ? cell.abrev : '';
                    let materia = 'Aula Regular (PEB 1)';
                    let professorNome = '';

                    if (abrev && abrev.trim() !== '') {
                        materia = abrevNomes[abrev.toUpperCase()] || abrev;
                        const key = TabelaGeral.getProfessorKey(abrev, normalizedTurma);
                        professorNome = TabelaGeral.PROFESSOR_NOME[key] || '';
                        if (professorNome) {
                            materia = `${materia} (${professorNome.split(' ')[0]})`;
                        }
                    }

                    // Determinar o status temporal baseado na hora do dia
                    let status = 'Mais tarde';
                    let statusColor = '';
                    const timeInfo = periodTimes[i];
                    if (currentTotalMinutes >= timeInfo.end) {
                        status = 'Concluída';
                        statusColor = 'badge-ok';
                    } else if (currentTotalMinutes >= timeInfo.start && currentTotalMinutes < timeInfo.end) {
                        status = 'Agora';
                        statusColor = 'badge-ok';
                    } else {
                        status = `Às ${timeInfo.startStr}`;
                        statusColor = 'badge-warn';
                    }

                    proximasAulas.push({
                        hora: timeInfo.startStr,
                        horarioRange: timeInfo.rangeStr,
                        materia: materia,
                        turma: turmas[0],
                        sala: getSalaForTurma(turmas[0]),
                        status: status,
                        statusColor: statusColor,
                        barColor: abrev ? '#a855f7' : 'var(--a)'
                    });
                }
            }
        }

        // --- REUNIÃO PEDAGÓGICA: toda segunda-feira das 15:00 às 18:00 ---
        const isSegunda = brasilDay === 1; // 1 = Segunda-feira (fuso Brasil)

        if (isSegunda) {
            // Só adiciona se não estiver presente na lista (para evitar duplicidade)
            const jaTemReuniao = proximasAulas.some(a => a.materia.includes('Pedagógica') || a.materia.includes('pedagógica'));
            if (!jaTemReuniao) {
                let status = 'Às 15:00';
                let statusColor = 'badge-warn';
                if (currentTotalMinutes >= 18 * 60) {
                    status = 'Concluída';
                    statusColor = 'badge-ok';
                } else if (currentTotalMinutes >= 15 * 60 && currentTotalMinutes < 18 * 60) {
                    status = 'Agora';
                    statusColor = 'badge-ok';
                }

                proximasAulas.push({
                    hora: '15:00',
                    horarioRange: '15:00 - 18:00',
                    materia: 'Reunião Pedagógica',
                    turma: '',
                    sala: 'Biblioteca',
                    status: status,
                    statusColor: statusColor,
                    barColor: '#ef4444'
                });
            }
        }
        // Aviso especial de segunda-feira
        let ultimoAvisoText = avisos.length > 0 ? (avisos[0].mensagem || avisos[0].titulo) : 'Nenhum aviso pendente';
        if (isSegunda) {
            ultimoAvisoText = 'Reunião pedagógica das 15:00 às 18:00 na Biblioteca.';
        }

        let saudacao = 'Bom dia';
        if (brasilHour >= 12 && brasilHour < 18) {
            saudacao = 'Boa tarde';
        } else if (brasilHour >= 18 || brasilHour < 5) {
            saudacao = 'Boa noite';
        }

        const turmaLabel = (turmas.length > 0) ? turmas.join(', ') : 'Nenhuma turma';

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
                saudacao: saudacao
            }
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
        const notices = await Notificacao.find(escolaMatch(req.escolaId)).sort({ dataCriacao: -1 }).lean();

        // Resolve os IDs de destinatários para nomes amigáveis
        const resolvedNotices = await Promise.all(notices.map(async (notice) => {
            let destName = notice.destinatarios;
            if (notice.destinatarios === 'todos') {
                destName = 'Todos';
            } else if (notice.destinatarios === 'professores') {
                destName = 'Professores';
            } else if (notice.destinatarios === 'diretores') {
                destName = 'Diretores';
            } else if (notice.destinatarios && notice.destinatarios.length === 24 && /^[0-9a-fA-F]{24}$/.test(notice.destinatarios)) {
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
                        { nome: notice.destinatarios }
                    ] 
                }).lean();
                if (turma) {
                    destName = `Turma: ${turma.nome || turma.id}`;
                }
            }
            return {
                ...notice,
                destinatarioNome: destName
            };
        }));
        
        res.json({
            success: true,
            data: resolvedNotices
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
