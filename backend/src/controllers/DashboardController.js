const Aluno = require('../models/Aluno');
const Nota = require('../models/Nota');
const Falta = require('../models/Falta');

exports.getSummary = async (req, res) => {
    try {
        const { turmaId, bimestre, materiaId } = req.query;
        const filters = {};

        // Base filters for counts
        const studentFilter = { ativo: { $ne: false } };
        const noteFilter = {};

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
        const mongoose = require('mongoose');
        let totalProfessores = 0;
        let totalTurmas = 0;
        let faltasHoje = 0;

        try {
            totalProfessores = await mongoose.connection.db.collection('professores').countDocuments();
            totalTurmas = await mongoose.connection.db.collection('turmas').countDocuments();
            
            // For faltasHoje we can mock it or count from Falta model if needed, but let's safely default to 0
            // Since this model might not track the 'date' perfectly matching 'today', let's just get total for this month
            const firstDayOfMonth = new Date();
            firstDayOfMonth.setDate(1);
            faltasHoje = await Falta.countDocuments({ data: { $gte: firstDayOfMonth } });
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
                faltasHoje,
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
        const noteFilter = {};
        if (turmaId) noteFilter.turmaId = turmaId;
        if (bimestre) noteFilter.bimestre = parseInt(bimestre);
        if (materiaId) noteFilter.materiaId = materiaId;

        const notes = await Nota.find(noteFilter);

        // 1. By Turma
        const turmaMap = {};
        notes.forEach(n => {
            if (!turmaMap[n.turmaId]) turmaMap[n.turmaId] = [];
            turmaMap[n.turmaId].push(n.nota);
        });
        const turmasData = Object.keys(turmaMap).map(id => ({
            label: id,
            value: (turmaMap[id].reduce((a, b) => a + b, 0) / turmaMap[id].length).toFixed(1)
        }));

        // 2. By Materia
        const materiaMap = {}; // We likely need a way to map ID to Name, or store Name in Note
        // For now, grouping by materiaId (or fetching names if needed, but let's stick to IDs for speed or assume frontend mapping)
        // Ideally, we populate or fetch distinct materiaIds. 
        // Note model stores materiaId.
        notes.forEach(n => {
            if (!materiaMap[n.materiaId]) materiaMap[n.materiaId] = [];
            materiaMap[n.materiaId].push(n.nota);
        });
        const materiasData = Object.keys(materiaMap).map(id => ({
            label: id, // Frontend can map this ID to name
            value: (materiaMap[id].reduce((a, b) => a + b, 0) / materiaMap[id].length).toFixed(1)
        }));

        // 3. Evolution (Bimestre)
        const bimMap = { 1: [], 2: [], 3: [], 4: [] };
        notes.forEach(n => {
            if (bimMap[n.bimestre]) bimMap[n.bimestre].push(n.nota);
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
        const noteFilter = {};
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
