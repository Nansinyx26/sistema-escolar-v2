# Relatório de Segurança e Conformidade LGPD - Sistema Escolar v3.1

Este documento apresenta uma análise técnica detalhada das medidas de segurança e privacidade implementadas no sistema de gerenciamento escolar, garantindo a proteção dos dados dos docentes e a conformidade com a Lei Geral de Proteção de Dados (LGPD).

## 1. Pilares de Segurança Cibernética

### 1.1 Autenticação e Gestão de Sessão
- **JWT (JSON Web Tokens):** Implementado para todas as sessões administrativas e de professores. Os tokens possuem tempo de expiração de 8 horas e são validados em cada requisição à API.
- **Cookie HttpOnly:** Token JWT armazenado EXCLUSIVAMENTE em cookie HttpOnly com flags `Secure` e `SameSite=Strict`. O token NÍO é exposto em respostas JSON, prevenindo roubo via XSS.
- **Criptografia de Senhas:** Uso do algoritmo **bcrypt** com **12 salt rounds** (custo computacional elevado). As senhas nunca são armazenadas em texto puro, tornando-as resistentes a ataques de força bruta e dicionário.
- **Migração Automática de Senhas Legadas:** Senhas antigas em texto puro são automaticamente convertidas para hash bcrypt no primeiro login bem-sucedido.
- **Política de Troca Obrigatória:** Contas criadas administrativamente são marcadas com a flag `deveMudarSenha`, forçando o usuário a definir uma credencial privada no primeiro acesso.
- **Força de Senha:** Mínimo de 8 caracteres obrigatório em todos os endpoints de criação e alteração de senha.

### 1.2 Controle de Acesso (RBAC)
- **Hierarquia de Permissões:** O sistema diferencia perfis de `admin`, `diretor` e `professor`.
- **Middleware de Autorização:** Rotas sensíveis (como logs de auditoria e gestão de usuários) são protegidas por verificações de perfil em nível de servidor (backend).
- **Filtro Horizontal:** Professores só acessam dados de suas turmas atribuídas (data-level access control).

### 1.3 Proteção de Infraestrutura
- **CORS e CSP:** Configurações de *Cross-Origin Resource Sharing* e *Content Security Policy* via **Helmet.js** para mitigar ataques como XSS e Clickjacking.
- **CSP Hardened:** `unsafe-eval` removido do CSP. Diretivas `frame-ancestors`, `base-uri` e `form-action` adicionadas para proteção extra.
- **Rate Limiting:** Proteção contra ataques de negação de serviço (DoS) e tentativas excessivas de login (200 req/15min global, 10 req/15min auth).
- **Bloqueio de Conta:** 5 tentativas falhas → bloqueio automático de 15 minutos.

### 1.4 Proteção contra CSRF
- **Double Submit Cookie:** Token CSRF gerado pelo servidor e validado em todas as requisições que mudam estado (POST, PUT, DELETE).
- **Implementação sem dependências externas:** Middleware customizado usando `crypto.randomBytes(32)`.

### 1.5 Proteção contra Injeção
- **Sanitização de Inputs:** Middleware global remove TODAS as tags HTML de inputs via `sanitize-html`.
- **Escape de Regex:** Função `escapeRegex()` aplicada em todos os inputs usados em expressões regulares, prevenindo ataques ReDoS.
- **Whitelist de Campos:** Controllers usam whitelist explícita de campos permitidos em operações de criação e atualização.
- **Mongoose Strict Mode:** Schema com `strict: true` rejeita campos não definidos.

### 1.6 Proteção de Arquivos Estáticos
- **Bloqueio de Arquivos Sensíveis:** Middleware bloqueia acesso a `.env`, `.git`, `node_modules`, `*.md`, `*.py`, `backend/`, `scripts/`.
- **Uploads Seguros:** Filtro MIME (apenas imagens), conversão WebP via `sharp`, armazenamento em GridFS.

---

## 2. Conformidade com a LGPD (Lei 13.709/2018)

