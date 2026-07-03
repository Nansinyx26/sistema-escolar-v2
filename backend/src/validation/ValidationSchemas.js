/**
 * ValidationSchemas.js — DTOs de Validação com Joi
 * 
 * Define schemas de validação para todos os endpoints principais.
 * Padroniza validação e oferece mensagens de erro consistentes.
 * 
 * Uso:
 *   const result = LoginDTO.schema.validate(req.body);
 *   if (result.error) return res.status(400).json({ error: result.error.details[0].message });
 */

const Joi = require('joi');

/**
 * ════════════════════════════════════════════════════════════════
 * AUTENTICAÇÃO
 * ════════════════════════════════════════════════════════════════
 */

const LoginDTO = Joi.object({
  email: Joi.string()
    .email()
    .lowercase()
    .required()
    .messages({
      'string.email': 'Email deve ser um endereço de email válido',
      'any.required': 'Email é obrigatório'
    }),
  
  senha: Joi.string()
    .min(8)
    .required()
    .messages({
      'string.min': 'Senha deve ter no mínimo 8 caracteres',
      'any.required': 'Senha é obrigatória'
    }),
  
  portal: Joi.string()
    .valid('docente', 'responsavel')
    .optional()
    .default('docente')
    .messages({
      'any.only': 'Portal deve ser "docente" ou "responsavel"'
    })
});

const Verify2FAQTO = Joi.object({
  userId: Joi.string()
    .required()
    .messages({
      'any.required': 'userId é obrigatório'
    }),
  
  codigo: Joi.string()
    .length(6)
    .pattern(/^\d+$/)
    .required()
    .messages({
      'string.length': 'Código deve ter 6 dígitos',
      'string.pattern.base': 'Código deve conter apenas números',
      'any.required': 'Código é obrigatório'
    })
});

/**
 * ════════════════════════════════════════════════════════════════
 * REGISTRO
 * ════════════════════════════════════════════════════════════════
 */

const RegisterResponsavelDTO = Joi.object({
  nome: Joi.string()
    .min(3)
    .max(120)
    .required()
    .messages({
      'string.min': 'Nome deve ter no mínimo 3 caracteres',
      'string.max': 'Nome não pode ultrapassar 120 caracteres',
      'any.required': 'Nome é obrigatório'
    }),
  
  email: Joi.string()
    .email()
    .lowercase()
    .required()
    .messages({
      'string.email': 'Email inválido',
      'any.required': 'Email é obrigatório'
    }),
  
  senha: Joi.string()
    .min(8)
    .pattern(/[A-Z]/)
    .pattern(/[0-9]/)
    .pattern(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/)
    .required()
    .messages({
      'string.min': 'Senha deve ter no mínimo 8 caracteres',
      'string.pattern.base': 'Senha deve conter maiúscula, número e caractere especial',
      'any.required': 'Senha é obrigatória'
    }),
  
  telefone: Joi.string()
    .pattern(/^\d{10,11}$/)
    .required()
    .messages({
      'string.pattern.base': 'Telefone deve ter 10 ou 11 dígitos',
      'any.required': 'Telefone é obrigatório'
    }),
  
  codigoSecreto: Joi.string()
    .min(4)
    .required()
    .messages({
      'any.required': 'Código secreto do aluno é obrigatório'
    })
});

const RegisterDocenteDTO = Joi.object({
  nome: Joi.string()
    .min(3)
    .max(120)
    .required(),
  
  email: Joi.string()
    .email()
    .lowercase()
    .required(),
  
  senha: Joi.string()
    .min(8)
    .pattern(/[A-Z]/)
    .pattern(/[0-9]/)
    .pattern(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/)
    .required(),
  
  disciplina: Joi.string()
    .required()
    .messages({
      'any.required': 'Disciplina é obrigatória'
    }),
  
  turma: Joi.string()
    .required()
    .messages({
      'any.required': 'Turma é obrigatória'
    }),
  
  matricula: Joi.string()
    .required()
    .messages({
      'any.required': 'Matrícula é obrigatória'
    }),
  
  telefone: Joi.string()
    .pattern(/^\d{10,11}$/)
    .required(),
  
  codigoEscola: Joi.string()
    .required()
    .messages({
      'any.required': 'Código secreto da escola é obrigatório'
    })
});

