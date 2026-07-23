# 📋 Análise Profunda de Melhorias — Backend Sistema Escolar v2

**Data:** 30 de junho de 2026  
**Versão:** 1.0  
**Status:** Detalhado — Pronto para implementação

---

## 1. Problemas Críticos Identificados

### 1.1 Controllers Gigantes e God Objects

**Severidade:** 🔴 CRÍTICA

#### UserController.js — 1.370 linhas
Concentra todas as operações de usuário em um único arquivo:
- Autenticação (login, logout, register)
- Recuperação de senha
- Verificação de email
- Onboarding
- Configurações de TTS/Acessibilidade
- Foto de perfil
- 2FA (autenticação de dois fatores)
- LGPD e consentimentos
- Primeiro acesso

**Impacto:**
- Impossível testar isoladamente cada funcionalidade
- Difícil debugar erros de login vs. configuração
- Risco de side effects ao modificar uma feature

**Recomendação:**
Quebrar em serviços especializados:
```
services/
├── AuthenticationService.js      (login, logout, session)
├── RegistrationService.js        (register, firstAccess)
├── PasswordRecoveryService.js    (forgot, reset, verify code)
├── EmailVerificationService.js   (email validation)
├── OnboardingService.js          (profile completion)
├── UserPreferencesService.js     (TTS, accessibility, narration)
├── LGPDService.js                (consents, anonimization)
└── UserPhotoService.js           (upload, serve, delete)
```

---

#### IAController.js — 644 linhas
Mistura IA Pedagógica, Chatbot e análise:
- Análise de desempenho
- Mapa de calor
- Predição de notas
- Chatbot com RBAC
- Fallback Gemini/banco

**Impacto:**
- Chatbot e analytics competem por espaço
- Lógica RBAC acoplada a lógica de análise

**Recomendação:**
Já existe `ChatbotService.js`; criar `PedagogicoAnalyticsService.js` separado:
```
services/
├── ChatbotService.js            (já existe, mas melhorar)
├── PedagogicoAnalyticsService.js (BI, heatmap, predição)
└── AIKnowledgeService.js        (base de conhecimento)
```

---

### 1.2 Modelo Usuario Inchado

**Severidade:** 🟠 ALTA

O schema `Usuario.js` contém **150+ campos** em um único documento:
- Autenticação
- Preferências de TTS/acessibilidade
- LGPD e consentimentos (15+ booleans)
- Dados de responsável
- Onboarding e tutorial
- Histórico de login
- Nomes legados (`id` + `_id`)
- Dados de segundo responsável

**Problemas:**
1. **Violação de Single Responsibility Principle:** um usuário não é autenticação + preferências + LGPD
2. **Inflação de payload:** queries retornam campos desnecessários
3. **Dificuldade de versionamento:** difícil evoluir schema sem migration complexa
4. **Mistura de normalização:** campos tanto no Usuario quanto em coleções legadas

**Recomendação:**
Separar em coleções especializadas:
```javascript
// Mantém identidade e autenticação
Usuario {
  _id, email, nome, telefone, cpf, perfil,
  senha, emailVerificado, twoFactorEnabled
}

// Preferências do usuário (derivado de Usuario)
UsuarioPreferencias {
  userId, voicePreference, ttsProvider, 
  accessibilityFontSize, narrationMode
}

// Consentimentos e LGPD (derivado)
UsuarioLGPD {
  userId, version, consents[], history[]
}

// Dados específicos de Responsável (derivado)
ResponsavelPerfil {
  userId, nomeAluno, parentesco, vinculoAluno,
  pessoasAutorizadas[], segundoResponsavel
}

// Onboarding e tutorial
UsuarioOnboarding {
  userId, tutorialConcluido, profileCompleted,
  concluidoEm, ultimosTops[]
}
```

---

### 1.3 Banco Forçado para "test"

**Severidade:** 🔴 CRÍTICA

Em `backend/src/utils/db.js`:
```javascript
if (process.env.NODE_ENV !== 'production') {
    dbName = 'test';
    mongoDev = mongodb_uri.replace(/\/[^/]+\?/, `/test?`);
    process.env.MONGODB_URI = mongoDev;
}
```

**Problemas:**
1. **Todos os ambientes (dev, staging, test) usam banco "test"**
2. Impossível ter dados isolados por ambiente
3. Reescrever URI programaticamente é frágil
4. Não respeita variável de ambiente `MONGODB_DB_NAME`

