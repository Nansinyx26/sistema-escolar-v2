/**
 * ObraProtegida — catálogo de imagens e áudios sob direito autoral de terceiros
 * (Lei 9.610/98), mantido pela direção. Issue #509.
 *
 * Cada registro guarda só a IMPRESSÃO DIGITAL da obra, nunca os bytes: o
 * catálogo não pode virar um segundo lugar onde o conteúdo protegido fica
 * armazenado e distribuído.
 *
 * `acao: 'liberar'` é a exceção ao aviso embutido no arquivo: quando quem envia
 * é o titular (a professora que assina as próprias fotos com ©), a direção
 * libera aquela impressão. A liberação NÃO vence um bloqueio explícito do
 * catálogo — se a mesma obra foi bloqueada, o bloqueio prevalece.
 *
 * `escolaId` nulo = vale para a rede toda (só o admin cadastra assim).
 */
const mongoose = require('mongoose');

const ObraProtegidaSchema = new mongoose.Schema(
    {
        acao: { type: String, enum: ['bloquear', 'liberar'], default: 'bloquear', index: true },
        midia: { type: String, enum: ['imagem', 'audio'], required: true },

        titulo: { type: String, trim: true, maxlength: 200 },
        titular: { type: String, trim: true, maxlength: 200 },
        motivo: { type: String, trim: true, maxlength: 500 },

        sha256: { type: String, required: true, index: true },
        conteudoHash: { type: String, index: true, sparse: true },
        phash: { type: String },

        escolaId: { type: String, default: null, index: true },
        // Arquivo do bucket 'uploads' que originou o registro, quando o bloqueio
        // partiu de um arquivo já armazenado.
        origemArquivoId: { type: String },

        criadoPor: {
            usuarioId: { type: String },
            perfil: { type: String },
        },

        ativo: { type: Boolean, default: true, index: true },
    },
    { timestamps: true, collection: 'obras_protegidas' }
);

module.exports = mongoose.model('ObraProtegida', ObraProtegidaSchema);
