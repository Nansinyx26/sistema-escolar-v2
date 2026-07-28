/**
 * Usuario Collection Refactoring — P2 Implementation
 * 
 * Separa Usuario monolítica em 5 coleções especializadas
 * Melhora manutenibilidade, performance e segurança
 * 
 * BEFORE: Usuario (150+ campos)
 * AFTER:
 *   - UsuarioAuth (autenticação)
 *   - UsuarioPreferencias (UI/UX)
 *   - UsuarioLGPD (privacidade)
 *   - ResponsavelPerfil (responsável específico)
 *   - UsuarioOnboarding (primeiro acesso)
 * 
 * @module UsuarioRefactoring
 * @version 1.0
 */

const mongoose = require('mongoose');

// ======================
// SCHEMA: UsuarioAuth
// ======================
/**
 * Autenticação e identidade
 */
const UsuarioAuthSchema = new mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  
  // Identidade
  email: { type: String, required: true, unique: true, index: true },
  cpf: { type: String, sparse: true, unique: true },
  nome: { type: String, required: true },
  telefone: String,
  
  // Autenticação
  senha: { type: String, required: true },
  perfil: {
    type: String,
    enum: ['aluno', 'professor', 'responsavel', 'diretor', 'admin'],
    required: true,
    index: true,
  },
  
  // Segurança
  twoFactorEnabled: { type: Boolean, default: false },
  twoFactorSecret: String,
  emailVerificado: { type: Boolean, default: false },
  ativo: { type: Boolean, default: true, index: true },
  
  // Brute force
  tentativasFalhadas: { type: Number, default: 0 },
  bloqueadoAte: Date,
  
  // Control
  dataCriacao: { type: Date, default: Date.now },
  dataAtualizacao: { type: Date, default: Date.now },
  criptografado: { type: Boolean, default: true },
  
}, { collection: 'usuariosAuth' });

// Indices
UsuarioAuthSchema.index({ email: 1, ativo: 1 });
UsuarioAuthSchema.index({ cpf: 1 }, { sparse: true });
UsuarioAuthSchema.index({ perfil: 1, ativo: 1 });

// ======================
// SCHEMA: UsuarioPreferencias
// ======================
/**
 * Preferências de interface e experiência
 */
const UsuarioPreferenciasSchema = new mongoose.Schema({
  usuarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UsuarioAuth',
    required: true,
    unique: true,
    index: true,
  },
  
  // Tema
  temaPrefixo: {
    type: String,
    enum: ['light', 'dark', 'auto'],
    default: 'auto',
  },
  
  // Notificações
  notificacoesEmail: { type: Boolean, default: true },
  notificacoesPush: { type: Boolean, default: true },
  notificacoesFrequencia: {
    type: String,
    enum: ['instant', 'daily', 'weekly', 'never'],
    default: 'instant',
  },
  
  // Acessibilidade
  tts: { type: Boolean, default: false },
  narrativa: { type: Boolean, default: false },
  tamanhoFonte: {
    type: String,
    enum: ['small', 'normal', 'large', 'xlarge'],
    default: 'normal',
  },
  altoContraste: { type: Boolean, default: false },
  
  // Idioma e Localização
  idioma: { type: String, default: 'pt-BR' },
  fuso: { type: String, default: 'America/Sao_Paulo' },
  
  // Privacidade
  perfomPublico: { type: Boolean, default: false },
  mostrarFoto: { type: Boolean, default: true },
  
  // Dados
  dataCriacao: { type: Date, default: Date.now },
  dataAtualizacao: { type: Date, default: Date.now },
  
}, { collection: 'usuariosPreferencias' });

// ======================
// SCHEMA: UsuarioLGPD
// ======================
/**
 * Dados sensíveis de privacidade (LGPD/GDPR)
 */
const UsuarioLGPDSchema = new mongoose.Schema({
  usuarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UsuarioAuth',
    required: true,
    unique: true,
    index: true,
  },
  
  // Consentimento
  consenteLGPD: { type: Boolean, default: false },
  dataConsenteLGPD: Date,
  consentimento3: { type: Boolean, default: false },
  consentimento4: { type: Boolean, default: false },
  
  // Direitos LGPD
  solicitouExportacao: { type: Boolean, default: false },
  dataExportacao: Date,
  solicitouDelecao: { type: Boolean, default: false },
  dataDelecao: Date,
  
  // Auditoria
  logAcessos: [{
    tipo: String, // 'login', 'export', 'delete'
    data: Date,
    ip: String,
    userAgent: String,
  }],
  
  // Exclusão programada
  agendadoParaDelecao: { type: Boolean, default: false },
  dataDelecaoProgramada: Date,
  
  // Dados
  dataCriacao: { type: Date, default: Date.now },
  dataAtualizacao: { type: Date, default: Date.now },
  
}, { collection: 'usuariosLGPD' });

// TTL para exclusão programada (30 dias)
UsuarioLGPDSchema.index(
  { dataDelecaoProgramada: 1 },
  { expireAfterSeconds: 2592000, sparse: true }
);

// ======================
// SCHEMA: ResponsavelPerfil
// ======================
/**
 * Dados específicos para responsáveis
 */
