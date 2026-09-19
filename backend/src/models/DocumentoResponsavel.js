const mongoose = require('mongoose');

const DocumentoResponsavelSchema = new mongoose.Schema(
    {
        _id: {
            type: mongoose.Schema.Types.ObjectId,
            default: () => new mongoose.Types.ObjectId(),
        },
        alunoId: {
            type: mongoose.Schema.Types.Mixed,
            ref: 'Aluno',
            required: true,
        },
        alunoNome: {
            type: String,
            trim: true,
        },
        responsavelId: {
            type: mongoose.Schema.Types.Mixed,
            ref: 'Usuario',
            required: true,
        },
        responsavelNome: {
            type: String,
            trim: true,
        },
        turmaId: {
            type: mongoose.Schema.Types.Mixed,
        },
        turmaNome: {
            type: String,
            trim: true,
        },
        tipoDocumento: {
            type: String,
            required: true,
            trim: true,
        },
        nomeDocumento: {
            type: String,
            required: true,
            trim: true,
        },
        arquivo: {
            nomeOriginal: { type: String, required: true },
            url: { type: String, required: true },
            storageId: { type: String, required: true },
            mimeType: { type: String, required: true },
            tamanho: { type: Number, required: true },
            // SHA-256 do conteúdo (Issue #399): é o que permite dizer, depois,
            // que o arquivo guardado é o mesmo que o responsável assinou.
            hash: { type: String },
            enviadoPor: { type: String },
            enviadoEm: { type: Date },
        },

        // Versões ANTERIORES do documento. Substituir acrescenta aqui; nada é
        // apagado. O documento assinado é prova da manifestação do responsável:
        // apagar a versão anterior destrói a prova de uma autorização que
        // valeu por algum tempo.
        versoes: {
            type: [
                {
                    nomeOriginal: String,
                    storageId: String,
                    mimeType: String,
                    tamanho: Number,
                    hash: String,
                    enviadoPor: String,
                    enviadoEm: Date,
                    substituidoEm: Date,
                    _id: false,
                },
            ],
            default: undefined,
        },

        // Parecer da gestão: fica SEPARADO do arquivo da família. A escola
        // comenta e decide o status; o arquivo continua sendo o que o
        // responsável enviou.
        parecerGestao: {
            texto: String,
            autorId: String,
            em: Date,
        },
        status: {
            type: String,
            enum: ['Enviado', 'Em Análise', 'Conferido', 'Substituído'],
            default: 'Enviado',
        },
        observacoes: {
            type: String,
            default: '',
            trim: true,
        },
        dataEnvio: {
            type: Date,
            default: Date.now,
        },
        ultimaAtualizacao: {
            type: Date,
            default: Date.now,
        },
        escolaId: {
            type: String,
        },
    },
    {
        timestamps: { createdAt: 'dataEnvio', updatedAt: 'ultimaAtualizacao' },
        collection: 'documentos_responsaveis',
    }
);

// Índices eficientes solicitados para o MongoDB Atlas
DocumentoResponsavelSchema.index({ alunoId: 1 });
DocumentoResponsavelSchema.index({ responsavelId: 1 });
DocumentoResponsavelSchema.index({ turmaId: 1 });
DocumentoResponsavelSchema.index({ status: 1 });
DocumentoResponsavelSchema.index({ escolaId: 1, alunoId: 1 });
DocumentoResponsavelSchema.index({ dataEnvio: -1 });

module.exports = mongoose.model('DocumentoResponsavel', DocumentoResponsavelSchema);
