const mongoose = require('mongoose');

const ChatDiretoSchema = new mongoose.Schema({
    remetenteId: { type: String, required: true, index: true },
    destinatarioId: { type: String, required: true, index: true },
    // Multi-escola: isolamento por tenant (_id de Escola)
    escolaId: { type: String, index: true },
    turmaId: String,
    alunoId: String,
    contexto: {
        tipo: { type: String, enum: ['FALTA', 'NOTA', 'PEDAGOGICO', 'GERAL'], default: 'GERAL' },
        referenciaId: String // ID da falta ou nota relacionada
    },
    mensagem: { type: String, default: '' },
    anexo: {
        url: String,
        nome: String,
        tipo: String,
        tamanho: Number,
        gridfsId: String,
        miniatura: String
    },
    audio: {
        url: String,
        duracao: Number,
        gridfsId: String
    },
    editada: { type: Boolean, default: false },
    editadaEm: Date,
    encaminhada: { type: Boolean, default: false },
    apagadaParaTodos: { type: Boolean, default: false },
    apagadaPara: [{ type: String }],
    respostaParaId: { type: String },
    reacoes: [{
        usuarioId: String,
        usuarioNome: String,
        emoji: String,
        criadoEm: { type: Date, default: Date.now }
    }],
    status: { type: String, enum: ['enviada', 'entregue', 'lida'], default: 'enviada' },
    lida: { type: Boolean, default: false },
    // Veredito da moderação de conteúdo. O default 'aprovada' é o que permite
    // ligar isto sem migrar nada: mensagem antiga (sem o campo) e mensagem nova
    // sem análise se comportam igual ao que sempre foi.
    //
    // Quem PREENCHE este campo é o sistema de moderação de áudio/imagem, ainda
    // não implementado (ver docs/moderacao/ESPEC-MODERACAO-CHAT.md). Quem já o
    // RESPEITA é o getHistorico e o encaminhamento — de propósito: a barreira
    // precisa existir antes do que vai acioná-la, senão a primeira mensagem
    // bloqueada continua saindo pelo histórico.
    moderacao: {
        status: {
            type: String,
            enum: ['aprovada', 'pendente', 'em_revisao', 'bloqueada'],
            default: 'aprovada'
        },
        severidade: {
            type: String,
            enum: ['nenhuma', 'leve', 'moderada', 'grave', 'critica'],
            default: 'nenhuma'
        },
        origem: { type: String, enum: ['texto', 'audio', 'imagem'] },
        ocorrenciaId: String,
        analisadaEm: Date
    },
    dataEnvio: { type: Date, default: Date.now }
}, {
    timestamps: true,
    collection: 'chat_direto'
});

// Índice para listar conversas entre dois usuários.
// Cobre as DUAS direções do $or do histórico (remetente→destinatário e o
// inverso) como prefixo, e já entrega ordenado por createdAt — medido: 31 keys
// examinadas para 31 documentos retornados, sem COLLSCAN.
ChatDiretoSchema.index({ remetenteId: 1, destinatarioId: 1, createdAt: -1 });

// Fila de revisão humana: "o que desta escola está parado esperando decisão".
// Parcial porque 'aprovada' é a esmagadora maioria e não interessa à fila —
// indexar tudo seria pagar por um índice que só se consulta pelo complemento.
ChatDiretoSchema.index(
    { escolaId: 1, 'moderacao.status': 1, createdAt: -1 },
    {
        name: 'fila_moderacao',
        partialFilterExpression: { 'moderacao.status': { $in: ['pendente', 'em_revisao', 'bloqueada'] } }
    }
);

// ============================================
// RETENÇÃO — LGPD
// ============================================
// As conversas do chat podem citar alunos por nome, então são dado pessoal com
// prazo. A retenção é OPT-IN por ambiente: apagar automaticamente comunicação
// escolar sem a instituição decidir o prazo seria destruir registro que ela
// pode precisar (conselho de classe, ocorrência disciplinar).
//
// Defina CHAT_RETENCAO_DIAS para ligar. Ex.: 730 = 2 anos.
// Sem a variável, nada expira e o histórico é preservado indefinidamente.
const RETENCAO_DIAS = parseInt(process.env.CHAT_RETENCAO_DIAS, 10);
if (Number.isFinite(RETENCAO_DIAS) && RETENCAO_DIAS > 0) {
    ChatDiretoSchema.index(
        { createdAt: 1 },
        { expireAfterSeconds: RETENCAO_DIAS * 24 * 60 * 60, name: 'retencao_lgpd' }
    );
}

module.exports = mongoose.model('ChatDireto', ChatDiretoSchema);
