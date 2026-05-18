const mongoose = require('mongoose');

const UsuarioSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    id: { type: mongoose.Schema.Types.Mixed, index: true }, // Legacy ID support
    email: { type: String, required: true, unique: true },
    senha: { type: String }, // Opcional para logins sociais (Google)
    nome: { type: String, required: true },
    telefone: { type: String, required: true }, // Telefone obrigatório para recuperação de senha
    cpf: { type: String, required: true, unique: true }, // CPF obrigatório para recuperação de senha
    perfil: { type: String, enum: ['admin', 'diretor', 'professor', 'responsavel'], default: 'professor' },
    escola: { type: String }, // Nome da escola
    disciplina: { type: String }, // Disciplina lecionada
    foto: String,
    fotoGoogle: String,
    loginGoogle: Boolean,
    ativo: { type: Boolean, default: true },
    deveMudarSenha: { type: Boolean, default: false },

    // Metadados
    criadoEm: Date,
    ultimoLogin: Date,
    perfilDefinidoEm: Date,

    // Recuperação de Senha
    resetToken: String,
    resetTokenExpiry: Date,

    // Segurança: Bloqueio de conta
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },

    // ============================================
    // MELHORIA: Verificação de E-mail (Roadmap #4)
    // ============================================
    // Garante que o e-mail pertence ao usuário real
    emailVerificado: { type: Boolean, default: false },
    emailVerificacaoToken: { type: String, select: false }, // Nunca retornado em queries padrão
    emailVerificacaoExpiry: { type: Date, select: false },

    // ============================================
    // MELHORIA: Autenticação de Dois Fatores 2FA (Roadmap #1)
    // ============================================
    // Suporte a TOTP (Google Authenticator / Authy)
    // Apenas ativado para admin e diretor na fase 1
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false }, // Nunca retornado em queries padrão
    // Token temporário de 6 dígitos (alternativa via e-mail, sem app)
    twoFactorPendingToken: { type: String, select: false },
    twoFactorPendingExpiry: { type: Date, select: false },

    // ============================================
    // LGPD: Anonimização e Consentimento (Roadmap #13)
    // ============================================
    anonimizadoEm: { type: Date, default: null }, // Data da anonimização LGPD
    consentimentoAceiteEm: { type: Date },        // Quando aceitou a política de privacidade
    consentimentoVersao: { type: String },         // Versão da política aceita
}, {
    timestamps: true,
    strict: true,
    collection: 'usuarios'
});

// Índice de performance: busca por perfil (ex: listar todos os professores)
UsuarioSchema.index({ perfil: 1, ativo: 1 });
// Índice para consulta de usuários inativos (rotina de anonimização automática)
UsuarioSchema.index({ ultimoLogin: 1, ativo: 1 });

module.exports = mongoose.model('Usuario', UsuarioSchema);
