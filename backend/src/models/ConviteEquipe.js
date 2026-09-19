const mongoose = require('mongoose');

/**
 * Convite de uso único para criar conta de direção ou secretaria (Issue #386).
 *
 * O token NUNCA é gravado: só o hash SHA-256 dele. Quem lê o banco não consegue
 * aceitar um convite. O token sai uma única vez — no e-mail e na resposta ao
 * admin que o criou.
 *
 * O convite amarra e-mail, escola e perfil: o aceite só vale para aquele
 * e-mail, e a conta nasce vinculada àquela escola, com aquele perfil.
 */
const ConviteEquipeSchema = new mongoose.Schema(
    {
        tokenHash: { type: String, required: true, unique: true },
        email: { type: String, required: true, lowercase: true, trim: true },
        perfil: { type: String, required: true, enum: ['diretor', 'secretaria'] },
        escolaId: { type: String, required: true },
        criadoPor: { type: String, required: true },
        expiraEm: { type: Date, required: true },
        usadoEm: { type: Date, default: null },
        usuarioCriado: { type: String, default: null },
        revogadoEm: { type: Date, default: null },
        revogadoPor: { type: String, default: null },
    },
    { timestamps: true, collection: 'convites_equipe' }
);

ConviteEquipeSchema.index({ email: 1, createdAt: -1 });
ConviteEquipeSchema.index({ escolaId: 1, createdAt: -1 });

module.exports =
    mongoose.models.ConviteEquipe || mongoose.model('ConviteEquipe', ConviteEquipeSchema);
