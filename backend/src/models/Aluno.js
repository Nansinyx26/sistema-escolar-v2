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

const ResponsavelSchema = new mongoose.Schema({
    nome: String,
    tipo: { type: String, enum: ['Mãe', 'Pai', 'Responsável Legal', 'Avó', 'Avô', 'Tutor(a)', 'Outro'] },
    parentesco: String,
    cpf: String,
    telefone: String,
    whatsapp: String,
    email: String,
    responsabilidadeFinanceira: { type: String, enum: ['Sim', 'Não', 'Parcial'] },
    autorizadoBusca: { type: Boolean, default: true }
}, { _id: false });

const PessoaAutorizadaSchema = new mongoose.Schema({
    nome: String,
    parentesco: String,
    telefone: String,
    documento: String
}, { _id: false });

const AutorizacoesEscolaresSchema = new mongoose.Schema({
    tratamentoOdontologico: { type: Boolean, default: null },
    tratamentoMedicoEmergencial: { type: Boolean, default: null },
    testagemAcuidade: { type: Boolean, default: null },
    atividadesFisicas: { type: Boolean, default: null },
    atividadesExtraclasse: { type: Boolean, default: null },
    conducaoEscolar: { type: Boolean, default: null },
    motoristaNome: String,
    motoristaTelefone: String,
    antitermico: { type: Boolean, default: null },
    medicamentoNome: String,
    medicamentoDose: String
}, { _id: false });

const DocumentoArquivoSchema = new mongoose.Schema({
    id: String,
    nome: String,
    tipo: String,
    gridfsId: String,
    enviadoEm: { type: Date, default: Date.now }
}, { _id: false });

const AlunoSchema = new mongoose.Schema({
    _id: { type: mongoose.Schema.Types.Mixed, default: () => new mongoose.Types.ObjectId().toString() },
    escolaId: { type: String, index: true }, // Multi-escola: discriminador de tenant
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
    responsaveis: { type: [ResponsavelSchema], default: undefined },
    guardaLegal: { type: String, enum: ['Mãe', 'Pai', 'Responsável 1', 'Responsável 2', 'Ambos', ''] },
    pessoasAutorizadasRetirada: { type: [PessoaAutorizadaSchema], default: undefined },
    autorizacoesEscolares: { type: AutorizacoesEscolaresSchema, default: undefined },
    fichaDocumentoStatus: { type: String, enum: ['pendente', 'enviado', 'conferido'], default: 'pendente' },
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
    codigoSecreto: { type: String, unique: true, sparse: true },
}, {
    timestamps: true,
    strict: true,
    collection: 'alunos'
});

// pre-save hook to ensure every student always has a unique secret code
//
// SEGURANÇA: o gerador vive em utils/secretCodeHelper e usa crypto.randomInt.
// A versão anterior duplicava a lógica aqui com Math.random() — um PRNG cujo
// estado é recuperável a partir de poucas saídas, e todo responsável recebe
// legitimamente um código. Manter uma única implementação evita que uma das
// duas volte a ficar fraca sem ninguém notar.
AlunoSchema.pre('save', async function (next) {
    try {
        const atual = typeof this.codigoSecreto === 'string' ? this.codigoSecreto.trim() : '';
        const invalido = !atual || ['N/A', 'n/a'].includes(atual);

        if (invalido) {
            const { generateUniqueSecretCode } = require('../utils/secretCodeHelper');
            this.codigoSecreto = await generateUniqueSecretCode();
        } else {
            this.codigoSecreto = atual.toUpperCase();
        }
        next();
    } catch (err) {
        next(err);
    }
});

// ============================================
// MELHORIA: Índices de Performance (Roadmap #7)
// ============================================
// Busca textual por nome (base para paginação server-side e busca rápida)
AlunoSchema.index({ nome: 'text', sobrenome: 'text' });
// Consulta mais comum: alunos ativos de uma turma específica
AlunoSchema.index({ turma: 1, ativo: 1 });
AlunoSchema.index({ turmaId: 1, ativo: 1 });

module.exports = mongoose.models.Aluno || mongoose.model('Aluno', AlunoSchema);