**Impacto:**
- Staging corre risco de usar dados de dev
- Testes podem corromper dados de desenvolvimento
- Onboarding local afeta todos os devs

**Recomendação:**
```javascript
// backend/src/utils/db.js
const dbName = process.env.MONGODB_DB_NAME || 
  (process.env.NODE_ENV === 'production' ? 'escola_prod' : 'escola_dev');

// Nunca reescreve a URI; deixa a responsabilidade ao .env
const connectDB = async () => {
  const uri = process.env.MONGODB_URI; // Já contém /dbname ou deixa default
  // connect(uri, { ...options });
};
```

**Atualizar `.env.example`:**
```env
MONGODB_URI=<connection string do Atlas>
MONGODB_DB_NAME=escola_dev
NODE_ENV=development
```

---

### 1.4 CORS Aberto e CSP Permissiva

**Severidade:** 🔴 CRÍTICA

Em `backend/src/app.js`:
```javascript
// CORS — Qualquer origin em dev
if (process.env.NODE_ENV !== 'production') {
    return callback(null, true); // Aceita ANY origin
}

// CSP — unsafe-inline em script-src
"script-src": ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net", ...]
```

**Problemas:**
1. Modo dev permite XSS lateral muito fácil
2. staging pode estar exposto
3. CSP com `'unsafe-inline'` reduz significativamente segurança

**Recomendação:**
```javascript
// CORS — Mesmo em dev, whitelist explícita
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173', // portal vite
  process.env.FRONTEND_URL
];

// Funciona em todos os ambientes
if (!allowedOrigins.includes(origin)) {
  return callback(new Error('CORS blocked'));
}

// CSP — remover unsafe-inline, usar nonce
"script-src": [
  "'self'",
  "cdn.jsdelivr.net",
  `'nonce-${req.csrfToken}'` // Gera nonce por request
]
```

---

### 1.5 CSRF Desabilitado Fora de Produção

**Severidade:** 🟠 ALTA

Em `backend/src/middleware/csrfProtection.js`:
```javascript
if (process.env.NODE_ENV !== 'production') {
    return next(); // Ignora validação em dev/test
}
```

**Problemas:**
1. Testes não cobrem CSRF realmente
2. Bugs podem passar por QA localmente
3. Falso senso de segurança

**Recomendação:**
```javascript
// Ativar CSRF em staging e testes
const skipCSRF = process.env.NODE_ENV === 'test' && process.env.SKIP_CSRF === 'true';
if (!skipCSRF) {
  // valida CSRF
}
```

---

## 2. Problemas de Arquitetura

### 2.1 Falta de Camada de Casos de Uso (Use Cases)

**Severidade:** 🟠 ALTA

Atualmente:
- Routes → Controllers → Models
- Controllers misturam validação, lógica e persistência

Melhor:
- Routes → Controllers → UseCases → Services → Models

**Exemplo:**
```javascript
// backend/src/usecases/AuthenticateUserUseCase.js
class AuthenticateUserUseCase {
  constructor(userRepository, sessionRepository, emailService) {
    this.userRepository = userRepository;
    this.sessionRepository = sessionRepository;
    this.emailService = emailService;
  }

  async execute(email, password) {
    // 1. Validar inputs
    // 2. Consultar usuario
    // 3. Verificar senha
    // 4. Registrar log
    // 5. Criar sessão
    // 6. Enviar notificação (opcional)
    return { user, token };
  }
}
```

Benefícios:
- Testável
- Reutilizável em CLI, eventos, jobs
- Lógica de negócio isolada de HTTP

---

### 2.2 36 Controllers para ~30 Recursos

**Severidade:** 🟠 ALTA

Estrutura atual:
```
controllers/
├── UserController.js           (1370 linhas) ← GIGANTE
├── IAController.js             (644 linhas)  ← GRANDE
├── StudentController.js
├── TeacherController.js
├── ResponsavelController.js
├── ... (30 mais)
```

Problemas:
1. Muitos controllers pequenos (50-100 linhas) fazem pouco
2. Alguns gigantes fazem tudo
3. Sem padrão claro de responsabilidade