const ResponsavelPerfilSchema = new mongoose.Schema({
  usuarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UsuarioAuth',
    required: true,
    unique: true,
    index: true,
  },
  
  // Responsabilidade
  parentesco: {
    type: String,
    enum: ['pai', 'mae', 'avo', 'avo', 'tio', 'tutor'],
    required: true,
  },
  
  // Alunos vinculados
  alunos: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Aluno',
  }],
  
  // Endereço
  endereco: {
    cep: String,
    rua: String,
    numero: String,
    complemento: String,
    bairro: String,
    cidade: String,
    estado: String,
  },
  
  // Dados adicionais
  nomePai: String,
  nomeMae: String,
  profissao: String,
  empresa: String,
  
  // Comunicação
  telefonePrincipal: String,
  telefoneAuxiliar: String,
  emailAlternativo: String,
  
  // Dados
  dataCriacao: { type: Date, default: Date.now },
  dataAtualizacao: { type: Date, default: Date.now },
  
}, { collection: 'responsaveisPerfis' });

ResponsavelPerfilSchema.index({ alunos: 1 });

// ======================
// SCHEMA: UsuarioOnboarding
// ======================
/**
 * Dados de primeiro acesso e onboarding
 */
const UsuarioOnboardingSchema = new mongoose.Schema({
  usuarioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'UsuarioAuth',
    required: true,
    unique: true,
    index: true,
  },
  
  // Primeiro acesso
  primeiroAcesso: { type: Boolean, default: true },
  deveMudarSenha: { type: Boolean, default: false },
  dataPrimeiroAcesso: Date,
  
  // Onboarding tutorial
  tutorialCompleto: { type: Boolean, default: false },
  passoAtual: { type: Number, default: 0 },
  dataTutorialCompleto: Date,
  
  // Setup perfil
  fotoUploadada: { type: Boolean, default: false },
  nomeVerificado: { type: Boolean, default: false },
  enderecoVerificado: { type: Boolean, default: false },
  
  // Passos completados
  passosConcluidos: {
    definirFoto: { type: Boolean, default: false },
    verificarEmail: { type: Boolean, default: false },
    preencherPerfil: { type: Boolean, default: false },
    lerTermos: { type: Boolean, default: false },
    completarOnboarding: { type: Boolean, default: false },
  },
  
  // Dados
  dataCriacao: { type: Date, default: Date.now },
  dataAtualizacao: { type: Date, default: Date.now },
  
}, { collection: 'usuariosOnboarding' });

// ======================
// MODELS
// ======================

const UsuarioAuth = mongoose.model('UsuarioAuth', UsuarioAuthSchema);
const UsuarioPreferencias = mongoose.model('UsuarioPreferencias', UsuarioPreferenciasSchema);
const UsuarioLGPD = mongoose.model('UsuarioLGPD', UsuarioLGPDSchema);
const ResponsavelPerfil = mongoose.model('ResponsavelPerfil', ResponsavelPerfilSchema);
const UsuarioOnboarding = mongoose.model('UsuarioOnboarding', UsuarioOnboardingSchema);

// ======================
// UTILITIES
// ======================

/**
 * Criar usuário completo em todas as coleções
 */
async function criarUsuarioCompleto(dados) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Criar em UsuarioAuth
    const usuarioAuth = await UsuarioAuth.create([dados.auth], { session });
    const usuarioId = usuarioAuth[0]._id;

    // Criar preferências
    await UsuarioPreferencias.create([{
      usuarioId,
      ...dados.preferencias,
    }], { session });

    // Criar LGPD
    await UsuarioLGPD.create([{
      usuarioId,
      ...dados.lgpd,
    }], { session });

    // Criar onboarding
    await UsuarioOnboarding.create([{
      usuarioId,
      ...dados.onboarding,
    }], { session });

    // Criar responsável se aplicável
    if (dados.auth.perfil === 'responsavel' && dados.responsavel) {
      await ResponsavelPerfil.create([{
        usuarioId,
        ...dados.responsavel,
      }], { session });
    }

    await session.commitTransaction();
    return { success: true, usuarioId, usuario: usuarioAuth[0] };
  } catch (error) {
    await session.abortTransaction();
    return { success: false, error: error.message };
  } finally {
    await session.endSession();
  }
}

/**
 * Obter usuário completo (todas as coleções)
 */
async function obterUsuarioCompleto(usuarioId) {
  return await Promise.all([
    UsuarioAuth.findById(usuarioId),
    UsuarioPreferencias.findOne({ usuarioId }),
    UsuarioLGPD.findOne({ usuarioId }),
    UsuarioOnboarding.findOne({ usuarioId }),
  ]).then(([auth, prefs, lgpd, onboarding]) => ({
    auth,
    preferencias: prefs,
    lgpd,
    onboarding,
  }));
}

/**
 * Deletar usuário de todas as coleções
 */
async function deletarUsuario(usuarioId) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await Promise.all([
      UsuarioAuth.deleteOne({ _id: usuarioId }, { session }),
      UsuarioPreferencias.deleteOne({ usuarioId }, { session }),
      UsuarioLGPD.deleteOne({ usuarioId }, { session }),
      UsuarioOnboarding.deleteOne({ usuarioId }, { session }),
      ResponsavelPerfil.deleteOne({ usuarioId }, { session }),
    ]);

    await session.commitTransaction();
    return { success: true };
  } catch (error) {
    await session.abortTransaction();
    return { success: false, error: error.message };
  } finally {
    await session.endSession();
  }
}

module.exports = {
  // Models
  UsuarioAuth,
  UsuarioPreferencias,
  UsuarioLGPD,
  ResponsavelPerfil,
  UsuarioOnboarding,
  
  // Utilities
  criarUsuarioCompleto,
  obterUsuarioCompleto,
  deletarUsuario,
};
