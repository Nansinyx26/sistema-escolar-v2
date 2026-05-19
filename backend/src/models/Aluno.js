const mongoose = require('mongoose');

const NotaEmbutidaSchema = new mongoose.Schema({
    materia: String,
    valor: Number, // ou String, dependendo do front
    data: Date,
    bimestre: Number,
    tipo: String
}, { _id: false });

const FaltaEmbutidaSchema = new mongoose.Schema({
    data: Date,
    motivo: String,
    presente: Boolean,
    materia: String
}, { _id: false });

const AlunoSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    id: { type: mongoose.Schema.Types.Mixed, index: true }, // Pode ser numero (legacy) ou string/uuid
    nome: { type: String, required: true },
    sobrenome: String,
    matricula: { type: String, unique: true, sparse: true }, // RA (Registro Acadêmico) - Fixo do aluno

    // --- LEGACY/CACHE (Agora gerenciado pela entidade 'Matricula') ---
    turma: { type: String, index: true }, // Ex: "1A" (Manter por compatibilidade ou cache)
    turmaId: { type: String, index: true }, // Alias (Manter por compatibilidade)
    // -----------------------------------------------------------------
    nascimento: Date,
    responsavel: String,
    telefone: String,
    endereco: mongoose.Schema.Types.Mixed,
    cpfAluno: String,
    nacionalidade: String,
    etnia: String,
    religiao: String,
    responsavelDados: mongoose.Schema.Types.Mixed,
    alergiasAlimentos: String,
    alergiasRemedio: String,
    planoSaude: String,
    documentos: mongoose.Schema.Types.Mixed,
    lgpdConsentimento: mongoose.Schema.Types.Mixed,

    // Dados acadêmicos
    nivel: String, // Nível do aluno
    nivelBimestre: { type: Map, of: String }, // Nível por bimestre: { "1": "A", "2": "B" }
    condicao: String, // Condição do aluno
    condicaoOutro: String, // Condição 'Outros' (específica)
    observacoes: String, // Observações gerais
    observacoesBimestre: { type: Map, of: String }, // Observações por bimestre

    // Recuperação por bimestre: { "1": { lp: true, mat: false }, ... }
    recuperacaoBimestre: { type: Map, of: mongoose.Schema.Types.Mixed },

    // Faltas por bimestre: { "1": 5, "2": 0, ... }
    faltasBimestre: { type: Map, of: Number },

    // Médias (calculadas mas podem ser salvas para cache)
    mediaInterna: Number,
    mediaGeral: Number,

    // Dados acadêmicos embutidos (opcional, pode ser normalizado em outras collections)
    notas: [NotaEmbutidaSchema],
    faltas: [FaltaEmbutidaSchema],

    descricao: String, // Observações gerais

    // PCD
    deficiencia: String, // mapear de pcdDescricao
    pcd: Boolean,

    foto: String, // Pode ser DataURL ou ID do GridFS

    // Campos de controle
    ativo: { type: Boolean, default: true },
}, {
    timestamps: true,
    strict: true,
    collection: 'alunos'
});

// ============================================
// MELHORIA: Índices de Performance (Roadmap #7)
// ============================================
// Busca textual por nome (base para paginação server-side e busca rápida)
AlunoSchema.index({ nome: 'text', sobrenome: 'text' });
// Consulta mais comum: alunos ativos de uma turma específica
AlunoSchema.index({ turma: 1, ativo: 1 });
AlunoSchema.index({ turmaId: 1, ativo: 1 });

module.exports = mongoose.model('Aluno', AlunoSchema);
