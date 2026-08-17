const mongoose = require('mongoose');

const NotaEmbutidaSchema = new mongoose.Schema(
    {
        materia: String,
        valor: Number, // ou String, dependendo do front
        data: Date,
        bimestre: Number,
        tipo: String,
    },
    { _id: false }
);

const FaltaEmbutidaSchema = new mongoose.Schema(
    {
        data: Date,
        motivo: String,
        presente: Boolean,
        materia: String,
    },
    { _id: false }
);

const ResponsavelSchema = new mongoose.Schema(
    {
        nome: String,
        tipo: {
            type: String,
            enum: ['Mãe', 'Pai', 'Responsável Legal', 'Avó', 'Avô', 'Tutor(a)', 'Outro'],
        },
        parentesco: String,
        cpf: String,
        telefone: String,
        whatsapp: String,
        email: String,
        responsabilidadeFinanceira: { type: String, enum: ['Sim', 'Não', 'Parcial'] },
        autorizadoBusca: { type: Boolean, default: true },
    },
    { _id: false }
);

const PessoaAutorizadaSchema = new mongoose.Schema(
    {
        nome: String,
        parentesco: String,
        telefone: String,
        documento: String,
    },
    { _id: false }
);

const AutorizacoesEscolaresSchema = new mongoose.Schema(
    {
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
        medicamentoDose: String,
    },
    { _id: false }
);

const DocumentoArquivoSchema = new mongoose.Schema(
    {
        id: String,
        nome: String,
        tipo: String,
        gridfsId: String,
        enviadoEm: { type: Date, default: Date.now },
    },
    { _id: false }
);

const AlunoSchema = new mongoose.Schema(
    {
        _id: {
            type: mongoose.Schema.Types.Mixed,
            default: () => new mongoose.Types.ObjectId().toString(),
        },
        escolaId: { type: String, index: true }, // Multi-escola: discriminador de tenant
        id: { type: mongoose.Schema.Types.Mixed, index: true }, // Pode ser numero (legacy) ou string/uuid
        nome: { type: String, required: true },
        sobrenome: String,
        // Chave de busca e de detecção de duplicata por nome: minúsculo, sem
        // acento, sem espaço duplo. Mantido pelo pre-save abaixo — nenhum caminho
        // de escrita precisa lembrar de calcular.
        nomeNormalizado: { type: String },
        // RA (Registro Acadêmico) — unicidade por escola em schema.index abaixo.
        // `alias: 'ra'` porque o relatório da SEDUC e o módulo de importação falam
        // "RA"; o campo físico continua sendo `matricula`, que é como o resto do
        // sistema (e os documentos já gravados) o conhece.
        matricula: { type: String, sparse: true, alias: 'ra' },
        raDigito: { type: String }, // 1 caractere: 0-9 ou X. NUNCA validar DV — ver services/importacaoAlunos/normalizacao.js
        raUf: { type: String, default: 'SP' },

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
        guardaLegal: {
            type: String,
            enum: ['Mãe', 'Pai', 'Responsável 1', 'Responsável 2', 'Ambos', ''],
        },
        pessoasAutorizadasRetirada: { type: [PessoaAutorizadaSchema], default: undefined },
        autorizacoesEscolares: { type: AutorizacoesEscolaresSchema, default: undefined },
        fichaDocumentoStatus: {
            type: String,
            enum: ['pendente', 'enviado', 'conferido'],
            default: 'pendente',
        },
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
        // `alias: 'possuiDeficiencia'` — o relatório da SEDUC chama a coluna de
        // "Deficiência (Sim/Não)". Campo físico continua `pcd`.
        pcd: { type: Boolean, default: false, alias: 'possuiDeficiencia' },
        // Texto livre da coluna "Transtorno(s) que impacta(m) o desenvolvimento da
        // aprendizagem" do relatório da SED, já quebrado em itens.
        transtornos: { type: [String], default: undefined },

        // ─── Situação escolar (relatório SEDUC) ─────────────────────────────────
        situacao: {
            type: String,
            enum: ['ativo', 'transferido', 'abandono', 'nao_compareceu', 'remanejado', 'outros'],
            default: 'ativo',
        },
        dataMovimentacao: Date,

        // ─── Procedência do cadastro ────────────────────────────────────────────
        // `importacaoId` é o que torna a importação DESFAZÍVEL: sem ele não há como
        // distinguir o aluno que aquele lote criou do que já existia antes, e
        // "desfazer" viraria exclusão às cegas de aluno de verdade.
        origemCadastro: {
            type: String,
            enum: ['manual', 'importacao_pdf', 'importacao_planilha'],
            default: 'manual',
        },
        importacaoId: { type: String, default: null },

        foto: String, // Pode ser DataURL ou ID do GridFS

        // Campos de controle
        ativo: { type: Boolean, default: true },
        codigoSecreto: { type: String, unique: true, sparse: true },
    },
    {
        timestamps: true,
        strict: true,
        collection: 'alunos',
    }
);

// pre-save hook to ensure every student always has a unique secret code
//
// SEGURANÇA: o gerador vive em utils/secretCodeHelper e usa crypto.randomInt.
// A versão anterior duplicava a lógica aqui com Math.random() — um PRNG cujo
// estado é recuperável a partir de poucas saídas, e todo responsável recebe
// legitimamente um código. Manter uma única implementação evita que uma das
// duas volte a ficar fraca sem ninguém notar.
AlunoSchema.pre('save', async function (next) {
    try {
        // `nomeNormalizado` é derivado, nunca informado pelo cliente. Calculá-lo
        // aqui garante que os três caminhos de escrita (cadastro individual,
        // importação em lote e edição) gravem a MESMA chave de busca.
        if (this.isModified('nome') || this.isModified('sobrenome') || !this.nomeNormalizado) {
            const { normalizarNome } = require('../utils/nomeAluno');
            this.nomeNormalizado = normalizarNome(`${this.nome || ''} ${this.sobrenome || ''}`);
        }

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
// Todos os alunos ativos de uma escola. É a consulta do relatório "alunos por
// turma", que passou a buscar a escola inteira de uma vez em vez de fazer uma
// ida ao banco por turma. Sem este índice composto, o filtro por `escolaId`
// resolve pelo índice simples do campo e o `ativo` sobra para varredura.
AlunoSchema.index({ escolaId: 1, ativo: 1 });
// Matrícula (RA) é única dentro de cada escola, não globalmente.
// Um RA "2024001" na Escola A é independente do mesmo número na Escola B.
// partialFilterExpression exclui alunos sem RA atribuído ainda.
AlunoSchema.index(
    { escolaId: 1, matricula: 1 },
    { unique: true, partialFilterExpression: { matricula: { $type: 'string' } } }
);
// Busca por nome no autocomplete da secretaria e detecção de duplicata por
// nome. O índice `text` acima não serve: ele casa por palavra inteira e não
// atende busca por prefixo enquanto a pessoa digita.
AlunoSchema.index({ escolaId: 1, nomeNormalizado: 1 });
// "Desfazer importação": encontra em uma tacada os alunos criados por um lote.
// partialFilterExpression mantém o índice pequeno — a esmagadora maioria dos
// alunos não veio de importação.
AlunoSchema.index(
    { escolaId: 1, importacaoId: 1 },
    { partialFilterExpression: { importacaoId: { $type: 'string' } } }
);

module.exports = mongoose.models.Aluno || mongoose.model('Aluno', AlunoSchema);