const FirstAccessDTO = Joi.object({
  emailOrCpf: Joi.alternatives()
    .try(
      Joi.string().email(),
      Joi.string().pattern(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/)
    )
    .required()
    .messages({
      'alternatives.match': 'Informe um email ou CPF válido',
      'any.required': 'Email ou CPF é obrigatório'
    }),
  
  password: Joi.string()
    .min(8)
    .required()
    .messages({
      'string.min': 'Senha deve ter no mínimo 8 caracteres'
    })
});

/**
 * ════════════════════════════════════════════════════════════════
 * RECUPERAÇÃO DE SENHA
 * ════════════════════════════════════════════════════════════════
 */

const ForgotPasswordDTO = Joi.object({
  email: Joi.string()
    .email()
    .lowercase()
    .required()
    .messages({
      'any.required': 'Email é obrigatório'
    })
});

const VerifyRecoveryCodeDTO = Joi.object({
  email: Joi.string()
    .email()
    .lowercase()
    .required(),
  
  codigo: Joi.string()
    .length(6)
    .pattern(/^\d+$/)
    .required()
    .messages({
      'string.length': 'Código deve ter 6 dígitos'
    })
});

const ResetPasswordDTO = Joi.object({
  email: Joi.string()
    .email()
    .lowercase()
    .required(),
  
  codigo: Joi.string()
    .length(6)
    .pattern(/^\d+$/)
    .required(),
  
  password: Joi.string()
    .min(8)
    .pattern(/[A-Z]/)
    .pattern(/[0-9]/)
    .pattern(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/)
    .required()
});

/**
 * ════════════════════════════════════════════════════════════════
 * COMUNICADOS
 * ════════════════════════════════════════════════════════════════
 */

const CreateComunicadoDTO = Joi.object({
  titulo: Joi.string()
    .min(5)
    .max(200)
    .required()
    .messages({
      'string.min': 'Título deve ter no mínimo 5 caracteres',
      'any.required': 'Título é obrigatório'
    }),
  
  conteudo: Joi.string()
    .min(10)
    .max(10000)
    .required()
    .messages({
      'string.min': 'Conteúdo deve ter no mínimo 10 caracteres',
      'any.required': 'Conteúdo é obrigatório'
    }),
  
  tipo: Joi.string()
    .valid('mural', 'aviso', 'evento', 'outro')
    .optional()
    .default('mural'),
  
  destinatarios: Joi.array()
    .items(Joi.string())
    .min(1)
    .required()
    .messages({
      'any.required': 'Pelo menos um destinatário é obrigatório'
    }),
  
  statusAtivo: Joi.boolean()
    .optional()
    .default(true)
});

/**
 * ════════════════════════════════════════════════════════════════
 * NOTAS
 * ════════════════════════════════════════════════════════════════
 */

const CreateNotaDTO = Joi.object({
  alunoId: Joi.string()
    .required(),
  
  nota: Joi.number()
    .min(0)
    .max(10)
    .required()
    .messages({
      'number.min': 'Nota deve ser entre 0 e 10',
      'number.max': 'Nota não pode ultrapassar 10'
    }),
  
  bimestre: Joi.number()
    .integer()
    .min(1)
    .max(4)
    .required()
    .messages({
      'any.required': 'Bimestre é obrigatório'
    }),
  
  disciplina: Joi.string()
    .required()
    .messages({
      'any.required': 'Disciplina é obrigatória'
    })
});

/**
 * ════════════════════════════════════════════════════════════════
 * MIDDLEWARE
 * ════════════════════════════════════════════════════════════════
 */

/**
 * Middleware de validação genérico
 * 
 * Uso:
 *   router.post('/login', validateDTO(LoginDTO), LoginController.login);
 */
function validateDTO(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false, // Retornar todos os erros, não só o primeiro
      stripUnknown: true // Remover campos não definidos no schema
    });

    if (error) {
      const details = error.details.map(d => ({
        field: d.path.join('.'),
        message: d.message
      }));

      return res.status(400).json({
        success: false,
        error: 'Validação falhou',
        details
      });
    }

    // Armazenar dados validados
    req.validatedBody = value;
    next();
  };
}

/**
 * ════════════════════════════════════════════════════════════════
 * EXPORTAR
 * ════════════════════════════════════════════════════════════════
 */

module.exports = {
  // DTOs
  LoginDTO,
  Verify2FAQTO,
  RegisterResponsavelDTO,
  RegisterDocenteDTO,
  FirstAccessDTO,
  ForgotPasswordDTO,
  VerifyRecoveryCodeDTO,
  ResetPasswordDTO,
  CreateComunicadoDTO,
  CreateNotaDTO,

  // Middleware
  validateDTO
};
