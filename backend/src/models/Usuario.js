const mongoose = require('mongoose');

const UsuarioSchema = new mongoose.Schema(
    {
        _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
        id: { type: mongoose.Schema.Types.Mixed, index: true }, // Legacy ID support
        email: { type: String, required: true, unique: true },
        // `select: false` — o hash NUNCA sai numa query por padrão.
        // Antes o campo era selecionável e a proteção dependia de cada controller
        // lembrar de `.select('-senha')`. Só 3 dos ~40 call sites faziam isso, então
        // qualquer endpoint que devolvesse um usuário vazava o hash bcrypt junto.
        // Quem precisa do hash (login, checagem de conta existente) pede
        // explicitamente com `.select('+senha')`.
        senha: { type: String, select: false }, // Opcional para logins sociais (Google)
        nome: { type: String, required: true },
        telefone: { type: String, required: true }, // Telefone obrigatório para recuperação de senha
        cpf: { type: String }, // CPF opcional — unicidade por escola em schema.index abaixo
        perfil: {
            type: String,
            enum: ['admin', 'diretor', 'professor', 'responsavel', 'secretaria'],
            default: 'professor',
        },
        escola: { type: String }, // Nome da escola
        escolaId: { type: String, index: true }, // Multi-tenant: id da Escola (para notificações/filtros)
        disciplina: { type: String }, // Disciplina lecionada
        turma: { type: String }, // Turma vinculada
        matricula: { type: String }, // Matrícula (docente)
        parentesco: { type: String }, // Parentesco (responsável)
        nomeAluno: { type: String }, // Nome do aluno (responsável)
        foto: String,
        fotoGoogle: String,
        loginGoogle: Boolean,
        preferenciaNarracao: {
            type: String,
            enum: ['texto', 'texto_audio', 'audio'],
            default: 'texto_audio',
        },
        voiceSpeed: { type: Number, default: 1.0 },
        voiceGender: { type: String, enum: ['female', 'male'], default: 'male' }, // voz feminina ou masculina
        ttsProvider: {
            type: String,
            enum: ['auto', 'gemini', 'elevenlabs', 'google-cloud'],
            default: 'google-cloud',
        },
        settings: {
            ttsProvider: { type: String, default: 'gemini' },
            voicePreference: { type: String, default: 'male' },
            // Nome da voz no provedor de narração (adam, brian, eric, george) ou
            // 'off'. Fica FORA de `voiceGender` de propósito: aquele campo é legado
            // e tem enum de gênero, então gravar um nome de voz nele reprovava o
            // documento inteiro na validação e derrubava o salvamento.
            elevenlabsVoice: { type: String, default: 'brian' },
            narrarAuto: { type: Boolean, default: false },
            speed: { type: Number, default: 1.0 },
            narrationMode: { type: String, default: 'texto_audio' },
        },
        accessibilityFontSize: { type: String, default: '100%' },
        accessibilityContrast: { type: Boolean, default: false },
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
        // Tentativas de código na etapa 2FA — bloqueia força bruta dos 10^6 códigos
        twoFactorAttempts: { type: Number, default: 0, select: false },
        twoFactorLockUntil: { type: Date, select: false },
        // Tentativas de vínculo por código secreto do aluno (por conta)
        vinculoAttempts: { type: Number, default: 0, select: false },
        vinculoLockUntil: { type: Date, select: false },
        // Código fixo opcional para contas de teste / exceção (não retornado em queries padrão)
        twoFactorFixedCode: { type: String, select: false },

        // ============================================
        // CÓDIGOS DE BACKUP — segundo fator que não depende do e-mail
        // ============================================
        // O 2FA de diretor e secretaria era 100% dependente da entrega de e-mail.
        // Quando o provedor bloqueou o envio, esses dois perfis ficaram trancados
        // fora do sistema, sem nenhum caminho de recuperação — a indisponibilidade
        // de um serviço externo virou perda total de acesso.
        //
        // Cada código é guardado como HASH (scrypt), nunca em texto puro: um dump
        // do banco não pode virar um molho de chaves de segundo fator. São de USO
        // ÚNICO — `usadoEm` marca o consumo e o código não vale mais.
        //
        // Isto NÃO é um "modo sem 2FA": continua sendo algo que a pessoa precisa
        // possuir, entregue por um canal separado da senha.
        twoFactorBackupCodes: {
            type: [
                {
                    hash: { type: String, required: true },
                    usadoEm: { type: Date, default: null },
                    _id: false,
                },
            ],
            select: false,
            default: undefined,
        },
        twoFactorBackupGeradoEm: { type: Date, select: false },

        // ─── Confirmação do consentimento LGPD (art. 14, §1º) ───────────────
        // Código de uso único que prova que quem consentiu é quem tem a caixa
        // de e-mail cadastrada. Guardado como HASH, como o de 2FA — um dump do
        // banco não pode virar um molho de códigos válidos.
        consentimentoPendingToken: { type: String, select: false },
        consentimentoPendingExpiry: { type: Date, select: false },
        consentimentoPendingTentativas: { type: Number, default: 0, select: false },

        // ============================================
        // LGPD: Anonimização e Consentimento (Roadmap #13)
        // ============================================
        anonimizadoEm: { type: Date, default: null }, // Data da anonimização LGPD
        consentimentoAceiteEm: { type: Date }, // Quando aceitou a política de privacidade
        consentimentoVersao: { type: String }, // Versão da política aceita

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
            principal: Boolean,
        },

        // Pessoas Autorizadas a Retirar o Aluno
        pessoasAutorizadas: [
            {
                nome: String,
                parentesco: String,
                telefone: String,
                observacoes: String,
            },
        ],

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
            institucionalPlataformas: { type: Boolean, default: false },
        },

        // Identificação Única de Conta
        contaId: { type: String, unique: true, sparse: true }, // Ex: RP-000123
        profileCompletedEm: { type: Date },

        // Histórico de Assinaturas e Termas LGPD (Imutável)
        lgpdHistory: [
            {
                termoId: String, // 'privacy_policy', 'terms_of_use', etc.
                versao: String,
                aceitoEm: Date,
                ip: String,
                browser: String,
                os: String,
                loginType: String, // 'Google', 'Portal Local'
                // COMO se provou que foi o titular (ou o responsável legal) que
                // assinou: 'SESSAO_AUTENTICADA', 'EMAIL_VERIFICADO',
                // 'SMS_VERIFICADO' ou 'GOV_BR_AUTH'. Sem este campo, dois
                // registros idênticos podem ter forças probatórias muito
                // diferentes e ninguém consegue distinguir depois — é a
                // pergunta que a ANPD faz quando há reclamação sobre dado de
                // criança (LGPD, art. 14, §1º).
                metodoValidacao: String,
            },
        ],

        // Gestão de Documentos (Opcional)
        documentosResponsavel: [
            {
                tipo: String, // 'Autorização', 'Termo LGPD', etc.
                nomeArquivo: String,
                url: String,
                status: {
                    type: String,
                    enum: ['Pendente', 'Em análise', 'Aprovado', 'Rejeitado'],
                    default: 'Pendente',
                },
                enviadoEm: { type: Date, default: Date.now },
            },
        ],

        // Invalidação de sessões
        tokenVersion: { type: Number, default: 0 },

        // Notificações Avançadas
        notificacoesPreferencias: {
            portal: { type: Boolean, default: true },
            push: { type: Boolean, default: true },
            email: { type: Boolean, default: true },
        },
        pushSubscriptions: [
            {
                endpoint: String,
                expirationTime: Number,
                keys: {
                    p256dh: String,
                    auth: String,
                },
            },
        ],
    },
    {
        timestamps: true,
        strict: true,
        collection: 'usuarios',
    }
);

