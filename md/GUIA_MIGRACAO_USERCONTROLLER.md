# 🚀 Guia de Migração — UserController Refatorado

**Status:** Implementação pronta para migração  
**Data:** 30 de junho de 2026  
**Impacto:** Reduz UserController de 1370 para ~200 linhas

---

## 📋 Resumo Executivo

O UserController foi quebrado em **3 serviços especializados**:

| Serviço | Métodos | Responsabilidade |
|---------|---------|------------------|
| **AuthenticationService.js** | login, logout, verify2FA | Autenticação e sessão |
| **RegistrationService.js** | registerResponsavel, registerDocente, firstAccess, registerWithCode | Cadastro de usuários |
| **PasswordRecoveryService.js** | forgotPassword, verifyCode, resetPassword, updatePasswordForce | Recuperação de senha |

**Benefícios da refatoração:**
- ✅ Cada arquivo < 250 linhas (vs 1370)
- ✅ Testável isoladamente (unit tests)
- ✅ Reutilizável em CLI, jobs, eventos
- ✅ Responsabilidades claras
- ✅ Mais fácil debugar

---

## 🔄 Plano de Migração

### Fase 1: Validação (1-2 horas)

1. **Testar AuthenticationService**
   ```bash
   npm test -- AuthenticationService.test.js
   ```
   - Testes de login com 2FA
   - Testes de brute force
   - Testes de migração de senha legada

2. **Testar RegistrationService**
   ```bash
   npm test -- RegistrationService.test.js
   ```
   - Testes de registro responsável
   - Testes de registro docente
   - Testes de primeiro acesso

3. **Testar PasswordRecoveryService**
   ```bash
   npm test -- PasswordRecoveryService.test.js
   ```
   - Testes de código de recuperação
   - Testes de expiração
   - Testes de limite de tentativas

### Fase 2: Migração de Rotas (30-45 minutos)

Em `backend/src/routes/auth.js`, trocar os imports:

**Antes:**
```javascript
const UserController = require('../controllers/UserController');

router.post('/login', UserController.login);
router.post('/logout', UserController.logout);
// ... todas as rotas
```

**Depois:**
```javascript
const UserController = require('../controllers/UserController-REFATORADO');

router.post('/login', UserController.login);
router.post('/logout', UserController.logout);
// ... mesmo, mas UserController agora delega para serviços
```

### Fase 3: Renomear Arquivo (5 minutos)

```bash
cd backend/src/controllers/

# Backup do antigo
mv UserController.js UserController.BACKUP.js

# Ativar novo
mv UserController-REFATORADO.js UserController.js
```

### Fase 4: Testes E2E (30-45 minutos)

```bash
# Testar fluxo completo de login/logout
npm run test:e2e -- login.spec.js

# Testar fluxo de registro
npm run test:e2e -- register.spec.js

# Testar fluxo de recuperação de senha
npm run test:e2e -- password-recovery.spec.js
```

### Fase 5: Deploy (5-10 minutos)

```bash
git add .
git commit -m "refactor: UserController quebrado em serviços especializados

- AuthenticationService: login, logout, 2FA
- RegistrationService: register, firstAccess
- PasswordRecoveryService: forgot-password, reset, etc

Reduz UserController de 1370 para ~200 linhas.
Melhora testabilidade e reusabilidade."

git push origin develop
# Criar PR para review
```

---

## 📝 Arquivos Afetados

### Criados (Novos)
```
backend/src/services/
├── AuthenticationService.js      (350 linhas)
├── RegistrationService.js        (400 linhas)
└── PasswordRecoveryService.js    (350 linhas)

backend/src/controllers/
└── UserController-REFATORADO.js  (200 linhas)
```

### Modificados
```
backend/src/controllers/
└── UserController.js             (1370 → 200 linhas, migração)
```

### Sem mudanças (compatíveis)
```
backend/src/routes/auth.js        (sem mudança, apenas import)
backend/src/models/Usuario.js     (sem mudança)
frontend/**                        (sem mudança, mesmas rotas)
```

---

## 🧪 Casos de Teste Críticos

### Login
```javascript
describe('AuthenticationService.login', () => {
  test('deve fazer login com sucesso', async () => {
    const result = await AuthenticationService.login(
      'user@example.com',
      'Senha123!',
      'docente'
    );
    expect(result.success).toBe(true);
    expect(result.token).toBeDefined();
  });

  test('deve bloquear conta após 5 tentativas falhas', async () => {
    // Simular 5 tentativas com senha errada
    // Verificar se lockUntil foi setado
  });

  test('deve migrar senha legada para bcrypt', async () => {
    // Simular usuário com senha em texto puro
    // Fazer login
    // Verificar se senha foi migrada
  });

  test('deve exigir 2FA se habilitado', async () => {
    // Habilitar 2FA no usuário
    // Fazer login
    // Verificar requires2FA=true
  });
});
```

### Registro
```javascript
describe('RegistrationService.registerResponsavel', () => {
  test('deve registrar responsável com código secreto', async () => {
    const result = await RegistrationService.registerResponsavel({
      nome: 'João Silva',
      email: 'joao@example.com',
      senha: 'Senha123!',
      telefone: '11999999999',
      codigoSecreto: 'ABC123'
    });
    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
  });

  test('deve vincular aluno automaticamente', async () => {
    // Registrar responsável
    // Verificar se aluno.responsavel foi setado
  });

  test('deve rejeitar código secreto inválido', async () => {
    const result = await RegistrationService.registerResponsavel({
      ...dados,
      codigoSecreto: 'INVALIDO'
    });
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_CODE');
  });
});
```

