/**
 * ImportacaoAlunos — sessão de importação em lote de alunos.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * A importação tem dois passos separados por uma decisão humana: primeiro o
 * arquivo é lido e mostrado para conferência, depois o usuário confirma. O
 * resultado do parse precisa sobreviver a esse intervalo.
 *
 * Guardar em memória do processo ou em disco QUEBRA no Render:
 *   - o filesystem é efêmero (some no próximo deploy, e some do nada no plano
 *     free quando a instância hiberna);
 *   - pode haver mais de uma instância, e o "confirmar" tem grande chance de
 *     cair numa instância diferente da que fez o "preview" — que não teria a
 *     menor ideia de qual arquivo é aquele.
 *
 * O ARQUIVO ENVIADO NÃO É GRAVADO. Ele é lido em memória, transformado neste
 * documento e descartado. O que persiste é o resultado estruturado, por no
 * máximo duas horas.
 *
 * LGPD: este documento contém nome, RA e data de nascimento de crianças. Por
 * isso o TTL não é conveniência de limpeza, é minimização de dado: passada a
 * janela de confirmação, não existe motivo para a cópia continuar viva.
 */
const mongoose = require('mongoose');

const MensagemSchema = new mongoose.Schema(
    {
        tipo: { type: String, enum: ['erro', 'aviso', 'info'], default: 'info' },
        texto: String,
    },
    { _id: false }
);

const DivergenciaSchema = new mongoose.Schema(
    {
        campo: String,
        rotulo: String,
        atual: String,
        arquivo: String,
    },
    { _id: false }
);

const LinhaSchema = new mongoose.Schema(
    {
        indice: { type: Number, required: true },
        // Como veio do arquivo, para a auditoria e para a edição inline no preview.
        dadosBrutos: { type: mongoose.Schema.Types.Mixed },
        // Já normalizado no formato que vai para a collection `alunos`.
        dadosNormalizados: { type: mongoose.Schema.Types.Mixed },
        status: {
            type: String,
            enum: [
                'novo',
                'existente',
                'ja_na_turma',
                'divergente',
                'erro',
                'duplicado_no_arquivo',
            ],
            required: true,
        },
        mensagens: { type: [MensagemSchema], default: [] },
        alunoExistenteId: { type: String, default: null },
        divergencias: { type: [DivergenciaSchema], default: [] },
        // Preenchido quando o aluno já está matriculado em OUTRA turma no mesmo
        // ano: confirmar a linha transfere, e a tela precisa avisar antes.
        transferenciaDe: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    { _id: false }
);

const CabecalhoSchema = new mongoose.Schema(
    {
        codigoEscola: String,
        nomeEscola: String,
        codigoClasse: String,
        tipoEnsino: String,
        habilitacao: String,
        sala: String,
        turma: String,
        totais: { type: mongoose.Schema.Types.Mixed },
    },
    { _id: false }
);

const ImportacaoAlunosSchema = new mongoose.Schema(
    {
        _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },

        // Multi-escola: toda query deste módulo filtra por aqui. Nunca vem do
        // corpo da requisição — só da sessão autenticada.
        escolaId: { type: String, index: true },
        turmaId: { type: String, required: true, index: true },
        anoLetivo: { type: Number, required: true },

        usuarioId: { type: String, ref: 'Usuario' },
        nomeArquivo: String,
        tipoArquivo: { type: String, enum: ['pdf', 'xlsx', 'csv'] },
        // SHA-256 do arquivo. Serve à auditoria (provar QUAL arquivo gerou o lote)
        // sem guardar o arquivo. O conteúdo nunca é persistido.
        hashArquivo: String,
        tamanhoArquivo: Number,

        cabecalho: { type: CabecalhoSchema, default: () => ({}) },
        linhas: { type: [LinhaSchema], default: [] },
        resumo: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
        avisos: { type: [String], default: [] },

        status: {
            type: String,
            enum: ['preview', 'confirmada', 'cancelada', 'expirada', 'desfeita'],
            default: 'preview',
            index: true,
        },

        // Preenchido na confirmação: o que efetivamente foi gravado.
        resultado: { type: mongoose.Schema.Types.Mixed, default: null },

        confirmadoEm: { type: Date, default: null },
        desfeitoEm: { type: Date, default: null },
        desfeitoPor: { type: String, default: null },

        // TTL: o índice abaixo apaga o documento QUANDO O RELÓGIO PASSA deste
        // instante (expireAfterSeconds: 0). Definido para criadoEm + 2 h.
        expiraEm: { type: Date, required: true },
    },
    {
        timestamps: { createdAt: 'criadoEm', updatedAt: 'atualizadoEm' },
        collection: 'importacoes_alunos',
    }
);

// TTL. `expireAfterSeconds: 0` significa "expira no instante gravado no campo",
// não "expira em 0 segundos".
ImportacaoAlunosSchema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });

// Listagem de lotes de uma turma (histórico e botão "desfazer").
ImportacaoAlunosSchema.index({ escolaId: 1, turmaId: 1, criadoEm: -1 });

/** Janela de vida do preview (§2.3). */
ImportacaoAlunosSchema.statics.PRAZO_PREVIEW_MS = 2 * 60 * 60 * 1000;

/**
 * Janela em que a importação ainda pode ser desfeita (§5.7).
 * Uma importação confirmada tem o `expiraEm` empurrado para cá — precisa
 * sobreviver às 2 h do preview para que o botão "Desfazer" exista de verdade.
 */
ImportacaoAlunosSchema.statics.PRAZO_DESFAZER_MS = 24 * 60 * 60 * 1000;

module.exports =
    mongoose.models.ImportacaoAlunos || mongoose.model('ImportacaoAlunos', ImportacaoAlunosSchema);
