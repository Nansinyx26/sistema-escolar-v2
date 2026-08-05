/**
 * PasswordRecoveryService.js
 * 
 * Responsável por toda a lógica de recuperação e redefinição de senha:
 * - Solicitação de código de recuperação
 * - Verificação de código
 * - Redefinição de senha
 * - Atualização forçada de senha (quando criado por Admin)
 * 
 * Extraído de UserController.js para melhor manutenibilidade
 */

const Usuario = require('../models/Usuario');
const RecuperacaoSenha = require('../models/RecuperacaoSenha');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const EmailService = require('../services/EmailService');
const { logAction } = require('../utils/auditHelper');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

const SALT_ROUNDS = 12;

class PasswordRecoveryService {
  /**
   * Valida força da senha
   */
  static validatePasswordStrength(password) {
    if (password.length < 8) {
      return { valid: false, error: 'A senha deve ter no mínimo 8 caracteres.' };
    }
    if (!/[A-Z]/.test(password)) {
      return { valid: false, error: 'A senha deve conter pelo menos uma letra maiúscula.' };
    }
    if (!/\d/.test(password)) {
      return { valid: false, error: 'A senha deve conter pelo menos um número.' };
    }
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return { valid: false, error: 'A senha deve conter pelo menos um caractere especial.' };
    }
    return { valid: true };
  }

  /**
   * Solicita código de recuperação de senha por email
   * Usa mensagem padrão para não revelar se email existe no sistema
   * 
   * @param {string} email - Email do usuário
   * @returns {Object} { success, message, code_debug? (apenas em dev) }
   */
  static async forgotPassword(email) {
    try {
      if (!email) {
        return {
          success: false,
          error: 'E-mail é obrigatório.',
          code: 'MISSING_EMAIL'
        };
      }

      // Mensagem padrão para segurança (evita email harvesting)
      const standardResponse = {
        success: true,
        message: 'Se o e-mail estiver cadastrado no sistema, você receberá um código de recuperação em instantes.'
      };

      // Buscar usuário
      const user = await Usuario.findOne({
        email: email.toLowerCase(),
        ativo: true
      });

      if (!user) {
        return standardResponse;
      }

      // 1. Invalidar códigos anteriores
      await RecuperacaoSenha.updateMany(
        { usuarioId: user._id, status: 'ativo' },
        { $set: { status: 'expirado' } }
      );

      // 2. Gerar código de 6 dígitos
      const code = crypto.randomInt(100000, 999999).toString();

      // 3. Salvar com expiração
      await RecuperacaoSenha.create({
        usuarioId: user._id,
        codigo: code,
        criadoEm: new Date(),
        expiraEm: new Date(Date.now() + 15 * 60 * 1000), // 15 minutos
        status: 'ativo',
        tentativas: 0
      });

      // 4. Salvar código em arquivo local (para testes E2E)
      try {
        fs.writeFileSync(path.join(__dirname, '../../latest_code.txt'), code);
      } catch (fsErr) {
        logger.warn('Could not write latest_code.txt', { error: fsErr.message });
      }

      // 5. Enviar email em background
      await EmailService.sendVerificationCode(user.email, code, user.nome).catch(err => {
        logger.error('Failed to send recovery code email', { error: err.message });
      });

      logger.info(`📧 [FORGOT_PASSWORD] Código enviado para ${user.email}`);

      // Retornar código apenas em desenvolvimento
      if (process.env.NODE_ENV === 'development') {
        standardResponse.code_debug = code;
      }

      return standardResponse;
    } catch (error) {
      logger.error('PasswordRecoveryService.forgotPassword error', {
        email,
        error: error.message
      });
      return {
        success: false,
        error: error.message,
        code: 'FORGOT_PASSWORD_ERROR'
      };
    }
  }

  /**
   * Verifica se o código de recuperação é válido
   * 
   * @param {string} email - Email do usuário
   * @param {string} codigo - Código de recuperação
   * @returns {Object} { success, message?, error? }
   */
  static async verifyRecoveryCode(email, codigo) {
    try {
      if (!email || !codigo) {
        return {
          success: false,
          error: 'E-mail e código são obrigatórios.',
          code: 'MISSING_FIELDS'
        };
      }

      // Buscar usuário
      const user = await Usuario.findOne({
        email: email.toLowerCase(),
        ativo: true
      });

      if (!user) {
        return {
          success: false,
          error: 'Código inválido ou expirado.',
          code: 'USER_NOT_FOUND'
        };
      }

      // Buscar código ativo
      const recovery = await RecuperacaoSenha.findOne({
        usuarioId: user._id,
        status: 'ativo'
      });

      if (!recovery) {
        return {
          success: false,
          error: 'Código inválido ou expirado.',
          code: 'NO_ACTIVE_CODE'
        };
      }

      // Verificar expiração
      if (recovery.expiraEm < Date.now()) {
        recovery.status = 'expirado';
        await recovery.save();
        return {
          success: false,
          error: 'Código expirado. Solicite um novo código.',
          code: 'CODE_EXPIRED'
        };
      }

      // Verificar limite de tentativas
      if (recovery.tentativas >= 5) {
        recovery.status = 'expirado';
        await recovery.save();
        return {
          success: false,
          error: 'Código bloqueado por excesso de tentativas. Solicite um novo código.',
          code: 'CODE_BLOCKED'
        };
      }

      // Comparar código
      if (recovery.codigo !== codigo.trim()) {
        recovery.tentativas += 1;
        await recovery.save();

        if (recovery.tentativas >= 5) {
          recovery.status = 'expirado';
          await recovery.save();
          return {
            success: false,
            error: 'Código bloqueado por excesso de tentativas. Solicite um novo código.',
            code: 'CODE_BLOCKED'
          };
        }

        return {
          success: false,
          error: 'Código inválido.',
          code: 'INVALID_CODE'
        };
      }

      logger.info(`✅ [VERIFY_CODE] Código verificado para ${email}`);

      return {
        success: true,
        message: 'Código verificado com sucesso.'
      };
    } catch (error) {
      logger.error('PasswordRecoveryService.verifyRecoveryCode error', {
        email,
        error: error.message
      });
      return {
        success: false,
        error: error.message,
        code: 'VERIFY_CODE_ERROR'
      };
    }
  }

  /**
   * Redefine a senha usando o código de recuperação
   * Completa o fluxo de recuperação de senha
   * 
   * @param {string} email - Email do usuário
   * @param {string} codigo - Código de recuperação
   * @param {string} password - Nova senha
   * @returns {Object} { success, message?, error? }
   */
  static async resetPassword(email, codigo, password) {
    try {
      if (!email || !codigo || !password) {
        return {
          success: false,
          error: 'E-mail, código e nova senha são obrigatórios.',
          code: 'MISSING_FIELDS'
        };
      }

      // Validar força da senha
      const validation = this.validatePasswordStrength(password);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          code: 'WEAK_PASSWORD'
        };
      }

      // Buscar usuário
      const user = await Usuario.findOne({
        email: email.toLowerCase(),
        ativo: true
      });

      if (!user) {
        return {
          success: false,
          error: 'Código inválido ou expirado.',
          code: 'USER_NOT_FOUND'
        };
      }

      // Buscar código ativo
      const recovery = await RecuperacaoSenha.findOne({
        usuarioId: user._id,
        status: 'ativo'
      });

      if (!recovery) {
        return {
          success: false,
          error: 'Código inválido ou expirado.',
          code: 'NO_ACTIVE_CODE'
        };
      }

      // Verificar expiração
      if (recovery.expiraEm < Date.now()) {
        recovery.status = 'expirado';
        await recovery.save();
        return {
          success: false,
          error: 'Código expirado. Solicite um novo código.',
          code: 'CODE_EXPIRED'
        };
      }

      // Verificar limite de tentativas
      if (recovery.tentativas >= 5) {
        recovery.status = 'expirado';
        await recovery.save();
        return {
          success: false,
          error: 'Código bloqueado por excesso de tentativas. Solicite um novo código.',
          code: 'CODE_BLOCKED'
        };
      }

      // Validar código
      if (recovery.codigo !== codigo.trim()) {
        recovery.tentativas += 1;
        await recovery.save();

        if (recovery.tentativas >= 5) {
          recovery.status = 'expirado';
          await recovery.save();
          return {
            success: false,
            error: 'Código bloqueado por excesso de tentativas.',
            code: 'CODE_BLOCKED'
          };
        }

        return {
          success: false,
          error: 'Código inválido.',
          code: 'INVALID_CODE'
        };
      }

      // Atualizar senha
      const senhaHash = await bcrypt.hash(password, SALT_ROUNDS);
      await Usuario.updateOne(
        { _id: user._id },
        {
          $set: { senha: senhaHash },
          $inc: { tokenVersion: 1 },
          $unset: { resetToken: '', resetTokenExpiry: '' }
        }
      );

      // Marcar código como utilizado
      recovery.status = 'utilizado';
      recovery.utilizadoEm = new Date();
      await recovery.save();

      logger.info(`✅ [RESET_PASSWORD] Senha redefinida para ${email}`);

      return {
        success: true,
        message: 'Sua senha foi alterada com sucesso!'
      };
    } catch (error) {
      logger.error('PasswordRecoveryService.resetPassword error', {
        email,
        error: error.message
      });
      return {
        success: false,
        error: error.message,
        code: 'RESET_PASSWORD_ERROR'
      };
    }
  }

  /**
   * Força a mudança de senha na próxima ação
   * Usado quando admin cria usuário ou por política de segurança
   * 
   * @param {string} userId - ID do usuário
   * @param {string} newPassword - Nova senha
   * @returns {Object} { success, message?, error? }
   */
  static async updatePasswordForce(userId, newPassword) {
    try {
      if (!userId || !newPassword) {
        return {
          success: false,
          error: 'ID do usuário e nova senha são obrigatórios.',
          code: 'MISSING_FIELDS'
        };
      }

      // Validar força da senha
      const validation = this.validatePasswordStrength(newPassword);
      if (!validation.valid) {
        return {
          success: false,
          error: validation.error,
          code: 'WEAK_PASSWORD'
        };
      }

      // Buscar usuário
      const user = await Usuario.findById(userId);
      if (!user) {
        return {
          success: false,
          error: 'Usuário não encontrado.',
          code: 'USER_NOT_FOUND'
        };
      }

      // Atualizar senha e limpar flag deveMudarSenha
      const senhaHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await Usuario.updateOne(
        { _id: userId },
        {
          $set: {
            senha: senhaHash,
            deveMudarSenha: false
          },
          $inc: { tokenVersion: 1 }
        }
      );

      logger.info(`🔐 [UPDATE_PASSWORD] Senha forçada atualizada para ${user.email}`);

      return {
        success: true,
        message: 'Sua senha foi atualizada com sucesso!'
      };
    } catch (error) {
      logger.error('PasswordRecoveryService.updatePasswordForce error', {
        userId,
        error: error.message
      });
      return {
        success: false,
        error: error.message,
        code: 'UPDATE_PASSWORD_ERROR'
      };
    }
  }
}

module.exports = PasswordRecoveryService;