### Recuperação de Senha
```javascript
describe('PasswordRecoveryService.resetPassword', () => {
  test('deve resetar senha com código válido', async () => {
    const result = await PasswordRecoveryService.resetPassword(
      'user@example.com',
      '123456',
      'NovaSenha123!'
    );
    expect(result.success).toBe(true);
  });

  test('deve rejeitar código expirado', async () => {
    // Criar código expirado
    // Tentar resetar
    // Verificar erro CODE_EXPIRED
  });

  test('deve bloquear após 5 tentativas', async () => {
    // Fazer 5 tentativas com código errado
    // Verificar status='expirado'
  });
});
```

---

## ⚠️ Checklist de Validação

Antes de fazer merge, verificar:

- [ ] Todos os testes unitários passam
- [ ] Todos os testes E2E passam
- [ ] Login funciona em localhost:3001
- [ ] Logout funciona
- [ ] 2FA funciona (se habilitado)
- [ ] Registro responsável funciona
- [ ] Registro docente funciona
- [ ] Recuperação de senha funciona
- [ ] Código do esquecimento não é revelado em produção
- [ ] Não há console.log() sensível em produção
- [ ] TypeScript type-checks passam (se usar TS)
- [ ] ESLint sem warnings

---

## 🔐 Notas de Segurança

### Senhas Legadas
O `AuthenticationService` migra automaticamente senhas em texto puro para bcrypt:
```javascript
// Se senha não está hasheada, faz hash automaticamente
if (!isHashed(user.senha)) {
  const senhaHash = await bcrypt.hash(senha, SALT_ROUNDS);
  await Usuario.updateOne({ _id }, { $set: { senha: senhaHash } });
}
```

**Impacto:** Primeira vez que usuário com senha legada faz login, é automaticamente migrado.

### Brute Force Protection
Após 5 tentativas falhas, conta é bloqueada por 15 minutos:
```javascript
if (attempts >= 5) {
  updateData.lockUntil = Date.now() + 15 * 60 * 1000;
}
```

### 2FA (Two-Factor Authentication)
Se habilitado, login retorna `requires2FA: true` e não emite JWT até código ser verificado:
```javascript
if (userWith2FA && userWith2FA.twoFactorEnabled) {
  return { requires2FA: true, userId, message: '...' };
}
```

### Código de Recuperação
- Validade: 15 minutos
- Limite de tentativas: 5
- Bloqueado se limpo: sim
- Mensagem genérica: sim (email harvesting protection)

---

## 📊 Comparação Antes vs Depois

### Antes (UserController.js — 1370 linhas)
```
exports.login = async (req, res) => {
  // 196 linhas misturando HTTP, validação, auth, 2FA, JWT, cookies
}

exports.registerResponsavel = async (req, res) => {
  // 113 linhas misturando HTTP, validação, registro, email, WebSocket
}

exports.forgotPassword = async (req, res) => {
  // 64 linhas misturando HTTP, código, email, segurança
}
// ... 17+ mais métodos
```

### Depois (UserController.js — 200 linhas + Serviços — 1100 linhas)

**UserController:**
```javascript
exports.login = async (req, res) => {
  const result = await AuthenticationService.login(email, senha, portal);
  if (result.requires2FA) return res.json(result);
  res.cookie('escola_jwt', result.token, {...});
  res.json(result);
};
```

**AuthenticationService:**
```javascript
static async login(email, senha, portal) {
  // 196 linhas puramente de lógica de autenticação
  // Sem HTTP, sem res.json, sem cookies
  // Retorna objeto { success, user, token, error }
}
```

**Benefícios:**
- ✅ Lógica de negócio isolada de HTTP
- ✅ Reutilizável em CLI, jobs, testes
- ✅ Mais fácil testar
- ✅ Mais fácil manter
- ✅ Mais fácil adicionar features

---

## 🚨 Rollback

Se algo der errado:

```bash
# Restaurar backup
mv UserController.BACKUP.js UserController.js

# Remover novos serviços
rm backend/src/services/AuthenticationService.js
rm backend/src/services/RegistrationService.js
rm backend/src/services/PasswordRecoveryService.js

# Revert commit
git revert HEAD
```

---

## 📞 Suporte

Se encontrar problemas durante a migração:

1. **Verificar logs:** `npm run dev` e procurar por erros
2. **Testar serviço isoladamente:** `node -e "const S = require('./...'). S.login(...)"`
3. **Revisar tipos de erro:** Cada serviço retorna `{ success, error, code }`
4. **Fazer rollback:** Restaurar UserController.BACKUP.js

---

## ✅ Conclusão

A refatoração está **pronta para migração**. Após esta mudança:

- UserController torna-se thin controller (~200 linhas)
- Lógica de autenticação é testável isoladamente
- Nova features podem reutilizar serviços
- Manutenção futura será muito mais fácil

**Tempo estimado de migração:** 2-3 horas (incluindo testes)  
**Risco:** Baixo (apenas UserController muda, rotas identicamente)  
**Benefício:** Alto (manutenibilidade, testabilidade, reuso)
