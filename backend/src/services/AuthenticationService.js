/**
 * AuthenticationService.js
 * 
 * Responsável por toda a lógica de autenticação:
 * - Login (com validação de força de senha, proteção contra brute force, 2FA)
 * - Logout
 * - Validação de token JWT
 * - Geração de tokens 2FA
 * 
 * Extraído de UserController.js para melhor manutenibilidade
 */

const Usuario = require('../models/Usuario');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const ACTUAL_JWT_SECRET = require('../utils/jwtConfig');
const { logAction } = require('../utils/auditHelper');
const logger = require('../utils/logger');

const SALT_ROUNDS = 12;

// ============================================
// ANTI-ENUMERAÇÃO DE USUÁRIO
// ============================================
// Resposta única para toda falha de credencial. Textos diferentes por causa
// ('conta inativa' vs 'senha inválida') permitiam varrer e-mails válidos.
const ERRO_CREDENCIAIS = {
  error: 'E-mail ou senha incorretos.',
  code: 'INVALID_CREDENTIALS'
};

// Hash descartável para igualar o tempo de resposta quando a conta não existe.
const HASH_DUMMY = bcrypt.hashSync('senha-inexistente-para-timing-constante', SALT_ROUNDS);

class AuthenticationService {
  /**
   * Valida se uma senha está em formato bcrypt hash
   */
  static isHashed(senha) {
    return senha && senha.startsWith('$2');
  }