**Recomendação:**
Agrupar por domínio:
```
controllers/
├── auth/
│   ├── LoginController.js
│   ├── RegisterController.js
│   └── PasswordRecoveryController.js
├── usuarios/
│   ├── UsuarioController.js
│   ├── PreferencesController.js
│   └── PhotoController.js
├── alunos/
│   ├── AlunoController.js
│   └── NotasController.js
├── pedagogico/
│   ├── DashboardPedagogicoController.js
│   ├── ChatbotController.js
│   └── AnalyticsController.js
└── comunicacao/
    ├── ComunicadoController.js
    ├── ComentarioController.js
    └── NotificacaoController.js
```

---

### 2.3 Express.static Servindo a Raiz do Projeto

**Severidade:** 🔴 CRÍTICA (Segurança)

Em `backend/src/app.js`:
```javascript
const frontendPath = path.join(__dirname, '../../');
app.use(express.static(frontendPath, { ... }));
```

Embora exista blacklist de padrões, é uma abordagem de negação (risco de bypass).

**Recomendação:**
```javascript
// Criar diretório public explícito
const publicPath = path.join(__dirname, '../../public');
app.use(express.static(publicPath, {
  maxAge: '1d',
  etag: false
}));

// SPA fallback apenas para rotas públicas
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(publicPath, 'index.html'));
});
```

---

## 3. Problemas de Performance

### 3.1 Sem Cache de Leitura

**Severidade:** 🟠 ALTA

- Dashboard, comunicados e notas fazem queries sem cache
- Em escala, isso impacta latência e custos de banco

**Recomendação:**
Introduzir Redis ou cache em memória:
```javascript
// services/CacheService.js
class CacheService {
  constructor(ttlSeconds = 300) {
    this.cache = new Map();
    this.ttl = ttlSeconds;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttl * 1000
    });
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }
}

// Uso
const studentGrades = await cacheService.getOrSet(
  `notas:${alunoId}`,
  () => Nota.find({ alunoId })
);
```

---

### 3.2 Paginação Inconsistente

**Severidade:** 🟠 ALTA

- Alguns endpoints retornam todos os resultados
- Comunicados, notas, alunos podem retornar 1000+ documentos

**Recomendação:**
```javascript
// middleware/pagination.js
module.exports = (defaultLimit = 20, maxLimit = 100) => {
  return (req, res, next) => {
    let page = Math.max(1, parseInt(req.query.page) || 1);
    let limit = Math.min(
      maxLimit,
      Math.max(1, parseInt(req.query.limit) || defaultLimit)
    );
    req.pagination = { skip: (page - 1) * limit, limit, page };
    next();
  };
};

// Uso em rotas
app.get('/api/comunicados', pagination(20), ComunicadoController.list);

// No controller
const comunicados = await Comunicado.find()
  .skip(req.pagination.skip)
  .limit(req.pagination.limit);
```

---

### 3.3 Índices Faltando ou Não Otimizados

**Severidade:** 🟡 MÉDIA

Não há evidência de índices compostos para queries comuns:
- `Nota.find({ alunoId, periodo })`
- `Comunicado.find({ statusAtivo, dataCriacao })`
- `Falta.find({ professorId, turmaId, data })`

**Recomendação:**
```javascript
// models/Nota.js
notaSchema.index({ alunoId: 1, periodo: 1 });
notaSchema.index({ professorId: 1, dataCriacao: -1 });

// models/Comunicado.js
comunicadoSchema.index({ statusAtivo: 1, dataCriacao: -1 });

// Adicionar ao migration script
db.notas.createIndex({ alunoId: 1, periodo: 1 });
```

---

## 4. Problemas de Qualidade de Código

### 4.1 Falta de Testes Integrados para Fluxos Complexos

**Severidade:** 🟠 ALTA

Há testes em `backend/src/tests/`, mas não cobrem:
- Fluxo completo de autenticação + LGPD + onboarding
- Chatbot com fallback Gemini/banco
- Sincronização Socket.IO em tempo real

**Recomendação:**
```javascript
// backend/src/tests/integration/authOnboarding.test.js
describe('Complete Auth + Onboarding Flow', () => {
  it('should register responsavel and complete LGPD consent', async () => {
    const response = await request(app)
      .post('/api/auth/register-responsavel')
      .send({ email, password, nome });
    expect(response.status).toBe(201);
    
    const userId = response.body.data._id;
    const lgpdResponse = await request(app)
      .post(`/api/usuarios/${userId}/lgpd/consent`)
      .send({ consents: { comunicadosEmail: true } });
    expect(lgpdResponse.status).toBe(200);
  });
});
```

---

### 4.2 Uso de Strings Magic em Enums