// ============================================
// MINIMIZAÇÃO NA SERIALIZAÇÃO (LGPD + defesa em profundidade)
// ============================================
// Segunda camada, independente do `select: false`: mesmo que um campo sensível
// seja carregado de propósito (ex.: `+senha` no login), ele não escapa por um
// `res.json(usuario)` distraído. Vale para toJSON e toObject.
//
// LIMITE IMPORTANTE: isto NÃO se aplica a `.lean()`, que devolve objeto puro
// sem os métodos do Mongoose. É por isso que o `select: false` acima é a
// proteção primária — este transform é a rede de segurança.
const CAMPOS_NUNCA_SERIALIZADOS = [
    'senha',
    'resetToken',
    'resetTokenExpiry',
    'emailVerificacaoToken',
    'emailVerificacaoExpiry',
    'twoFactorSecret',
    'twoFactorPendingToken',
    'twoFactorPendingExpiry',
    'twoFactorFixedCode',
    'twoFactorBackupCodes',
    'twoFactorBackupGeradoEm',
    'twoFactorAttempts',
    'twoFactorLockUntil',
    'vinculoAttempts',
    'vinculoLockUntil',
    'loginAttempts',
    'lockUntil',
    'tokenVersion',
    'pushSubscriptions', // contém chaves criptográficas do endpoint push
    '__v',
];

function removerCamposSensiveis(doc, ret) {
    CAMPOS_NUNCA_SERIALIZADOS.forEach((campo) => {
        delete ret[campo];
    });
    return ret;
}

UsuarioSchema.set('toJSON', { transform: removerCamposSensiveis });
UsuarioSchema.set('toObject', { transform: removerCamposSensiveis });

// Índice de performance: busca por perfil (ex: listar todos os professores)
UsuarioSchema.index({ perfil: 1, ativo: 1 });
// Índice para consulta de usuários inativos (rotina de anonimização automática)
UsuarioSchema.index({ ultimoLogin: 1, ativo: 1 });
// CPF é único dentro de cada escola, não globalmente (professor pode ter vínculo em várias escolas).
// partialFilterExpression exclui documentos sem CPF — `sparse` sozinho não funciona em índice composto.
UsuarioSchema.index(
    { escolaId: 1, cpf: 1 },
    { unique: true, partialFilterExpression: { cpf: { $type: 'string' } } }
);

module.exports = mongoose.models.Usuario || mongoose.model('Usuario', UsuarioSchema);