### 2.1 Princípios de Privacidade
- **Minimização de Dados:** Coleta estrita de dados necessários (Nome, Email, CPF, Telefone).
- **Finalidade:** Os dados são utilizados exclusivamente para autenticação, recuperação de conta e gestão administrativa escolar.
- **Transparência:** Justificativa clara na interface sobre o uso de campos como CPF e Telefone.

### 2.2 Accountability (Responsabilização)
- **Logs de Auditoria:** Registro detalhado de todas as operações de escrita no banco de dados.
  - **Quem:** E-mail do usuário autenticado.
  - **O que:** Ação realizada (ex: `UPDATE_USER`, `DELETE_USER`, `AUTO_MIGRATE_PASSWORD`).
  - **Quando:** Timestamp preciso.
  - **Contexto:** Metadados sobre a alteração (valor anterior vs. novo valor).

### 2.3 Segurança por Design (Privacy by Design)
- **Código Secreto da Escola:** Validação de segundo fator para novos cadastros, garantindo que o usuário possua vínculo legítimo com a instituição.
- **Ocultação de Dados:** Uso de campos de senha e códigos com opção de visibilidade ("olhinho"), protegendo a visualização por terceiros no ambiente físico.
- **Anonimização LGPD:** Endpoint dedicado para anonimizar dados de usuários conforme solicitação.

---

## 3. Matriz de Proteção Contra Ataques

| # | Vetor de Ataque | Status | Nota |
|---|----------------|--------|------|
| 1 | SQL Injection | N/A (MongoDB) + Escape Regex | 🟢 A |
| 2 | XSS (Armazenado/Refletido) | Sanitize-html + HttpOnly + CSP | 🟢 B+ |
| 3 | CSRF | Double Submit Cookie implementado | 🟢 A |
| 4 | Remote File Inclusion | Sem includes dinâmicos | 🟢 A |
| 5 | Directory Traversal | GridFS + bloqueio de arquivos sensíveis | 🟢 A |
| 6 | Clickjacking | Helmet + frame-ancestors: none | 🟢 A |
| 7 | Session Hijacking | Cookie HttpOnly exclusivo | 🟢 A- |
| 8 | Buffer Overflow | V8 + limites de body | 🟢 A |
| 9 | DOM-based XSS | CSP + Sanitização servidor | 🟡 B |
| 10 | SSRF | Superfície mínima | 🟢 B+ |
| 11 | Phishing | Código escola + token 15min | 🟡 B |
| 12 | Malware (uploads) | MIME + sharp + GridFS | 🟢 A |
| 13 | DDoS | Rate limiting + account lockout | 🟡 B |
| 14 | Man-in-the-Middle | HTTPS + HSTS | 🟢 A |

**Nota Geral Pós-Correção: 8.5 / 10**

---

## 4. Recomendações e Melhorias Futuras

| Categoria | Recomendação | Impacto |
| :--- | :--- | :--- |
| **Jurídico** | Inclusão de Checkbox de Consentimento no registro. | Alto (Compliance Legal) |
| **Técnico** | Integração de Cloudflare como WAF/CDN. | Crítico (DDoS) |
| **Técnico** | Adição de DOMPurify no frontend para innerHTML. | Alto (XSS) |
| **Técnico** | Migração de onclick inline para addEventListener. | Médio (CSP) |
| **Dados** | Rotina de anonimização automática para usuários inativos. | Médio (Privacidade) |
| **Segurança** | Implementação de Autenticação de Dois Fatores (2FA) via E-mail/SMS. | Alto (Proteção de Identidade) |

---

## 5. Histórico de Alterações

| Data | Versão | Alteração |
|------|--------|-----------|
| 08/05/2026 | 3.0 | Análise inicial |
| 11/05/2026 | 3.1 | Correção de 10+ vulnerabilidades: CSRF implementado, JWT removido de JSON, senhas legadas migradas, regex escapado, CSP hardened, arquivos sensíveis bloqueados, whitelist em updates, JWT_SECRET rotacionado |

---
**Data da Análise:** 11 de Maio de 2026  
**Status do Sistema:** SEGURO / EM CONFORMIDADE TÉCNICA (v3.1)