**Severidade:** 🟡 MÉDIA

Perfis, status, tipos espalhados em strings:
```javascript
perfil: { type: String, enum: ['admin', 'diretor', 'professor', 'responsavel'] }
```

**Recomendação:**
```javascript
// backend/src/constants/enums.js
exports.USER_ROLES = {
  ADMIN: 'admin',
  DIRETOR: 'diretor',
  PROFESSOR: 'professor',
  RESPONSAVEL: 'responsavel'
};

exports.COMUNICADO_STATUS = {
  ATIVO: 'ativo',
  ARQUIVADO: 'arquivado',
  RASCUNHO: 'rascunho'
};

// Uso
perfil: { type: String, enum: Object.values(USER_ROLES) }
```

---

### 4.3 Falta de DTOs de Validação

**Severidade:** 🟡 MÉDIA

Validações manuais em controllers:
```javascript
if (!email || !password) {
  return res.status(400).json({ error: '...' });
}
```

**Recomendação:**
```javascript
// backend/src/dtos/RegisterResponsavelDTO.js
const Joi = require('joi');

const schema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  nome: Joi.string().min(3).required(),
  telefone: Joi.string().pattern(/^\d{10,11}$/).required(),
  nomeAluno: Joi.string().required(),
  parentesco: Joi.string().valid('pai', 'mãe', 'avó', 'avô', 'tio').required()
});

// Middleware
const validateDTO = (dtoSchema) => {
  return (req, res, next) => {
    const { error, value } = dtoSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    req.validatedBody = value;
    next();
  };
};

// Uso
router.post('/register-responsavel', 
  validateDTO(RegisterResponsavelDTO.schema),
  RegisterController.register
);
```

---

## 5. Problemas Operacionais

### 5.1 Sem Migrações Versionadas

**Severidade:** 🟠 ALTA

Scripts em `backend/scripts/` são one-off e não rastreáveis:
- `migrate_indexeddb_to_mongodb.js`
- `migrate-with-webp.js`
- `migrate_voice_preferences.js`

Sem mecanismo para rollback.

**Recomendação:**
```
backend/migrations/
├── 001_initial_schema.js
├── 002_add_twoFactor.js
├── 003_create_preferencias_collection.js
├── 004_add_indexes.js
└── migrations.json (status de cada migration)

// backend/scripts/migrate.js
const runMigrations = async () => {
  const applied = JSON.parse(fs.readFileSync('migrations.json'));
  const files = fs.readdirSync('migrations').filter(f => f.endsWith('.js'));
  
  for (const file of files) {
    const num = parseInt(file.split('_')[0]);
    if (!applied.includes(num)) {
      console.log(`Applying ${file}...`);
      await require(`../migrations/${file}`)();
      applied.push(num);
    }
  }
  
  fs.writeFileSync('migrations.json', JSON.stringify(applied));
};
```

---

### 5.2 Sem Seed Formalizados

**Severidade:** 🟡 MÉDIA

Dados de dev são criados manualmente ou via `_seedDevData()` no boot (lento).

**Recomendação:**
```javascript
// backend/seeds/dev.js
module.exports = async (db) => {
  const usuarios = [
    {
      email: 'admin@jaguari.local',
      nome: 'Admin Sistema',
      perfil: 'admin',
      senha: await bcrypt.hash('admin123', 12)
    },
    // ... mais dados
  ];

  await db.collection('usuarios').insertMany(usuarios);
  console.log('Dev seed applied');
};

// Rodar manualmente
npm run seed:dev
```

---

### 5.3 Falta de CI/CD Pipeline

**Severidade:** 🔴 CRÍTICA

Sem validação automática no commit:
- Sem lint
- Sem testes automatizados
- Sem build check

**Recomendação:**
Criar `.github/workflows/backend-ci.yml`:
```yaml
name: Backend Tests & Lint
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: cd backend && npm install
      - run: npm run lint
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: cd backend && npm install
      - run: npm test
```

---

## 6. Top 15 Recomendações Prioritárias

### P0 — Implementar Hoje

1. ✅ **Remover banco forçado para "test"** — Respeitar MONGODB_DB_NAME
2. ✅ **Quebrar UserController** — Extrair serviços: Auth, Registration, Password, Email, Preferences, LGPD
3. ✅ **Remover express.static da raiz** — Servir apenas diretório /public explícito
4. ✅ **Habilitar CSRF em staging** — Não apenas em produção

