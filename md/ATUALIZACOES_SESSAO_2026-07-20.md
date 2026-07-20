# Atualizações — Sessão 2026-07-20

Resumo de todas as mudanças feitas nesta sessão, com arquivos afetados, motivo e status.

---

## ✅ Concluído

### 1. Página de turma: navbar mostra o professor da sala
- **Arquivo:** `js/app.js` (`initTurmaPage`, `renderTurmaPage`)
- **O quê:** A navbar do topo passou a exibir o **professor regente da turma** (nome + foto, com fallback para iniciais) em vez do usuário logado ("Admin"). Se a sala não tiver professor, mantém o usuário logado.

### 2. Erro `auth.refreshUser is not a function`
- **Arquivo:** `js/auth-module.js`
- **O quê:** Adicionado o método `refreshUser()` (buscava `/auth/me`, atualiza `sessionStorage` e dispara `auth:updated`). Ele não existia no módulo usado pelo `app.js`, quebrando `updateUserNavbar()`.

### 3. Export DOCX/CSV quebrava com `config.escola.nome`
- **Arquivo:** `js/export.js` (3 pontos)
- **O quê:** Tornado defensivo: `config?.escola?.nome || config?.nomeEscola || 'Sistema Escolar'`.

### 4. Foto de avatar quebrada (dashboard e outras telas)
- **Arquivo:** `js/api-config.js` (`updateAllAvatars`, 2 ramos de `<img>`)
- **O quê:** Adicionado `onerror` que, quando a foto (GridFS) falha, esconde a imagem quebrada e mostra as **iniciais** com o gradiente padrão.

### 5. Voz do tour (onboarding) não tocava
- **Arquivo:** `js/onboarding-tour.js`
- **O quê:** O tour inicia sem gesto do usuário → o navegador bloqueia o autoplay de áudio. Agora, quando `window.speak` é bloqueado, a fala é refeita na **primeira interação** do usuário. Listener é limpo ao fechar o tour.

### 6. Chatbot do responsável sem chips + chips por perfil
- **Arquivos:** `js/chatbot-ia.js`, `html/dashboard.html` (cache-bust `?v=4.1` / tour `?v=2.2`)
- **O quê:** Chips do responsável agora são voltados ao filho ("Notas do meu filho", "Faltas do meu filho", "Resumo do desempenho", "Comunicados recentes", "Grade horária"). Versão dos scripts subida para furar cache antigo.

