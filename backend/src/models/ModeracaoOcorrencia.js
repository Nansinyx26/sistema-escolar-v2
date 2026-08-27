/**
 * ModeracaoOcorrencia — o registro de UMA decisão de moderação.
 *
 * O QUE ESTE DOCUMENTO NÃO GUARDA (§6.1 da ESPEC-MODERACAO-CHAT.md)
 * ================================================================
 * Não guarda o texto ofensivo, não guarda transcrição de áudio, não guarda
 * cópia do binário e não guarda o payload bruto do provedor externo. É a mesma
 * decisão já tomada em `registrarTentativa()`: saber QUE houve tentativa e de
 * QUEM, sem arquivar o conteúdo num documento que qualquer pessoa com acesso ao
 * banco pode ler. A ocorrência APONTA para a mensagem/arquivo original.
 *
 * `conteudoHash` é o que permite detectar reenvio do mesmo material sem
 * guardá-lo: SHA-256 do texto normalizado ou do binário.
 *
 * `termosDetectados` é a única exceção e só vale para a camada léxica — aquelas
 * palavras já estão no dicionário público deste repositório, então registrá-las
 * não revela nada que o código não revele.
 */

const mongoose = require('mongoose');

const SEIS_MESES_MS = 182 * 24 * 60 * 60 * 1000;
const CINCO_ANOS_MS = 5 * 365 * 24 * 60 * 60 * 1000;

const ModeracaoOcorrenciaSchema = new mongoose.Schema(
    {
        // Base do isolamento multi-tenant (P4). Toda leitura da fila filtra por aqui.
        escolaId: { type: String, index: true },

        // Null quando o bloqueio foi PRÉ-persistência — que é o caso normal da
        // Camada 1: o middleware barra antes de existir documento de mensagem.
        mensagemId: { type: String, default: null },
        gridfsId: { type: String, default: null },

        tipoConteudo: { type: String, enum: ['texto', 'audio', 'imagem'], required: true },
        conteudoHash: { type: String },

        remetenteId: { type: String, index: true },
        remetentePerfil: { type: String },
        destinatarioId: { type: String },

        camada: {
            type: String,
            enum: ['lexico', 'classificador', 'imagem_api', 'denuncia'],
            required: true,
        },
        severidade: {
            type: String,
            enum: ['leve', 'moderada', 'grave', 'critica'],
            required: true,
        },

        // Escores por eixo — números, nunca conteúdo.
        categorias: { type: mongoose.Schema.Types.Mixed, default: {} },
        termosDetectados: { type: [String], default: [] },

        provedor: { type: String },
        provedorLatenciaMs: { type: Number },
        provedorVersao: { type: String },

        decisaoAutomatica: {
            type: String,
            enum: ['bloqueada', 'em_revisao', 'entregue_com_registro'],
            required: true,
        },
        statusAtual: {
            type: String,
            enum: ['pendente', 'mantida', 'revertida', 'expirada'],
            default: 'pendente',
            index: true,
        },

        revisao: {
            moderadorId: String,
            moderadorPerfil: String,
            decididoEm: Date,
            decisao: { type: String, enum: ['aprovar', 'manter_bloqueio'] },
            justificativa: String,
        },

        contestacao: {
            solicitadoEm: Date,
            motivoUsuario: String,
            resultado: { type: String, enum: ['procedente', 'improcedente'] },
            respondidoEm: Date,
            respondidoPor: String,
        },

        criadoEm: { type: Date, default: Date.now },

        // TTL — ver §6.4. `null` = não expira (trava de exclusão da cláusula 8.6
        // do Termo: contestação pendente ou apuração em curso).
        expiraEm: { type: Date, default: null },
    },
    { collection: 'moderacao_ocorrencias' }
);

// A query do painel: "o que desta escola está esperando decisão, mais recente
// primeiro". Sem este índice a fila vira COLLSCAN assim que a coleção crescer.
ModeracaoOcorrenciaSchema.index({ escolaId: 1, statusAtual: 1, criadoEm: -1 });

// Reincidência (§5.1): "quantas ocorrências deste remetente nos últimos 30
// dias". É a query mais quente do caminho de análise — roda a cada bloqueio.
ModeracaoOcorrenciaSchema.index({ remetenteId: 1, criadoEm: -1 });

// Detecção de reenvio do mesmo conteúdo sem guardar o conteúdo.
ModeracaoOcorrenciaSchema.index({ escolaId: 1, conteudoHash: 1 });

// TTL. `expireAfterSeconds: 0` = o documento morre no instante gravado em
// `expiraEm`; documento com `expiraEm: null` nunca expira, que é exatamente o
// comportamento que a trava de exclusão precisa.
ModeracaoOcorrenciaSchema.index({ expiraEm: 1 }, { expireAfterSeconds: 0 });

/**
 * Prazo de retenção segundo §6.4.
 *
 * Ocorrência que ainda aponta para um binário retido vive 6 meses — depois o
 * job de expurgo do GridFS leva o arquivo e a ocorrência morre junto. Ocorrência
 * só de metadados vive 5 anos, porque é o que sustenta a apuração de
 * reincidência e a auditoria da cláusula 8.3 do Termo.
 */
ModeracaoOcorrenciaSchema.statics.prazoDeRetencao = function prazoDeRetencao(
    temBinario,
    base = Date.now()
) {
    return new Date(base + (temBinario ? SEIS_MESES_MS : CINCO_ANOS_MS));
};

ModeracaoOcorrenciaSchema.statics.SEIS_MESES_MS = SEIS_MESES_MS;
ModeracaoOcorrenciaSchema.statics.CINCO_ANOS_MS = CINCO_ANOS_MS;

module.exports = mongoose.model('ModeracaoOcorrencia', ModeracaoOcorrenciaSchema);
