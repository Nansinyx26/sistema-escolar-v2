const mongoose = require('mongoose');

const GradeHorariaSchema = new mongoose.Schema({
    professorId: {
        type: String, // Alterado para String pois Professor uses String _id
        ref: 'Professor',
        required: true
    },
    turmaId: {
        type: String, // Alterado de ObjectId para String para compatibilidade com Model Turma
        ref: 'Turma',
        required: true
    },
    disciplina: {
        type: String,
        required: true // Ex: "Matemática", "Programação Web", etc.
    },
    diaSemana: {
        type: Number,
        required: true,
        min: 0,
        max: 6
        // 0: Domingo, 1: Segunda, ..., 6: Sábado (Padrão JS .getDay())
    },
    horaInicio: {
        type: String,
        required: true,
        match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ // Validação HH:mm
    },
    horaFim: {
        type: String,
        required: true,
        match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/
    },
    aulasSeguidas: {
        type: Number,
        default: 1
    },
    ativo: {
        type: Boolean,
        default: true
    },
    criadoEm: {
        type: Date,
        default: Date.now
    }
}, {
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
    id: false,
    collection: 'gradehorarias'
});

// Virtual Population para Professor
GradeHorariaSchema.virtual('professorDetails', {
    ref: 'Professor',
    localField: 'professorId',
    foreignField: '_id',
    justOne: true
});

// Virtual Population para Turma
GradeHorariaSchema.virtual('turmaDetails', {
    ref: 'Turma',
    localField: 'turmaId',
    foreignField: '_id',
    justOne: true
});

// Índice para otimizar busca rápida por dia e horário
GradeHorariaSchema.index({ professorId: 1, diaSemana: 1, horaInicio: 1 });
GradeHorariaSchema.index({ turmaId: 1, diaSemana: 1, horaInicio: 1 });

module.exports = mongoose.model('GradeHoraria', GradeHorariaSchema);