### 7. #1 — IDs de escola nas contas (multi-tenant)
- **Arquivos:** `backend/src/controllers/UserController.js`, `backend/src/middleware/filtrarPorEscola.js`, `backend/src/controllers/NotificacaoController.js`
- **O quê:**
  - **Responsável** era a única conta sem `escolaId` (era criado sem ele e a notificação usava `'default'` fixo). Agora herda o `escolaId` do **aluno vinculado**, tanto na conta quanto na notificação à direção.
  - Novo helper `escolaMatch(escolaId)` — filtro de leitura **tolerante** que casa a escola ativa **OU** registros legados (sem `escolaId`/`'default'`).
  - `NotificacaoController` (`getAll` e `marcarTodasComoLidas`) passou a usar `escolaMatch`, o que **destrava as notificações do professor** que estavam sumindo por causa do `$and` estrito de `escolaId` (isso também resolve o problema #3).
  - Docente/Diretor/Secretária já gravavam `vinculos` + `escolaId` corretamente (sem alteração).
  - Observação: `RegistrationService.js` é código morto (as rotas usam o `UserController`).

### 8. B/C — Páginas da direção com dados reais escopados por escola
- **Arquivos:** `backend/src/routes/api.js`, `backend/src/routes/dashboard.js`, `backend/src/controllers/DashboardController.js`, `backend/src/controllers/MapaCalorController.js`, `backend/src/services/PedagogicoService.js`, `backend/src/controllers/PedagogicoController.js`
- **O quê:**
  - As rotas `/ia/*` e `/dashboard/chart-data` (e `/charts`) passaram a rodar `filtrarPorEscola` → `req.escolaId` disponível. (`/dashboard/public-summary` continua **pública**.)
  - `DashboardController.getChartData`, `MapaCalorController.gerarMapaCalor` e todo o `PedagogicoService.getGlobalInsights` (+ métodos auxiliares) agora filtram as consultas pela **escola do diretor logado**, via `escolaMatch` (tolerante a legados).
  - Resultado: `bi-pedagogico.html` (mapa de calor, insights globais, KPIs) mostra dados **reais da escola do diretor**. A "tendência" da página já era derivada da média real (não era mock de dados).
- **ia-assistant.html:** a página **já** chama o Gemini real (`/ia/chatbot`, com fallback local). Para funcionar de fato, só falta a **chave do Gemini** configurada no backend (ver Pendente B).

### 9. A — Trocar de escola no perfil (professor/diretor/secretaria)
- **Arquivos:** `backend/src/routes/escolas.js`, `html/perfil.html`, `js/perfil.js`
- **O quê:**
  - Novo endpoint **`POST /api/escolas/mudar`** — valida o **código secreto** da nova escola (mesma prova do cadastro, via `SecurityController.validateCode`), cria/ativa o **vínculo** no documento do cargo (Professor/Diretor/Secretaria), atualiza `Usuario.escolaId` + nome, e ativa a nova escola na **sessão**. (O antigo `/escolas/trocar/:id` só alternava entre escolas já vinculadas.)
  - Nova seção **"Minha Escola"** no perfil: mostra a escola ativa e permite colar o código da nova escola + botão "Trocar de escola". Visível para professor/diretor/secretaria.
- **Nota (responsável/aluno):** o responsável segue a escola do filho (definida na matrícula pela secretaria). Mudança de escola do aluno é uma operação da secretaria sobre o aluno; propagar isso ao responsável em cenário multi-escola fica como follow-up.

---

### 10. D — Boletim do aluno com dados divergentes (corrigido)
- **Arquivos:** `backend/src/controllers/ResponsavelController.js`, `portal-responsavel/src/components/NotesCard.tsx`, `portal-responsavel/src/services/apiService.ts`, `portal-responsavel/src/types/index.ts`, `portal-responsavel/dist/*` (rebuild)
- **Causa raiz:** `GET /api/responsavel/notas/:alunoId` retornava **`0`** para bimestres **sem nota lançada**. No portal, `NotesCard` calculava a média como `soma/4` incluindo esses zeros → a **média caía pela metade** (ex.: 8, 8, vazio, vazio virava 4,0) e as células apareciam como "0,0", como se o aluno tivesse tirado zero.
- **Correção:**
  - Backend passa a retornar **`null`** para bimestre sem nota.
  - `NotesCard`: `calcMedia` considera **apenas** bimestres com nota (ignora `null`); células vazias mostram **"—"**; tipos ajustados (`number | null`).
  - Portal **rebuildado** (`npm run build` → `dist/assets/index-DInmu1nU.js`). ⚠️ Como o Render serve o `dist` commitado (não rebuilda o portal), o `dist` atualizado **precisa ir junto no commit/deploy**.

---

## ⏳ Pendente (planejado, ainda não implementado)

### B. `html/direcao/ia-assistant.html` — chave do Gemini (ops)
- O código já está correto (chama `/ia/chatbot`). Falta apenas **configurar a variável de ambiente** do Gemini no backend/Render: `GEMINI_KEY` (ou `GEMINI_API_KEY`). Sem ela, o assistente cai no fallback local.
- Follow-up opcional: escopar o próprio chatbot por escola (hoje o diretor vê dados de todas as escolas no chat), passando `req.escolaId` ao `ChatbotService.processMessage`.

### D. Boletim do aluno com dados divergentes (#2 original)
- **Causa provável:** o backend `/notas/boletim/:alunoId` usa média aritmética simples por matéria, enquanto o app do professor usa fórmulas próprias ("Sala Principal" sem especiais + "Média Geral"). Alinhar as fórmulas.

---

## Recomendação
Seguir os pendentes **um de cada vez** (A → B → C → D), validando cada um antes do próximo, dado que envolvem UI + backend + escopo por escola.
