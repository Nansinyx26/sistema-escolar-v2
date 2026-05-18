# 🔒 Política de Segurança — Sistema Escolar v3.1

**Versão:** 3.1  
**Data:** 11 de Maio de 2026  
**Classificação:** Documento Interno — Uso Restrito

---

## 1. Introdução e Escopo

Este documento estabelece as políticas, padrões e procedimentos de segurança do Sistema Escolar v3.1. Abrange todas as camadas da aplicação: frontend, backend (API), banco de dados, infraestrutura de deploy e processos operacionais.

**Objetivo:** Proteger a confidencialidade, integridade e disponibilidade dos dados de alunos, professores e administradores conforme a LGPD (Lei 13.709/2018) e boas práticas de segurança da informação.

---

## 2. Política de Autenticação

### 2.1 Senhas

| Regra | Requisito |
|-------|-----------|
| **Comprimento mínimo** | 8 caracteres |
| **Armazenamento** | Bcrypt com 12 salt rounds |
| **Texto puro** | PROIBIDO — senhas legadas são migradas automaticamente para bcrypt no primeiro login |
| **Primeiro acesso** | Contas criadas por admin exigem troca de senha obrigatória (`deveMudarSenha: true`) |
| **Recuperação** | Via token UUID v4 com expiração de 15 minutos, enviado por e-mail |

### 2.2 Sessões e Tokens

| Aspecto | Implementação |
|---------|--------------|
| **Protocolo** | JWT (JSON Web Tokens) |
| **Armazenamento** | Cookie HttpOnly exclusivamente — token NÍO é exposto no corpo de respostas JSON |
| **Expiração** | 8 horas |
| **Cookie Flags** | `HttpOnly`, `Secure` (produção), `SameSite=Strict` |
| **Dados no token** | ID, perfil, email, nome, flag deveMudarSenha |

### 2.3 Bloqueio de Conta

- Após **5 tentativas de login falhas**, a conta é bloqueada por **15 minutos**
- Cada tentativa falha é registrada nos logs de auditoria
- O rate limiter da API limita **10 requisições por 15 minutos** em rotas de autenticação

### 2.4 Código Secreto da Escola

- Código de 6 caracteres hexadecimais gerado com `crypto.randomBytes(3)`
- Rotação automática diária (meia-noite)
- Rotação manual disponível para admins
- Histórico de códigos mantido para auditoria

---

## 3. Política de Autorização (RBAC)

### 3.1 Perfis e Permissões

| Recurso | Admin | Diretor | Professor |
|---------|-------|---------|-----------|
| Gerenciar usuários | ✅ | 👁️ Listar | ❌ |
| Gerenciar professores | ✅ | ✅ | ❌ |
| Gerenciar alunos | ✅ | ✅ | ✅ (suas turmas) |
| Gerenciar turmas | ✅ | ✅ | ❌ |
| Logs de auditoria | ✅ | ❌ | ❌ |
| Código secreto | ✅ Rotação | 👁️ Visualizar | ❌ |
| Grade horária | ✅ | ✅ | 👁️ Consultar |
| Deletar registros | ✅ | ❌ | ❌ |

### 3.2 Filtro Horizontal (Data-level Access Control)

- Professores só acessam dados de **suas turmas atribuídas**
- O middleware `horizontalFilter` injeta filtros automaticamente baseado no cadastro do professor
- Admins e Diretores têm acesso total

---

## 4. Política de Proteção de Dados (LGPD)

### 4.1 Princípios

| Princípio | Implementação |
|-----------|--------------|
| **Minimização** | Coleta estrita: Nome, Email, CPF, Telefone |
| **Finalidade** | Dados usados exclusivamente para autenticação, recuperação de conta e gestão escolar |
| **Transparência** | Justificativa clara na interface sobre uso de CPF e Telefone |
| **Accountability** | Logs de auditoria com quem, o que, quando e contexto |

### 4.2 Anonimização

- Endpoint dedicado `/api/usuarios/:id/anonymize` para anonimização LGPD
- Substitui dados pessoais por placeholders (`Usuário Anonimizado`, email anon, CPF zerado)
- Mantém registro para integridade referencial
- Operação registrada nos logs de auditoria

### 4.3 Retenção de Dados

- Logs de auditoria: Retenção mínima de 1 ano
- Dados de usuários inativos: Recomendada anonimização após 12 meses de inatividade
- Backups: Criptografados e com acesso restrito

---

## 5. Política de Segurança de Comunicação

### 5.1 HTTPS

| Ambiente | Protocolo |
|----------|-----------|
| Produção (Render) | HTTPS obrigatório — redirecionamento automático de HTTP |
| Desenvolvimento | HTTP permitido (localhost) |

