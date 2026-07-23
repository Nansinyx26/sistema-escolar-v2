/**
 * RegistrationService.js
 * 
 * Responsável por toda a lógica de cadastro de usuários:
 * - Registro de Responsáveis (com validação de código secreto do aluno)
 * - Registro de Docentes (com validação de código secreto da escola)
 * - Registro com código secreto
 * - Primeiro acesso (para professores pré-cadastrados)
 * 
 * Extraído de UserController.js para melhor manutenibilidade
 */

const Usuario = require('../models/Usuario');
const Professor = require('../models/Professor');
const Aluno = require('../models/Aluno');
const Notificacao = require('../models/Notificacao');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');
const ACTUAL_JWT_SECRET = require('../utils/jwtConfig');
const { logAction } = require('../utils/auditHelper');
const logger = require('../utils/logger');
const { emitirParaPerfis } = require('../utils/realtime');

const SALT_ROUNDS = 12;

class RegistrationService {
  /**
   * Valida formato de email
   */
  static validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Valida força da senha
   * Requisito: mínimo 8 caracteres, 1 maiúscula, 1 número, 1 caractere especial
   */
  static validatePasswordStrength(senha) {
    if (senha.length < 8) return false;
    if (!/[A-Z]/.test(senha)) return false;
    if (!/\d/.test(senha)) return false;
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(senha)) return false;
    return true;
  }

  /**
   * Registro de Responsável (Portal do Responsável)
   * Valida código secreto do aluno e vincula automaticamente
   * 
   * @param {Object} data - { nome, email, senha, telefone, codigoSecreto }
   * @returns {Object} { success, user?, token?, error? }
   */
  static async registerResponsavel(data) {
    try {
      const { nome, email, senha, telefone, codigoSecreto } = data;

      // Validações
      if (!nome || !email || !senha || !telefone) {
        return {
          success: false,
          error: 'Todos os campos são obrigatórios (Nome, E-mail, Senha e Telefone).',
          code: 'MISSING_FIELDS'
        };
      }

      if (!codigoSecreto) {
        return {
          success: false,
          error: 'O Código Secreto do Aluno é obrigatório.',
          code: 'MISSING_CODE'
        };
      }

      if (!this.validateEmail(email)) {
        return {
          success: false,
          error: 'E-mail inválido.',
          code: 'INVALID_EMAIL'
        };
      }

      if (!this.validatePasswordStrength(senha)) {
        return {
          success: false,
          error: 'A senha deve ter mínimo 8 caracteres, 1 maiúscula, 1 número e 1 caractere especial.',
          code: 'WEAK_PASSWORD'
        };
      }

      // Buscar aluno pelo código secreto
      const aluno = await Aluno.findOne({
        codigoSecreto: codigoSecreto.trim().toUpperCase()
      });

      if (!aluno) {
        return {
          success: false,
          error: 'Código secreto inválido. Verifique e tente novamente.',
          code: 'INVALID_CODE'
        };
      }

      // Verificar se aluno já possui responsável vinculado
      if (aluno.responsavel && this.validateEmail(aluno.responsavel)) {
        return {
          success: false,
          error: 'Este aluno já possui um responsável vinculado.',
          code: 'RESPONSAVEL_EXISTS'
        };
      }

      // Verificar duplicidade de email
      const existingUser = await Usuario.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return {
          success: false,
          error: 'Este e-mail já está em uso.',
          code: 'EMAIL_DUPLICATE'
        };
      }

      // Criar usuário
      const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
      const now = new Date();

      const user = await Usuario.create({
        nome,
        email: email.toLowerCase(),
        senha: senhaHash,
        telefone,
        perfil: 'responsavel',
        ativo: true,
        ultimoLogin: now,
        lastLogin: now,
        consentimentoAceiteEm: now
      });

      // Vincular aluno ao responsável
      aluno.responsavel = email.toLowerCase();
      await aluno.save();

      logger.info(`🔗 [RESPONSAVEL] Aluno "${aluno.nome}" vinculado a "${nome}" (${email})`);

      // Criar notificação para direção
      await Notificacao.create({
        id: 'notif_reg_' + Date.now(),
        tipo: 'cadastro',
        titulo: `Novo responsável cadastrado`,
        mensagem: `${nome} se cadastrou como Responsável e foi vinculado ao aluno "${aluno.nome}".`,
        destinatarios: 'diretores',
        status: 'enviado',
        escolaId: undefined
      });

      // Emitir notificação em tempo real
      // Restrito à direção da escola do aluno (o emit global entregava o
      // nome do responsável e da criança a toda a rede).
      emitirParaPerfis(aluno.escolaId, ['diretor', 'admin', 'secretaria'], 'new-registration', {
        nome: user.nome,
        perfil: 'Responsável',
        alunoVinculado: aluno.nome,
        data: now.toLocaleDateString('pt-BR')
      });

      // Gerar JWT
      const token = this._generateJWT(user);

      return {
        success: true,
        message: `Conta criada! Aluno "${aluno.nome}" vinculado automaticamente.`,
        token,
        user: {
          id: user._id,
          nome: user.nome,
          perfil: user.perfil,
          email: user.email
        }
      };
    } catch (error) {
      logger.error('RegistrationService.registerResponsavel error', {
        email: data?.email,
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message,
        code: 'REGISTRATION_ERROR'
      };
    }
  }

  /**
   * Registro de Docente (Professor/Diretor)
   * Valida código secreto da escola
   * Cria automaticamente registro na coleção 'professores'
   * 
   * @param {Object} data - { nome, email, senha, disciplina, turma, matricula, telefone, codigoEscola }
   * @returns {Object} { success, user?, token?, error? }
   */
  static async registerDocente(data) {
    try {
      const { nome, email, senha, disciplina, turma, matricula, telefone, codigoEscola } = data;

      // Validações
      if (!nome || !email || !senha || !disciplina || !turma || !matricula || !telefone || !codigoEscola) {
        return {
          success: false,
          error: 'Todos os campos são obrigatórios.',
          code: 'MISSING_FIELDS'
        };
      }

      // TODO: Validar código secreto da escola
      // const SecurityController = require('../controllers/SecurityController');
      // const isValidCode = await SecurityController.validateCode(codigoEscola);
      // if (!isValidCode) {
      //   return { success: false, error: 'Código Secreto inválido.', code: 'INVALID_CODE' };
      // }

      if (!this.validateEmail(email)) {
        return {
          success: false,
          error: 'E-mail inválido.',
          code: 'INVALID_EMAIL'
        };
      }

      if (!this.validatePasswordStrength(senha)) {
        return {
          success: false,
          error: 'A senha deve ter mínimo 8 caracteres, 1 maiúscula, 1 número e 1 caractere especial.',
          code: 'WEAK_PASSWORD'
        };
      }

      // Verificar duplicidade de email
      const existingUser = await Usuario.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return {
          success: false,
          error: 'Este e-mail já está em uso.',
          code: 'EMAIL_DUPLICATE'
        };
      }

      // Criar usuário
      const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
      const now = new Date();

      const user = await Usuario.create({
        nome,
        email: email.toLowerCase(),
        senha: senhaHash,
        disciplina,
        turma,
        matricula,
        telefone,
        perfil: 'professor',
        ativo: true,
        ultimoLogin: now,
        lastLogin: now,
        consentimentoAceiteEm: now
      });

      // Criar registro de professor
      const materiaEspecial = ['Inglês', 'Educação Física', 'Artes', 'SEBRAE', 'Oficina de Leitura'].includes(disciplina);
      const salaPrincipal = materiaEspecial ? 'VARIADOS' : turma;
      const salasAdicionais = materiaEspecial ? [turma] : [];

      await Professor.create({
        _id: new mongoose.Types.ObjectId().toString(),
        idUsuario: user._id.toString(),
        nome: user.nome,
        email: user.email.toLowerCase(),
        telefone: user.telefone,
        disciplina: disciplina,
        salaPrincipal: salaPrincipal,
        salasAdicionais: salasAdicionais,
        turmas: [turma],
        materias: [disciplina],
        tipoEspecial: materiaEspecial,
        role: 'professor',
        ativo: true,
        // Nunca a string literal 'default': ela tornava o registro visível a
        // todas as escolas no filtro tolerante. Herda a escola da conta.
        escola: user.escolaId ? String(user.escolaId) : undefined,
        vinculos: user.escolaId ? [{ escolaId: String(user.escolaId), cargo: 'professor' }] : []
      });

      // Criar notificação para direção
      await Notificacao.create({
        id: 'notif_reg_' + Date.now(),
        tipo: 'cadastro',
        titulo: `Novo docente cadastrado`,
        mensagem: `${nome} se cadastrou como Docente (${disciplina} - ${turma}).`,
        destinatarios: 'diretores',
        status: 'enviado',
        escolaId: undefined
      });

      // Emitir notificação em tempo real
      emitirParaPerfis(user.escolaId, ['diretor', 'admin', 'secretaria'], 'new-registration', {
        nome: user.nome,
        perfil: 'Docente',
        disciplina,
        turma,
        data: now.toLocaleDateString('pt-BR')
      });

      // Gerar JWT
      const token = this._generateJWT(user);

      return {
        success: true,
        message: 'Conta de docente criada com sucesso!',
        token,
        user: {
          id: user._id,
          nome: user.nome,
          perfil: user.perfil,
          email: user.email
        }
      };
    } catch (error) {
      logger.error('RegistrationService.registerDocente error', {
        email: data?.email,
        error: error.message,
        stack: error.stack
      });
      return {
        success: false,
        error: error.message,
        code: 'REGISTRATION_ERROR'
      };
    }
  }

  /**
   * Primeiro acesso para professores pré-cadastrados
   * Valida CPF/Email contra tabela de professores pré-cadastrados
   * 
   * @param {string} emailOrCpf - Email ou CPF do professor
   * @param {string} password - Nova senha
   * @returns {Object} { success, message?, error? }
   */
  static async firstAccess(emailOrCpf, password) {
    try {
      if (!password || password.length < 8) {
        return {
          success: false,
          error: 'A senha deve ter no mínimo 8 caracteres.',
          code: 'WEAK_PASSWORD'
        };
      }

      // Buscar professor pré-cadastrado
      const prof = await Professor.findOne({
        $or: [
          { email: emailOrCpf.toLowerCase() },
          { cpf: emailOrCpf.replace(/\D/g, '') }
        ]
      });

      if (!prof) {
        return {
          success: false,
          error: 'Dados não encontrados no pré-cadastro.',
          code: 'PROFESSOR_NOT_FOUND'
        };
      }

      // Verificar se já existe usuário
      const existingUser = await Usuario.findOne({ email: prof.email.toLowerCase() });
      if (existingUser && existingUser.senha) {
        return {
          success: false,
          error: 'Este e-mail já possui uma conta ativa. Use a recuperação de senha.',
          code: 'ACCOUNT_EXISTS'
        };
      }

      // Criar ou atualizar usuário
      const senhaHash = await bcrypt.hash(password, SALT_ROUNDS);
      let user;

      if (existingUser) {
        existingUser.senha = senhaHash;
        existingUser.ativo = true;
        await existingUser.save();
        user = existingUser;
      } else {
        user = await Usuario.create({
          nome: prof.nome,
          email: prof.email.toLowerCase(),
          senha: senhaHash,
          cpf: prof.cpf || '000.000.000-00',
          telefone: prof.telefone || '(00) 00000-0000',
          perfil: 'professor',
          ativo: true
        });
      }

      logger.info(`✅ [FIRST_ACCESS] Professor "${prof.nome}" ativou sua conta`);

      return {
        success: true,
        message: 'Conta ativada com sucesso! Você já pode fazer login.'
      };
    } catch (error) {
      logger.error('RegistrationService.firstAccess error', {
        emailOrCpf,
        error: error.message
      });
      return {
        success: false,
        error: error.message,
        code: 'REGISTRATION_ERROR'
      };
    }
  }

  /**
   * Registro com código secreto
   * Similar ao firstAccess mas para novos professores
   * 
   * @param {Object} data - { nome, email, senha, codigoSecreto, cpf, telefone }
   * @returns {Object} { success, user?, token?, error? }
   */
  static async registerWithCode(data) {
    try {
      const { nome, email, senha, codigoSecreto, cpf, telefone } = data;

      if (!senha || senha.length < 8) {
        return {
          success: false,
          error: 'A senha deve ter no mínimo 8 caracteres.',
          code: 'WEAK_PASSWORD'
        };
      }

      // TODO: Validar código secreto da escola
      // const isValid = await SecurityController.validateCode(codigoSecreto);
      // if (!isValid) {
      //   return { success: false, error: 'Código inválido ou expirado.', code: 'INVALID_CODE' };
      // }

      // Verificar duplicidade
      const existing = await Usuario.findOne({ email: email.toLowerCase() });
      if (existing) {
        return {
          success: false,
          error: 'Este e-mail já está cadastrado.',
          code: 'EMAIL_DUPLICATE'
        };
      }

      // Criar conta
      const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
      const emailVerificacaoToken = crypto.randomBytes(32).toString('hex');

      const user = await Usuario.create({
        nome,
        email: email.toLowerCase(),
        senha: senhaHash,
        cpf: cpf ? cpf.replace(/\D/g, '') : undefined,
        telefone: telefone ? telefone.replace(/\D/g, '') : undefined,
        perfil: 'professor',
        ativo: true,
        emailVerificado: false,
        emailVerificacaoToken,
        emailVerificacaoExpiry: Date.now() + 24 * 60 * 60 * 1000
      });

      // Gerar JWT
      const token = this._generateJWT(user);

      logger.info(`✅ [REGISTER_CODE] Nova conta criada: ${email}`);

      return {
        success: true,
        message: 'Conta criada e autenticada com sucesso!',
        token,
        user: {
          id: user._id,
          nome: user.nome,
          perfil: user.perfil,
          email: user.email
        }
      };
    } catch (error) {
      logger.error('RegistrationService.registerWithCode error', {
        email: data?.email,
        error: error.message
      });
      return {
        success: false,
        error: error.message,
        code: 'REGISTRATION_ERROR'
      };
    }
  }

  /**
   * ──────────────────────────────────────────────────────────────
   * PRIVATE METHODS
   * ──────────────────────────────────────────────────────────────
   */

  /**
   * Gera JWT com payload do usuário
   */
  static _generateJWT(user) {
    return jwt.sign(
      {
        id: user._id,
        perfil: user.perfil,
        email: user.email,
        nome: user.nome,
        tokenVersion: user.tokenVersion || 0
      },
      ACTUAL_JWT_SECRET,
      { expiresIn: '8h' }
    );
  }
}

module.exports = RegistrationService;