  /**
   * Realiza login com email e senha
   * Suporta migração automática de senhas legadas
   * Protege contra brute force com bloqueio temporário
   * Suporta 2FA (two-factor authentication)
   * 
   * @param {string} email - Email do usuário
   * @param {string} senha - Senha em texto plano
   * @param {string} portal - 'responsavel' ou 'docente' (para separação de portais)
   * @returns {Object} { success, user?, requires2FA?, message? }
   */
  static async login(email, senha, portal = 'docente') {
    try {
      // 1. Validações básicas
      if (!email || !senha) {
        return {
          success: false,
          error: 'Email e senha são obrigatórios',
          code: 'MISSING_CREDENTIALS'
        };
      }

      // 2. Busca o usuário. `+senha`: o hash é `select: false` no schema.
      const user = await Usuario.findOne({ email: email.toLowerCase() }).select('+senha');
      if (!user || !user.ativo) {
        // Consome o mesmo tempo de um bcrypt.compare real: sem isso, a
        // diferença de latência entre "conta inexistente" e "senha errada"
        // enumera usuários mesmo com a mensagem unificada.
        await bcrypt.compare(String(senha), HASH_DUMMY);
        return {
          success: false,
          ...ERRO_CREDENCIAIS
        };
      }

      // 3. Validar senha ANTES de qualquer verificação específica da conta.
      // As checagens de portal abaixo revelam não só que a conta existe, mas
      // também qual é o perfil dela — por isso ficam atrás da prova de senha.
      const isValid = await this._validatePassword(user, senha);

      if (!isValid) {
        // Incrementar tentativas de login falha
        await this._handleFailedLogin(user);
        return {
          success: false,
          ...ERRO_CREDENCIAIS
        };
      }

      // 4. Validação de portal (só para quem já provou saber a senha)
      if (portal === 'responsavel' && user.perfil !== 'responsavel') {
        return {
          success: false,
          error: 'Esta conta não é de responsável. Use a página de login do docente.',
          code: 'INVALID_PORTAL'
        };
      }

      if (portal === 'docente' && user.perfil === 'responsavel') {
        return {
          success: false,
          error: 'Contas de responsável não podem acessar o sistema escolar. Use o Portal do Responsável.',
          code: 'INVALID_PORTAL'
        };
      }

      // 5. Conta bloqueada — checado DEPOIS da senha, de propósito.
      // Antes vinha antes da validação, e o 'ACCOUNT_LOCKED' confirmava a
      // existência da conta para quem só mandasse 5 senhas erradas. Agora o
      // aviso de bloqueio só chega a quem já provou saber a senha.
      if (user.lockUntil && user.lockUntil > Date.now()) {
        const minutosRestantes = Math.ceil((user.lockUntil - Date.now()) / (60 * 1000));
        return {
          success: false,
          error: `Conta bloqueada temporariamente. Tente novamente em ${minutosRestantes} minutos.`,
          code: 'ACCOUNT_LOCKED',
          minutosRestantes
        };
      }

      // 6. Login bem-sucedido: reseta tentativas
      await Usuario.updateOne(
        { _id: user._id },
        {
          $set: { loginAttempts: 0 },
          $unset: { lockUntil: '' }
        }
      );

      // 7. Verificar 2FA
      const userWith2FA = await Usuario.findById(user._id).select('+twoFactorEnabled');
      if (userWith2FA && userWith2FA.twoFactorEnabled) {
        const twoFAData = await this._generateTwoFactorCode(user._id, user.email, user.nome);
        return {
          success: true,
          requires2FA: true,
          userId: user._id,
          message: `Código de verificação enviado para ${user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3')}`
        };
      }

      // 8. Sem 2FA: gera token JWT
      const token = this._generateJWT(user);

      // 9. Atualizar último login
      await Usuario.updateOne(
        { _id: user._id },
        { $set: { ultimoLogin: new Date() } }
      );

      return {
        success: true,
        requires2FA: false,
        token,
        user: {
          id: user._id,
          nome: user.nome,
          perfil: user.perfil,
          email: user.email,
          deveMudarSenha: user.deveMudarSenha,
          cpf: user.cpf,
          telefone: user.telefone,
          consentimentoAceiteEm: user.consentimentoAceiteEm,
          perfilDefinidoEm: user.perfilDefinidoEm || null,
          tutorialProfessorConcluido: !!user.tutorialProfessorConcluido,
          tutorialResponsavelConcluido: !!user.tutorialResponsavelConcluido,
          foto: user.foto || '',
          fotoGoogle: user.fotoGoogle || ''
        }
      };
    } catch (error) {
      logger.error('AuthenticationService.login error', {
        email,
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message,
        code: 'LOGIN_ERROR'
      };
    }
  }

  /**
   * Realiza logout limpando o JWT
   */
  static async logout(userId) {
    try {
      await Usuario.updateOne(
        { _id: userId },
        { $set: { ultimoLogout: new Date() } }
      );

      return {
        success: true,
        message: 'Logout realizado com sucesso'
      };
    } catch (error) {
      logger.error('AuthenticationService.logout error', {
        userId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Valida um token JWT
   */
  static validateToken(token) {
    try {
      const decoded = jwt.verify(token, ACTUAL_JWT_SECRET);
      return {
        success: true,
        decoded
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        code: 'INVALID_TOKEN'
      };
    }
  }

  /**
   * Verifica código 2FA e emite JWT se válido
   */
  static async verify2FA(userId, codigo) {
    try {
      const user = await Usuario.findById(userId);
      if (!user) {
        return {
          success: false,
          error: 'Usuário não encontrado',
          code: 'USER_NOT_FOUND'
        };
      }

      // Validar código
      const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');
      
      if (
        codigoHash !== user.twoFactorPendingToken ||
        !user.twoFactorPendingExpiry ||
        user.twoFactorPendingExpiry < Date.now()
      ) {
        return {
          success: false,
          error: 'Código inválido ou expirado',
          code: 'INVALID_2FA_CODE'
        };
      }

      // Código válido: limpar tokens pendentes e emitir JWT
      const token = this._generateJWT(user);
      await Usuario.updateOne(
        { _id: userId },
        {
          $unset: {
            twoFactorPendingToken: '',
            twoFactorPendingExpiry: ''
          },
          $set: { ultimoLogin: new Date() }
        }
      );

      return {
        success: true,
        token,
        user: {
          id: user._id,
          nome: user.nome,
          perfil: user.perfil,
          email: user.email
        }
      };
    } catch (error) {
      logger.error('AuthenticationService.verify2FA error', {
        userId,
        error: error.message
      });
      return {
        success: false,
        error: error.message,
        code: 'VERIFY_2FA_ERROR'
      };
    }
  }

  /**
   * ──────────────────────────────────────────────────────────────
   * PRIVATE METHODS
   * ──────────────────────────────────────────────────────────────
   */

  /**
   * Valida senha. SOMENTE bcrypt — o caminho legado foi REMOVIDO.
   *
   * A comparação em texto puro (`user.senha === senhaPlain`) não era
   * constant-time e, pior, aceitava como credencial válida um valor lido
   * direto do banco: qualquer leitura do Mongo (backup, dump, injection)
   * virava login sem quebrar hash nenhum. A "migração automática" também só
   * acontecia para quem ACERTASSE a senha — contas legadas nunca acessadas
   * ficavam expostas esperando um atacante chegar antes do dono.
   *
   * Contas sem bcrypt devem ser convertidas com
   * `node scripts/migrar-senhas-bcrypt.js` ou passar pela recuperação de senha.
   */
  static async _validatePassword(user, senhaPlain) {
    if (this.isHashed(user.senha)) {
      return await bcrypt.compare(senhaPlain, user.senha);
    }

    // Consome o mesmo tempo do caminho normal para não distinguir
    // "conta com senha legada" de "senha errada".
    await bcrypt.compare(String(senhaPlain), HASH_DUMMY);
    logger.warn(`🔐 [SECURITY] Login barrado: conta ${user.email} sem hash bcrypt. Rode scripts/migrar-senhas-bcrypt.js.`);
    return false;
  }

  /**
   * Trata tentativas de login falhadas com brute force protection
   */
  static async _handleFailedLogin(user) {
    const attempts = (user.loginAttempts || 0) + 1;
    const updateData = { loginAttempts: attempts };

    if (attempts >= 5) {
      // Bloqueia conta por 15 minutos após 5 tentativas falhas
      updateData.lockUntil = Date.now() + 15 * 60 * 1000;
      updateData.loginAttempts = 0;

      logger.warn(`🔐 [BRUTE_FORCE] Conta bloqueada: ${user.email}`);
    }

    await Usuario.updateOne({ _id: user._id }, { $set: updateData });
  }

  /**
   * Gera código 2FA e envia por email
   */
  static async _generateTwoFactorCode(userId, email, nome) {
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const codigoHash = crypto.createHash('sha256').update(codigo).digest('hex');
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutos

    await Usuario.findByIdAndUpdate(userId, {
      twoFactorPendingToken: codigoHash,
      twoFactorPendingExpiry: expiry
    });

    // TODO: Enviar por email (usar EmailService)
    // NUNCA logar `codigo`: o log é o segundo fator. Quem lê o log (operador,
    // agregador, backup) contornaria o 2FA de qualquer conta. Só o evento.
    logger.info('🔐 [2FA] Código gerado', { userId: String(userId), action: '2fa.gerar' });

    return {
      codigo,
      expiresIn: 5 * 60, // segundos
      email
    };
  }

  /**
   * Gera JWT com payloads do usuário
   */
  static _generateJWT(user) {
    return jwt.sign(
      {
        id: user._id,
        perfil: user.perfil,
        email: user.email,
        nome: user.nome,
        deveMudarSenha: user.deveMudarSenha,
        profileCompleted: !!user.profileCompleted,
        tokenVersion: user.tokenVersion || 0
      },
      ACTUAL_JWT_SECRET,
      { expiresIn: '8h' }
    );
  }
}

module.exports = AuthenticationService;