### 5.2 CORS (Cross-Origin Resource Sharing)

- **Produção:** Apenas origens permitidas (lista explícita + `*.onrender.com`)
- **Desenvolvimento:** Todas as origens permitidas
- Credenciais habilitadas (`credentials: true`)
- Headers permitidos: `Content-Type`, `Authorization`, `X-CSRF-Token`, `X-API-Key`

### 5.3 Headers de Segurança (Helmet.js)

| Header | Valor | Propósito |
|--------|-------|-----------|
| `Content-Security-Policy` | Configurado (ver seção 6) | Previne XSS |
| `X-Frame-Options` | `DENY` | Previne Clickjacking |
| `X-Content-Type-Options` | `nosniff` | Previne MIME sniffing |
| `Strict-Transport-Security` | Ativo | Força HTTPS |
| `X-DNS-Prefetch-Control` | `off` | Previne DNS leak |
| `Referrer-Policy` | `no-referrer` | Protege privacidade |

---

## 6. Política de Proteção contra Ataques

### 6.1 Cross-Site Scripting (XSS)

| Camada | Proteção |
|--------|----------|
| **Servidor** | Sanitização global de inputs via `sanitize-html` (remove TODAS as tags HTML) |
| **Headers** | Content-Security-Policy com restrições de script-src |
| **Cookie** | JWT em cookie HttpOnly (inacessível a JavaScript) |
| **CSP** | `unsafe-eval` REMOVIDO — apenas `unsafe-inline` mantido para compatibilidade com onclick do frontend |

### 6.2 Cross-Site Request Forgery (CSRF)

| Aspecto | Implementação |
|---------|--------------|
| **Padrão** | Double Submit Cookie |
| **Cookie** | `csrf_token` (não-HttpOnly, SameSite=Strict) |
| **Header** | `X-CSRF-Token` obrigatório em POST/PUT/DELETE |
| **Validação** | Servidor compara cookie vs header |
| **Isenções** | Rotas públicas (login, register, forgot-password) |

### 6.3 Injeção (SQL/NoSQL/ReDoS)

| Tipo | Proteção |
|------|----------|
| **SQL Injection** | N/A — sistema usa MongoDB |
| **NoSQL Injection** | Mongoose `strict: true` + sanitização de inputs |
| **ReDoS** | Função `escapeRegex()` aplicada em todos os inputs usados em RegExp/`$regex` |
| **Parameter Injection** | Whitelist de campos em controllers (Create e Update) |

### 6.4 Negação de Serviço (DoS/DDoS)

| Proteção | Configuração |
|----------|-------------|
| **Rate Limit Global** | 200 requisições / 15 min por IP |
| **Rate Limit Auth** | 10 requisições / 15 min por IP |
| **Body Size** | 1MB (JSON) / 10MB (uploads de foto) |
| **Account Lockout** | 5 tentativas falhas → 15 min bloqueio |

### 6.5 Upload de Arquivos

| Proteção | Implementação |
|----------|--------------|
| **Filtro MIME** | Apenas `image/*` |
| **Processamento** | Conversão para WebP via `sharp` |
| **Armazenamento** | MongoDB GridFS (não grava no filesystem) |
| **Limite** | 10MB por arquivo, 1 arquivo por vez |
| **Naming** | Nomes aleatórios via `crypto.randomBytes(16)` |

### 6.6 Exposição de Arquivos

| Regra | Implementação |
|-------|--------------|
| **Arquivos bloqueados** | `.env`, `.git`, `node_modules`, `*.md`, `*.py`, `*.yml`, `backend/`, `scripts/` |
| **Middleware** | Filtro de padrões antes do `express.static()` |
| **Static serve** | Apenas extensões de frontend (.html, .css, .js, imagens) |

---

## 7. Política de Auditoria e Logging

### 7.1 Eventos Auditados

| Evento | Dados Registrados |
|--------|-------------------|
| `CREATE_USER` | Email, perfil, criado por quem |
| `UPDATE_USER` | Campos alterados (antes/depois) |
| `DELETE_USER` | Email do deletado |
| `ANONYMIZE_USER` | Email original |
| `LOGIN_FAILED` | Email tentado |
| `FIRST_ACCESS_ACTIVATE` | Nome do professor |
| `REGISTER_WITH_CODE` | Email do novo usuário |
| `ROTATE_SECRET_CODE` | Autor da rotação |
| `RESET_PASSWORD_SUCCESS` | Email do usuário |
| `FORCE_CHANGE_PASSWORD` | Email do usuário |
| `AUTO_MIGRATE_PASSWORD` | Email do usuário (migração bcrypt) |

