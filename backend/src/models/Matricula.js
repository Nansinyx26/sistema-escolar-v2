const mongoose = require('mongoose');

const MatriculaSchema = new mongoose.Schema(
    {
        _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
        id: { type: mongoose.Schema.Types.Mixed, index: true }, // Optional auto-increment ID if needed

        alunoId: { type: String, required: true, ref: 'Aluno', index: true }, // Referencia ao Aluno
        turmaId: { type: String, required: true, ref: 'Turma', index: true }, // Referencia a Turma

        // Multi-escola: isolamento por tenant (_id de Escola)
        escolaId: { type: String, index: true },

        anoLetivo: { type: Number, required: true, index: true }, // Ex: 2024, 2025
        matriculaNumero: { type: String }, // Ex: "2024001" — unicidade por escola em schema.index abaixo

        status: {
            type: String,
            enum: [
                'cursando',
                'aprovado',
                'reprovado',
                'aprovado_conselho',
                'transferido',
                'evadido',
            ],
            default: 'cursando',
        },

        numeroChamada: Number,
        serie: { type: String }, // Série lida do relatório da SEDUC ("5", "9"...)
        dataMatricula: { type: Date, default: Date.now },

        // Lote de importação que criou este vínculo. É o que permite desfazer a
        // importação removendo SÓ as matrículas daquele lote.
        importacaoId: { type: String, default: null },

        // Campos de saída (transferência, evasão, etc.)
        dataSaida: { type: Date, default: null },
        motivoSaida: { type: String, default: null }, // Ex: "Transferência para outra escola", "Evasão"

        // Auditoria: quem criou/alterou a matrícula
        criadoPor: { type: String, ref: 'Usuario', default: null }, // ID do usuário que criou (secretaria, admin)

        observacoes: String,
    },
    {
        timestamps: true,
        collection: 'matriculas',
    }
);

// Um aluno só pode ter uma matrícula ativa por escola por ano letivo.
// escolaId é necessário: um aluno transferido de escola no mesmo ano letivo
// teria o mesmo alunoId+anoLetivo em duas escolas distintas sem essa chave.
MatriculaSchema.index({ escolaId: 1, alunoId: 1, anoLetivo: 1 }, { unique: true });
// Número de matrícula é único dentro de cada escola, não globalmente.
MatriculaSchema.index(
    { escolaId: 1, matriculaNumero: 1 },
    { unique: true, partialFilterExpression: { matriculaNumero: { $type: 'string' } } }
);
// Listagem de alunos de uma turma num ano letivo — a consulta da tela da turma.
MatriculaSchema.index({ escolaId: 1, turmaId: 1, anoLetivo: 1 });
// "Desfazer importação": todas as matrículas criadas por um lote.
MatriculaSchema.index(
    { escolaId: 1, importacaoId: 1 },
    { partialFilterExpression: { importacaoId: { $type: 'string' } } }
);

module.exports = mongoose.model('Matricula', MatriculaSchema);