### P1 — Implementar Este Sprint

5. ✅ **Separar Usuario em coleções** — Usuario (auth) + Preferências + LGPD + Onboarding
6. ✅ **Criar camada de UseCases** — Desacoplar lógica de negócio de HTTP
7. ✅ **Implementar paginação** — Limitar payload de comunicados, notas, alunos
8. ✅ **Adicionar índices MongoDB** — Otimizar queries comuns
9. ✅ **Criar DTOs de validação** — Usar Joi ou Zod

### P2 — Próximo Sprint

10. ✅ **CI/CD pipeline** — GitHub Actions com lint + test + build
11. ✅ **Testes integrados** — Fluxos de autenticação, onboarding, chatbot
12. ✅ **Cache de leitura** — Redis ou Node-cache para dashboard/comunicados
13. ✅ **Migrações versionadas** — Sistema formal de migrations com rollback
14. ✅ **Refatorar IAController** — Separar chatbot de analytics
15. ✅ **Documentação de APIs** — Swagger/OpenAPI para cada domínio

---

## 7. Exemplo de Refatoração: UserController → Serviços

### Antes (1370 linhas em um arquivo)
```javascript
// UserController.js
exports.login = async (req, res) => { ... }; // 50 linhas
exports.register = async (req, res) => { ... }; // 80 linhas
exports.forgotPassword = async (req, res) => { ... }; // 40 linhas
exports.updateTTSSettings = async (req, res) => { ... }; // 30 linhas
exports.acceptLGPD = async (req, res) => { ... }; // 60 linhas
// ... 40+ mais métodos
```

### Depois (Serviços especializados)
```
services/
├── AuthenticationService.js (login, logout, validateToken)
├── RegistrationService.js   (register responsavel, docente, firstAccess)
├── PasswordService.js       (forgot, reset, verify code)
├── UserPhotoService.js      (upload, serve)
├── PreferencesService.js    (TTS, accessibility, narration)
└── LGPDService.js           (consent, anonimization)

controllers/
├── AuthController.js        (thin controller that delegates)
├── UserController.js        (preferences, photo)
└── LGPDController.js        (consents)
```

**Benefícios:**
- Cada arquivo < 150 linhas
- Testável isoladamente
- Reutilizável em jobs, CLI, eventos
- Manutenção clara e previsível

---

## 8. Timeline Recomendada

| Semana | P0 | P1 | P2 |
|--------|----|----|-----|
| 1-2 | ✅ Banco, express.static, UserController | | |
| 3-4 | | ✅ UseCases, Paginação, Índices | |
| 5-6 | | ✅ DTOs, Testes integrados | |
| 7+ | | | ✅ Cache, CI/CD, Migrações |

---

## 9. Checklist de Implementação

- [ ] Remover MONGODB_DB_NAME override em db.js
- [ ] Criar serviços para UserController
- [ ] Refatorar express.static para diretório /public
- [ ] Remover CSP 'unsafe-inline' de script-src
- [ ] Ativar CSRF em staging
- [ ] Criar migrations formais
- [ ] Implementar paginação em endpoints de listagem
- [ ] Adicionar índices compostos ao MongoDB
- [ ] Criar DTOs de validação com Joi
- [ ] Setup GitHub Actions CI/CD
- [ ] Quebrar Usuario em múltiplas coleções
- [ ] Criar Use Cases para domínios principais
- [ ] Integrar cache para leitura (dashboard, comunicados)
- [ ] Expandir cobertura de testes (integração)
- [ ] Documentar APIs com Swagger

---

## Conclusão

O backend já entrega valor significativo, mas apresenta sinais claros de crescimento sem consolidação técnica. Os problemas principais são:

1. **Arquiteturais:** Controllers muito grandes, falta de camadas, modelos inchados
2. **Operacionais:** Sem CI/CD, migrações ad-hoc, database hardcoded
3. **Performance:** Sem cache, paginação, índices bem planejados
4. **Segurança:** CSP permissiva, CORS aberto em dev, express.static na raiz

Atacar os P0 primeiro reduzirá risco imediato; implementar P1 melhorará manutenibilidade; P2 preparará para escala.

**Estimativa de esforço:**
- P0: 2-3 dias por dev
- P1: 1-2 sprints
- P2: 2-3 sprints

Após conclusão, o backend estará 10x mais previsível, testável e preparado para crescimento.