### 7.2 Formato do Log

```json
{
    "usuarioEmail": "admin@escola.com",
    "acao": "UPDATE_USER",
    "colecao": "Usuarios",
    "recursoId": "abc123",
    "valorAnterior": { "perfil": "professor" },
    "valorNovo": { "perfil": "diretor" },
    "descricao": "Perfil atualizado",
    "data": "2026-05-11T13:00:00Z"
}
```

### 7.3 Acesso aos Logs

- Apenas perfil **admin** pode visualizar logs de auditoria
- Busca limitada a 200 registros por consulta
- Logs não podem ser deletados ou editados

---

## 8. Política de Variáveis de Ambiente

### 8.1 Variáveis Obrigatórias (Produção)

| Variável | Descrição | Requisito |
|----------|-----------|-----------|
| `JWT_SECRET` | Chave de assinatura JWT | Mínimo 256 bits (64 chars hex) |
| `MONGODB_URI` | Connection string Atlas | Protegida no painel do Render |
| `NODE_ENV` | Ambiente | `production` |
| `FRONTEND_URL` | URL do frontend | URL exata do deploy |

### 8.2 Regras

- **NUNCA** commitar `.env` no repositório Git
- `.env` deve estar no `.gitignore`
- Em produção, variáveis são definidas no painel do Render (sync: false)
- O servidor **RECUSA INICIAR** em produção se `JWT_SECRET` não estiver definido:
  ```javascript
  if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
      throw new Error('CRITICAL: JWT_SECRET não definido.');
  }
  ```

---

## 9. Política de Desenvolvimento Seguro

### 9.1 Checklist de Segurança para Novos Endpoints

- [ ] Rota protegida por `authJWT` middleware?
- [ ] Autorização verificada por `authorize()` com perfis corretos?
- [ ] Inputs sanitizados (via middleware global)?
- [ ] Campos filtrados por whitelist antes de salvar no banco?
- [ ] User input em RegExp está escapado com `escapeRegex()`?
- [ ] Operação registrada nos logs de auditoria?
- [ ] Rate limiting adequado?
- [ ] Dados sensíveis NÍO expostos na resposta?

### 9.2 Proibições

| Prática | Status |
|---------|--------|
| Senhas em texto puro no banco | ❌ PROIBIDO |
| Token JWT no corpo de respostas JSON | ❌ PROIBIDO |
| User input direto em `new RegExp()` | ❌ PROIBIDO |
| `req.body` direto em `findOneAndUpdate()` | ❌ PROIBIDO |
| `eval()` ou `Function()` com input do usuário | ❌ PROIBIDO |
| `innerHTML` com dados não sanitizados | ❌ PROIBIDO |
| Commit de `.env` no Git | ❌ PROIBIDO |

---

## 10. Plano de Resposta a Incidentes

### 10.1 Classificação

| Severidade | Exemplo | Tempo de Resposta |
|------------|---------|-------------------|
| **Crítica** | Vazamento de credenciais, acesso não autorizado ao banco | Imediato (< 1h) |
| **Alta** | XSS explorado, conta admin comprometida | Até 4h |
| **Média** | Tentativas de brute force, rate limit estourado | Até 24h |
| **Baixa** | Scan de vulnerabilidades, erro de configuração | Até 72h |

### 10.2 Procedimentos

1. **Detecção:** Monitorar logs de auditoria e rate limiting
2. **Contenção:** Bloquear IP/conta, revogar tokens (trocar JWT_SECRET)
3. **Erradicação:** Corrigir vulnerabilidade, atualizar dependências
4. **Recuperação:** Restaurar dados de backup se necessário
5. **Pós-incidente:** Documentar lições aprendidas, atualizar políticas

---

## 11. Melhorias Futuras Recomendadas

| Prioridade | Melhoria | Impacto |
|------------|----------|---------|
| Alta | Integrar **Cloudflare** como WAF/CDN | Proteção DDoS |
| Alta | Implementar **2FA** para contas admin | Segurança de identidade |
| Média | Adicionar **DOMPurify** no frontend | Proteção XSS no cliente |
| Média | Migrar `onclick` inline para `addEventListener` | Permitir remover `unsafe-inline` do CSP |
| Média | **Verificação de email** no cadastro | Anti-impersonação |
| Baixa | Implementar **HSTS Preload** | HTTPS máximo |
| Baixa | Rotação automática de **JWT_SECRET** | Defense in depth |

---

**Documento aprovado em:** 11 de Maio de 2026  
**Próxima revisão:** 11 de Agosto de 2026 (trimestral)
