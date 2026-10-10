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

        // ─── Canal de denúncia (ECA Digital) ────────────────────────────────
        // `categoriaDenuncia` é o que separa bullying de discriminação e de
        // violência — a triagem da escola muda conforme a categoria, e sem ela
        // toda denúncia chega na fila com o mesmo peso.
        categoriaDenuncia: {
            type: String,
            enum: [
                'bullying',
                'ciberbullying',
                'assedio',
                'discriminacao',
                'violencia',
                'automutilacao',
                'outro',
            ],
            default: undefined,
        },
        // A ÚNICA exceção à regra de não guardar conteúdo (§6.1) — e ela é
        // deliberada. O que o §6.1 proíbe é arquivar o material OFENSIVO: texto
        // agressivo, áudio, imagem. O relato é o oposto disso: é o que a própria
        // pessoa escreveu PARA a escola, pedindo providência. Sem ele a denúncia
        // chega como "alguém denunciou alguma coisa" e o canal do ECA vira
        // fachada. Fica limitado em tamanho e só é lido pela moderação da escola.
        relato: { type: String, maxlength: 2000, default: undefined },

        // ─── Comunicação ao Conselho Tutelar (Issue #511) ───────────────────
        // ECA, arts. 13, 56-I e 245; Lei 14.344/2022; Lei 13.819/2019, art. 6º;
        // LDB, art. 12, VIII (redação da Lei 15.231/2025). Denúncia de
        // violência, assédio ou automutilação nasce com a comunicação
        // EXIGIDA e `situacao: 'pendente'`; a gestão registra quando e como
        // comunicou — ou, só a direção, por que a apuração dispensou.
        // `sigilosa` marca a violência autoprovocada, que a Lei 13.819 manda
        // tratar em sigilo. Nenhum campo aqui guarda o relato.
        conselhoTutelar: {
            type: new mongoose.Schema(
                {
                    exigida: { type: Boolean, default: false },
                    sigilosa: { type: Boolean, default: false },
                    situacao: {
                        type: String,
                        enum: ['pendente', 'comunicado', 'dispensado'],
                        default: 'pendente',
                    },
                    comunicadoEm: Date,
                    meio: {
                        type: String,
                        enum: ['oficio', 'email', 'telefone', 'presencial', 'sistema_do_conselho'],
                    },
                    protocolo: { type: String, trim: true, maxlength: 60 },
                    justificativaDispensa: { type: String, trim: true, maxlength: 1000 },
                    registradoPor: String,
                    registradoPerfil: String,
                    registradoEm: Date,
                },
                { _id: false }
            ),
            default: undefined,
        },

        // ─── Apuração da denúncia do canal aberto (Issue #726) ──────────────
        // Separada de `statusAtual` de propósito: `statusAtual` é o ciclo da
        // fila de moderação, e `expirarPendencias` marca como `expirada` a
        // denúncia moderada que ninguém decidiu em 24h. A apuração de um
        // bullying não termina porque um prazo de fila venceu. Denúncia gravada
        // antes desta Issue não tem o campo e é tratada como `nova`.
        // Quem anotou fica guardado por id; o nome é resolvido na leitura.
        apuracao: {
            type: new mongoose.Schema(
                {
                    situacao: {
                        type: String,
                        enum: ['nova', 'em_apuracao', 'concluida'],
                        default: 'nova',
                    },
                    atualizadoEm: Date,
                    andamentos: {
                        type: [
                            new mongoose.Schema(
                                {
                                    situacao: {
                                        type: String,
                                        enum: ['nova', 'em_apuracao', 'concluida'],
                                    },
                                    anotacao: { type: String, trim: true, maxlength: 1000 },
                                    porId: String,
                                    porPerfil: String,
                                    em: { type: Date, default: Date.now },
                                },
                                { _id: false }
                            ),
                        ],
                        default: undefined,
                    },
                },
                { _id: false }
            ),
            default: undefined,
        },

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

// A página de denúncias recebidas (Issue #726): "as denúncias desta escola,
// mais recente primeiro". A coleção cresce com cada bloqueio do filtro léxico;
// sem o `camada` no índice, listar meia dúzia de denúncias varreria tudo isso.
ModeracaoOcorrenciaSchema.index({ escolaId: 1, camada: 1, criadoEm: -1 });

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
