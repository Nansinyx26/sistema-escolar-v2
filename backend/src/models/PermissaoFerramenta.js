/**
 * PermissaoFerramenta — a decisão da direção sobre UMA ferramenta para UM
 * professor, numa escola (Issue #720).
 *
 * Um documento por (escola, professor, ferramenta): é o estado ATUAL. O
 * histórico — quem concedeu, quem revogou, antes e depois — fica no AuditLog,
 * que é só de inclusão.
 *
 * Ausência de documento = não autorizado. A verificação
 * (`services/ferramentas/permissaoFerramenta.js`) lê este modelo a cada uso,
 * sem cache, para a decisão da direção valer na próxima requisição do
 * professor, em qualquer instância.
 *
 * `professorId`, `autorizadoPor` e `alteradoPor` são `Usuario._id`, que é
 * String neste projeto (ver models/Usuario.js).
 */
const mongoose = require('mongoose');

const PermissaoFerramentaSchema = new mongoose.Schema(
    {
        escolaId: { type: String, required: true },
        professorId: { type: String, required: true },
        // Chave do catálogo (`services/ferramentas/catalogo.js`).
        ferramentaId: { type: String, required: true },

        autorizado: { type: Boolean, required: true, default: false },

        // Quem concedeu a autorização vigente, e quando. Limpos na revogação:
        // o que valeu antes está no AuditLog.
        autorizadoPor: { type: String, default: null },
        autorizadoEm: { type: Date, default: null },

        // Quem fez a última alteração (concessão ou revogação). A data dela é
        // o `updatedAt`.
        alteradoPor: { type: String, default: null },
    },
    { timestamps: true, collection: 'permissoes_ferramentas' }
);

// Uma decisão por (escola, professor, ferramenta). Também é o índice da
// verificação por requisição, que consulta exatamente esses três campos.
PermissaoFerramentaSchema.index({ escolaId: 1, professorId: 1, ferramentaId: 1 }, { unique: true });
// Página da direção: "quem tem esta ferramenta nesta escola".
PermissaoFerramentaSchema.index({ escolaId: 1, ferramentaId: 1, autorizado: 1 });

module.exports = mongoose.model('PermissaoFerramenta', PermissaoFerramentaSchema);
