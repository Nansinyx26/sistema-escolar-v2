/**
 * Swagger/OpenAPI Configuration — P3 Implementation
 * 
 * Documentação automática de API com Swagger
 * Integra com swagger-ui para interface interativa
 * 
 * @module SwaggerConfig
 * @version 1.0
 */

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Sistema Escolar v2 API',
      version: '2.0.0',
      description: 'API completa para gerenciamento escolar',
      contact: {
        name: 'Suporte',
        email: 'suporte@sistemaescolar.com',
      },
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server',
      },
      {
        url: 'https://api.sistemaescolar.com',
        description: 'Production server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT token para autenticação',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'jwt',
          description: 'JWT token em cookie',
        },
      },
      schemas: {
        // User/Auth
        LoginRequest: {
          type: 'object',
          required: ['email', 'senha'],
          properties: {
            email: { type: 'string', format: 'email' },
            senha: { type: 'string', format: 'password' },
            portal: { type: 'string', enum: ['docente', 'responsavel'] },
          },
        },
        LoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            token: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                _id: { type: 'string' },
                email: { type: 'string' },
                nome: { type: 'string' },
                perfil: { type: 'string' },
              },
            },
            requires2FA: { type: 'boolean' },
          },
        },
        
        // Error
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            code: { type: 'string' },
            details: { type: 'object' },
          },
        },
        
        // Pagination
        PaginatedResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'array' },
            pagination: {
              type: 'object',
              properties: {
                page: { type: 'number' },
                limit: { type: 'number' },
                total: { type: 'number' },
                pages: { type: 'number' },
                hasNextPage: { type: 'boolean' },
                hasPrevPage: { type: 'boolean' },
              },
            },
          },
        },
        
        // Aluno
        Aluno: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            nome: { type: 'string' },
            email: { type: 'string' },
            matricula: { type: 'string' },
            turma_id: { type: 'string' },
            responsaveis: { type: 'array', items: { type: 'string' } },
            ativo: { type: 'boolean' },
          },
        },
        
        // Nota
        Nota: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            aluno_id: { type: 'string' },
            disciplina: { type: 'string' },
            valor: { type: 'number', minimum: 0, maximum: 10 },
            bimestre: { type: 'number', minimum: 1, maximum: 4 },
            dataRegistro: { type: 'string', format: 'date-time' },
          },
        },
        
        // Comunicado
        Comunicado: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            titulo: { type: 'string' },
            conteudo: { type: 'string' },
            autor: { type: 'string' },
            dataCriacao: { type: 'string', format: 'date-time' },
            destinatarios: { type: 'array', items: { type: 'string' } },
            ativo: { type: 'boolean' },
          },
        },
      },
      responses: {
        UnauthorizedError: {
          description: 'Authentication information is missing or invalid',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
        BadRequestError: {
          description: 'Invalid request parameters',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
            },
          },
        },
      },
    },
    security: [
      {
        bearerAuth: [],
      },
      {
        cookieAuth: [],
      },
    ],
  },
  apis: [
    './src/routes/*.js',
    './src/controllers/*.js',
  ],
};

const specs = swaggerJsdoc(options);

/**
 * Setup Swagger UI
 */
function setupSwagger(app) {
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(specs, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
      },
      customCss: '.topbar { display: none }',
      customSiteTitle: 'Sistema Escolar v2 API',
    })
  );

  // Health check endpoint
  app.get('/api/docs/health', (req, res) => {
    res.json({
      status: 'ok',
      documentation: '/api/docs',
      openapi: specs.openapi,
    });
  });

  console.log('✅ Swagger UI available at http://localhost:3000/api/docs');
}

module.exports = {
  setupSwagger,
  specs,
};

/**
 * Exemplo de documentação JSDoc para controllers:
 * 
 * /**
 *  * @swagger
 *  * /api/auth/login:
 *  *   post:
 *  *     summary: Fazer login
 *  *     tags: [Auth]
 *  *     requestBody:
 *  *       required: true
 *  *       content:
 *  *         application/json:
 *  *           schema:
 *  *             $ref: '#/components/schemas/LoginRequest'
 *  *     responses:
 *  *       200:
 *  *         description: Login successful
 *  *         content:
 *  *           application/json:
 *  *             schema:
 *  *               $ref: '#/components/schemas/LoginResponse'
 *  *       401:
 *  *         $ref: '#/components/responses/UnauthorizedError'
 *  *       400:
 *  *         $ref: '#/components/responses/BadRequestError'
 */
