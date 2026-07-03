const mongoose = require('mongoose');

const UsuarioSchema = new mongoose.Schema({
    _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
    id: { type: mongoose.Schema.Types.Mixed, index: true }, // Legacy ID support
    email: { type: String, required: true, unique: true },
    senha: { type: String }, // Opcional para logins sociais (Google)
    nome: { type: String, required: true },
    telefone: { type: String, required: true }, // Telefone obrigatório para recuperação de senha
    cpf: { type: String, unique: true, sparse: true }, // CPF opcional/sparse para novos cadastros
    perfil: { type: String, enum: ['admin', 'diretor', 'professor', 'responsavel', 'secretaria'], default: 'professor' },
    escola: { type: String }, // Nome da escola
    disciplina: { type: String }, // Disciplina lecionada
    turma: { type: String }, // Turma vinculada
    matricula: { type: String }, // Matrícula (docente)
    parentesco: { type: String }, // Parentesco (responsável)
    nomeAluno: { type: String }, // Nome do aluno (responsável)
    foto: String,
    fotoGoogle: String,
    loginGoogle: Boolean,
    preferenciaNarracao: { type: String, enum: ['texto', 'texto_audio', 'audio'], default: 'texto_audio' },
    voiceSpeed:          { type: Number, default: 1.0 },
    voiceGender:         { type: String, enum: ['female', 'male'], default: 'male' }, // voz feminina ou masculina
    ttsProvider:         { type: String, enum: ['auto', 'gemini', 'elevenlabs', 'google-cloud'], default: 'google-cloud' },
    settings: {
        ttsProvider:     { type: String, default: 'gemini' },
        voicePreference: { type: String, default: 'male' },
        speed:           { type: Number, default: 1.0 },
        narrationMode:   { type: String, default: 'texto_audio' }
    },
    accessibilityFontSize:    { type: String, default: '100%' },
    accessibilityContrast:    { type: Boolean, default: false },
    accessibilityReadingMode: { type: Boolean, default: false },
    ativo: { type: Boolean, default: true },
    deveMudarSenha: { type: Boolean, default: false },

    // Metadados
    criadoEm: Date,
    ultimoLogin: Date,
    lastLogin: Date, // Campo lastLogin solicitado
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
    // Código fixo opcional para contas de teste / exceção (não retornado em queries padrão)
    twoFactorFixedCode: { type: String, select: false },

    // ============================================
    // LGPD: Anonimização e Consentimento (Roadmap #13)
    // ============================================
    anonimizadoEm: { type: Date, default: null }, // Data da anonimização LGPD
    consentimentoAceiteEm: { type: Date },        // Quando aceitou a política de privacidade
    consentimentoVersao: { type: String },         // Versão da política aceita

    // Onboarding e Perfil Completo
    profileCompleted: { type: Boolean, default: false },
    tutorialProfessorConcluido: { type: Boolean, default: false },
    tutorialResponsavelConcluido: { type: Boolean, default: false },
    tutorialProfessorConcluidoEm: { type: Date },
    tutorialResponsavelConcluidoEm: { type: Date },

    // Dados específicos de Responsável (LGPD Minimization)
    whatsApp: String,
    vinculoAluno: String, // Pai, Mãe, etc.
    responsavelPrincipal: { type: Boolean, default: false },
    guardaLegal: { type: Boolean, default: false },
    autorizadoRetirar: { type: Boolean, default: false },

    // Segundo Responsável (Opcional)
    segundoResponsavel: {
        nome: String,
        vinculo: String,
        telefone: String,
        whatsApp: String,
        email: String,
        guardaLegal: Boolean,
        autorizadoRetirar: Boolean,
        principal: Boolean
    },

    // Pessoas Autorizadas a Retirar o Aluno
    pessoasAutorizadas: [{
        nome: String,
        parentesco: String,
        telefone: String,
        observacoes: String
    }],

    // Central de Privacidade LGPD (Consentimentos)
    lgpdConsents: {
        imagemInternaFotos: { type: Boolean, default: false },
        imagemInternaVideos: { type: Boolean, default: false },
        imagemSite: { type: Boolean, default: false },
        imagemRedes: { type: Boolean, default: false },
        comunicadosEmail: { type: Boolean, default: false },
        comunicadosWhatsApp: { type: Boolean, default: false },
        comunicadosSistema: { type: Boolean, default: false },
        pedagogicoTrabalhos: { type: Boolean, default: false },
        pedagogicoProjetos: { type: Boolean, default: false },
        pedagogicoMaker: { type: Boolean, default: false },
        pedagogicoFeiras: { type: Boolean, default: false },
        institucionalSecretaria: { type: Boolean, default: false },
        institucionalSistemas: { type: Boolean, default: false },
        institucionalPlataformas: { type: Boolean, default: false }
    },
    
    // Identificação Única de Conta
    contaId: { type: String, unique: true, sparse: true }, // Ex: RP-000123
    profileCompletedEm: { type: Date },

    // Histórico de Assinaturas e Termas LGPD (Imutável)
    lgpdHistory: [{
        termoId: String, // 'privacy_policy', 'terms_of_use', etc.
        versao: String,
        aceitoEm: Date,
        ip: String,
        browser: String,
        os: String,
        loginType: String // 'Google', 'Portal Local'
    }],

    // Gestão de Documentos (Opcional)
    documentosResponsavel: [{
        tipo: String, // 'Autorização', 'Termo LGPD', etc.
        nomeArquivo: String,
        url: String,
        status: { type: String, enum: ['Pendente', 'Em análise', 'Aprovado', 'Rejeitado'], default: 'Pendente' },
        enviadoEm: { type: Date, default: Date.now }
    }],
    
    // Invalidação de sessões
    tokenVersion: { type: Number, default: 0 },

    // Notificações Avançadas
    notificacoesPreferencias: {
        portal: { type: Boolean, default: true },
        push: { type: Boolean, default: true },
        email: { type: Boolean, default: true }
    },
    pushSubscriptions: [{
        endpoint: String,
        expirationTime: Number,
        keys: {
            p256dh: String,
            auth: String
        }
    }]
}, {
    timestamps: true,
    strict: true,
    collection: 'usuarios'
});

// Índice de performance: busca por perfil (ex: listar todos os professores)
UsuarioSchema.index({ perfil: 1, ativo: 1 });
// Índice para consulta de usuários inativos (rotina de anonimização automática)
UsuarioSchema.index({ ultimoLogin: 1, ativo: 1 });

module.exports = mongoose.models.Usuario || mongoose.model('Usuario', UsuarioSchema);
