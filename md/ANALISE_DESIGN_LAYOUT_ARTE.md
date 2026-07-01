# 🎨 Análise de Layout e Arte das Páginas — Sistema Escolar v2

**Data:** 30 de junho de 2026
**Tipo:** Auditoria visual / design (read-only — nenhum CSS ou HTML foi alterado)
**Escopo:** Landing, login, dashboard, cadastros, direção, admin, detalhes, gráficos e Portal do Responsável (React)
**Base de evidência:** leitura direta do código-fonte (`arquivo:linha`)

---

## 1. Resumo Executivo

O Sistema Escolar v2 tem uma base de design moderna e ambiciosa — tema escuro, paleta *mint/emerald* com *sky blue*, glassmorphism, tipografia Inter e animações cuidadas. O problema **não é falta de identidade visual, é o excesso de identidades visuais convivendo ao mesmo tempo**, sem uma fonte única de verdade aplicada de forma consistente.

Na prática, o site se comporta como **quatro produtos com aparências diferentes** colados sob o mesmo teto:

1. **Geração "nova"** (verde/sky + Inter) — `css/variables.css` + `css/base.css`
2. **Geração "antiga"** (roxo + Inter) — `css/main.css` + `css/components.css`
3. **Páginas `html/pages/*`** (Outfit + Plus Jakarta Sans)
4. **Portal do Responsável** (cyan/roxo + Poppins) — React isolado

### Top 5 problemas mais graves

| # | Problema | Impacto visual | Evidência |
|---|----------|----------------|-----------|
| 1 | **Dupla identidade de cor de marca** (roxo vs verde) | Páginas mudam de cor primária de uma tela para outra | `css/main.css:8` vs `css/variables.css:23` |
| 2 | **Texto de corpo renderizado em verde vibrante** | Parágrafos verdes sobre fundo quase preto; jerarquia e leitura prejudicadas | `css/base.css:76` + `css/variables.css:14` |
| 3 | **4 gerações tipográficas** misturadas | Tipografia incoerente entre seções do mesmo sistema | Seção 4 (RF-3) |
| 4 | **Banner "Sistema em desenvolvimento"** na 1ª tela | Passa amadorismo na tela de login | `css/base.css:698` + `html/login.html:64` |
| 5 | **Outline de foco removido globalmente** | Acessibilidade de teclado quebrada em todo o app | `css/base.css:127` e `:169` |

> **Conclusão executiva:** o trabalho prioritário não é "criar mais arte" e sim **consolidar a arte existente** em um único sistema de design coeso. A maior parte do esforço é de *unificação e limpeza*, não de redesign.

---

## 2. Sistema de Design Atual

### 2.1 Fonte de verdade dos tokens — `css/variables.css`

A geração nova define os tokens em `:root` (tema escuro como padrão):

#### Cores

| Token | Valor | Papel |
|-------|-------|-------|
| `--bg-primary` | `#09090b` | Fundo da página (quase preto / zinc) |
| `--bg-secondary` | `#0f0f12` | Superfície levemente mais clara |
| `--bg-tertiary` | `#18181b` | Fundo de cards |
| `--bg-elevated` | `#27272a` | Superfícies elevadas, dropdowns |
| `--text-primary` | `#fafafa` | Texto principal |
| `--text-secondary` | `#10b981` | "Texto secundário" — **na verdade verde** ⚠️ |
| `--text-tertiary` | `#a1a1aa` | Texto suave/atenuado |
| `--primary` | `#10b981` | Marca (Emerald/Mint) |
| `--primary-hover` | `#34d399` | Estado hover |
| `--secondary` | `#0ea5e9` | Sky Blue |
| `--warning` | `#f59e0b` | Âmbar |
| `--error` | `#ef4444` | Vermelho |
| `--success` | `#10b981` | Igual ao `--primary` (verde) |

Gradientes: `--gradient-primary` (mint → sky), `--gradient-accent` (`#8b5cf6` → `#6366f1`), `--vibrant-gradient` (roxo → rosa). Já aqui há **roxo/rosa dentro do sistema "verde"**, o que ajuda a explicar a confusão de marca.

#### Tipografia
- `--font-primary: 'Inter', system-ui, -apple-system, sans-serif`
- Escala: `xs 0.75rem` → `4xl 2.75rem` (8 níveis)
- Pesos: 400 / 500 / 600 / 700 / 900

#### Espaçamento e raios
- Espaçamento: `xs 0.25rem` → `2xl 3.5rem`
- Raios: `sm 0.375rem` → `2xl 1.5rem`, `full 9999px`

#### Sombras e movimento
- Sombras de `sm` a `2xl` + `--shadow-glow` (brilho verde)
- Easing único: `cubic-bezier(0.4, 0, 0.2, 1)` em 150ms / 250ms / 400ms

#### Glassmorphism (tokens)
- `--glass-bg: rgba(255,255,255,0.04)`, `--glass-border`, `--glass-blur: 25px`
- Utilitários `.glass` (blur 10px) e `.glass-strong` (blur 20px) em `css/variables.css:170-182`

### 2.2 Reset global — `css/base.css`
- Importa `variables.css` (`@import` no topo) — logo, **as páginas precisam carregar `variables.css` antes de `base.css`**.
- `html { color-scheme: dark; }` — esquema escuro fixo.
- `body { background: var(--bg-primary); color: var(--text-primary); }`
- ⚠️ `p { color: var(--text-secondary); }` (`base.css:76`) → **parágrafos em verde**.
- ⚠️ `outline: none` em foco (`base.css:127` e `:169`) **sem indicador de foco substituto**.
- `.dev-notice` definido em `base.css:698`.

### 2.3 Tema claro
`css/variables.css:144` define `[data-theme="light"]` com fundos brancos/cinza e texto escuro. Porém, só funciona em páginas que aplicam `data-theme` no `<html>` — o que **não acontece em ~17 páginas** (ver Seção 4, RF-9).

---

## 3. Inventário Página por Página

Legenda de fontes: **Inter** = Google Fonts Inter · **I+J** = Instrument Serif + JetBrains Mono · **O+J** = Outfit + Plus Jakarta Sans · **Poppins** = portal React · **BI** = Bootstrap Icons (CDN) · **BI-local** = Bootstrap Icons local (`js/libs/`) · **Tabler** = Tabler Icons.

### 3.1 Raiz e páginas principais (`/html`)

| Página | Propósito | Fontes | Ícones | `data-theme` | Observações |
|--------|-----------|--------|--------|:---:|-------------|
| `index.html` | Landing pública | Inter + I+J | BI | ❌ | Splash screen, nav, switcher de escolas |
| `html/login.html` | Autenticação | Inter | BI | ✅ | **Mostra banner "em desenvolvimento"** |
| `html/dashboard.html` | Hub principal pós-login | Inter + I+J | BI-local | ✅ | Carrega **17 folhas CSS** + **115 estilos inline** |
| `html/escolher-perfil.html` | Seleção de perfil | Inter | BI | ✅ | parallax-glass + neo-brutal |
| `html/perfil.html` | Perfil do usuário | Inter | BI | ✅ | Mistura dashboard + cadastro CSS |
| `html/meus-dados.html` | Dados pessoais | Inter | BI | ✅ | Só tailwind-built + globais |
| `html/meu-horario.html` | Horário do docente | Inter | BI | ✅ | Só tailwind-built + globais |
| `html/primeiro-acesso.html` | Primeiro acesso | Inter | BI | ✅ | — |
| `html/mudar-senha.html` | Troca de senha obrigatória | Inter | BI | ✅ | — |
| `html/reset-password.html` | Redefinir senha | Inter | BI | ✅ | login-new + parallax-glass |
| `html/cadastro-aluno.html` | Cadastro de aluno | Inter | BI | ✅ | 35 estilos inline |
| `html/cadastro-professor.html` | Cadastro de professor | Inter | BI | ✅ | — |
| `html/cadastro-diretor.html` | Cadastro de diretor | Inter | BI | ✅ | — |
| `html/turma.html` | Detalhe de turma | Inter | BI | ❌ | **Usa `main.css` (roxo)** |
| `html/selecionar.html` | Seleção de turma | Inter | BI | ❌ | **Usa `main.css` (roxo)** |
| `html/frequencia-professores.html` | Frequência/lançamentos | Inter | BI | ✅ | — |
| `html/lista-professores.html` | Lista de professores | Inter | BI | ❌ | — |
| `html/gerenciar-salas.html` | Gerenciar salas | Inter | BI | ✅ | **Banner "em desenvolvimento"** |
| `html/grade-horaria-admin.html` | Grade horária (admin) | — (sem Google Font) | BI | ✅ | **Sem fonte carregada** |
| `html/ata.html` | ATA do conselho | Inter | BI | ❌ | **Usa `main.css` (roxo)** |
| `html/diagnostico-audio.html` | Diagnóstico de áudio | — | BI | ✅ | Sem fonte; só dashboard CSS |
| `html/politica-privacidade.html` | Política de privacidade (LGPD) | Inter | BI | ✅ | — |

### 3.2 Admin (`/html/admin`)

| Página | Propósito | Fontes | Ícones | `data-theme` | Observações |
|--------|-----------|--------|--------|:---:|-------------|
| `html/admin/auditoria.html` | Log de auditoria | — | BI | ✅ | Sem fonte |
| `html/admin/configuracoes.html` | Configurações globais | — | BI | ✅ | Sem fonte |
| `html/admin/usuarios.html` | Gerenciar usuários | — | BI | ✅ | 36 estilos inline |
| `html/admin/diagnostico.html` | Diagnóstico do sistema | — | **Tabler `@latest`** | ❌ | **Outlier: zero CSS local** |

### 3.3 Direção (`/html/direcao` e `/direcao`)

| Página | Propósito | Fontes | Ícones | `data-theme` | Observações |
|--------|-----------|--------|--------|:---:|-------------|
| `html/direcao/index.html` | Painel de direção | Inter | BI-local | ❌ | **Usa `main.css` (roxo)** + feed legacy |
| `html/direcao/bi-pedagogico.html` | BI Pedagógico | — | BI-local | ❌ | `glass-premium` + dashboard-premium |
| `html/direcao/ia-assistant.html` | Assistente de voz IA | Inter (via `@import` inline) | BI-local | ❌ | **Sem `<link>` de CSS; estilo inline** |
| `direcao/horario-jaguari.html` | Horários CIEP Jaguari | Inter | BI | ❌ | **Usa `main.css` (roxo)** |
| `direcao/codigos-secretos.html` | Códigos secretos de alunos | Inter | BI | ❌ | **Usa `main.css` (roxo)** |
| `direcao/direcao-notificacoes.html` | Mural escolar | — | BI-local | ✅ | Sem fonte |
| `direcao/auditoria.html` | Auditoria (alternativa) | — | BI | ❌ | Só dashboard + glass-premium |

### 3.4 Detalhes, Gráficos e Páginas "Novas"

| Página | Propósito | Fontes | Ícones | `data-theme` | Observações |
|--------|-----------|--------|--------|:---:|-------------|
| `detalhes/alunos.html` | Detalhe de alunos | Inter | BI | ❌ | **Usa `main.css` (roxo)** |
| `detalhes/avaliacoes.html` | Detalhe de avaliações | Inter | BI | ❌ | **Usa `main.css` (roxo)** |
| `detalhes/turmas.html` | Detalhe de turmas | Inter | BI | ❌ | **Usa `main.css` (roxo)** |
| `graficos/index.html` | Gráficos/analytics | Inter | BI | ❌ | **Usa `main.css` (roxo)** |
| `html/pages/cadastro-docente.html` | Cadastro docente (novo) | **Outfit + Jakarta** | BI | ✅ | **3ª geração tipográfica** |
| `html/pages/cadastro-responsavel.html` | Cadastro responsável (novo) | **Outfit + Jakarta** | BI | ✅ | **3ª geração tipográfica** |
| `html/pages/primeiro-acesso.html` | Primeiro acesso (novo) | **Outfit + Jakarta** | BI | ✅ | **3ª geração tipográfica** |

### 3.5 Portal do Responsável (React / Vite / TS)

| Item | Observação |
|------|-----------|
| Entrada | `portal-responsavel/index.html` — fontes **Inter + Poppins**, ícones **Tabler `@3.30.0`** |
| Páginas | `src/pages/PortalResponsavel.tsx`, `src/pages/BI.tsx` |
| Componentes | Header, AnnouncementFeed/Card, NotificationsPanel/Modal, FichaAluno, FrequencyCard, NotesCard, ChatbotIA, VoiceOrb, ProfileSidebar, LgpdConsentWidget, PortalTabs, Modal, etc. |
| Tokens | `src/styles/_variables.scss` — **sistema de design paralelo** (cyan/roxo, Poppins) |

---

## 4. Diagnóstico de Problemas (Priorizado)

### 🔴 P0 — Quebram a coerência visual e a acessibilidade

#### RF-1 · Dupla identidade de cor de marca (roxo × verde)
- **Evidência:** `css/main.css:8` → `--primary: #7c3aed;` (roxo) · `css/variables.css:23` → `--primary: #10b981;` (verde).
- **Impacto:** 11 páginas usam `main.css` (turma, selecionar, ata, detalhes/*, graficos, codigos-secretos, horario-jaguari, html/direcao/index, limpar-dados). Nelas a cor primária é **roxa**; no restante do app é **verde**. O usuário percebe um sistema "com duas personalidades".

#### RF-2 · Texto de corpo renderizado em verde
- **Evidência:** `css/base.css:76` → `p { color: var(--text-secondary); }` e `css/variables.css:14` → `--text-secondary: #10b981;` (verde).
- **Impacto:** todo `<p>` aparece em verde vibrante sobre `#09090b`. Contraste passa AA, mas: (a) destrói a hierarquia (texto comum compete com elementos de ação), (b) "texto secundário" e "cor de sucesso/marca" são o mesmo valor, confundindo semântica.

#### RF-3 · Quatro gerações tipográficas
- **Evidência:** Inter (maioria) · Instrument Serif + JetBrains Mono (`index.html`, `html/dashboard.html`) · Outfit + Plus Jakarta Sans (`html/pages/*`) · Poppins (`portal-responsavel/index.html`, `_variables.scss:36`). Várias páginas admin **sem fonte alguma** (caem em fonte padrão do navegador).
- **Impacto:** tipografia incoerente entre seções; `html/pages/*` parece de outro produto.

#### RF-4 · Outline de foco removido globalmente sem substituto
- **Evidência:** `css/base.css:127` e `:169` → `outline: none;` em `:focus`.
- **Impacto:** navegação por teclado perde o indicador de foco em todas as páginas que carregam `base.css`. Falha de acessibilidade (WCAG 2.4.7).

### 🟠 P1 — Inconsistências e ruídos visuais relevantes

#### RF-5 · Banner "Sistema em desenvolvimento" em produção
- **Evidência:** `css/base.css:698` (`.dev-notice`, barra âmbar sticky) renderizada em `html/login.html:64` e `html/gerenciar-salas.html`.
- **Impacto:** aparece na **primeira tela** (login). Passa imagem de instabilidade ao usuário final.

#### RF-6 · Três implementações concorrentes de glassmorphism
- **Evidência:** `css/parallax-glass.css` (`.glass-card`, blur 16px) · `css/glass-premium.css` (redefine `.glass-card` + próprio `:root`) · `css/variables.css:170-182` (`.glass` blur 10px, `.glass-strong` blur 20px).
- **Impacto:** páginas que carregam mais de uma têm conflito de cascade em `.glass-card` (blur/raio/cor diferentes dependendo da ordem de import).

#### RF-7 · Tailwind sobreposto ao CSS manual
- **Evidência:** `css/tailwind-built.css` carregado em quase todas as páginas junto com `base.css`/`components-new.css`.
- **Impacto:** utilitários do Tailwind (`.container`, `.flex`, `.rounded-lg`, `.text-sm`) duplicam/conflitam com classes próprias; aumenta peso e imprevisibilidade do layout.

#### RF-8 · `data-theme` aplicado de forma inconsistente
- **Evidência:** ~17 páginas **sem** `data-theme` no `<html>` (todas em `/detalhes`, `/direcao` legacy, `graficos`, `ata`, `selecionar`, `turma`, `lista-professores`, `html/direcao/*`, `html/admin/diagnostico`, `html/utils/*`, `index.html`).
- **Impacto:** o tema claro (`[data-theme="light"]`) não funciona nessas páginas; alternância de tema fica parcial/quebrada.

#### RF-9 · Estilos inline massivos (bypass do design system)
- **Evidência:** `html/dashboard.html` → **115** ocorrências de `style=`; também presentes em `cadastro-aluno.html` (~35), `admin/usuarios.html` (~36), `direcao/horario-jaguari.html`.
- **Impacto:** estilos inline não respeitam tokens nem `data-theme`; tornam o theming não confiável e a manutenção difícil.

#### RF-10 · Portal do Responsável com design isolado
- **Evidência:** `portal-responsavel/src/styles/_variables.scss:18-19` → `$accent-cyan: #00d4ff`, `$accent-purple: #7c3aed`; `:36` → `$font-display: 'Poppins'`; raios `6/12/16/24px` (`:39-42`).
- **Impacto:** o portal usa cyan/roxo + Poppins, divergindo do verde/sky + Inter do app HTML. Para o responsável, parece um app diferente.

### 🟡 P2 — Limpeza e refinamento

#### RF-11 · Página outlier sem design system
- **Evidência:** `html/admin/diagnostico.html` carrega **só** Tabler Icons `@latest` (versão flutuante) e **zero CSS local**.
- **Impacto:** renderiza com defaults do navegador; destoa totalmente do resto.

#### RF-12 · Inconsistência na origem dos ícones
- **Evidência:** maioria usa Bootstrap Icons via CDN (`bootstrap-icons@1.11.3`); 5 páginas usam local `js/libs/bootstrap-icons.min.css` (`html/dashboard.html`, `html/direcao/*`, `direcao/direcao-notificacoes.html:16`). O arquivo local **existe** (`js/libs/bootstrap-icons.min.css`), então não há link quebrado, mas há risco de versão/cache divergente.

#### RF-13 · CSS não referenciado / artefatos de build
- **Evidência:** `css/tailwind-input.css` (3 linhas, fonte `@tailwind`) e `css/main-compiled.css` (1 linha) não são linkados por nenhuma página.
- **Impacto:** ruído no repositório; candidatos a remoção/mover para pipeline de build.

#### RF-14 · Clusters de CSS duplicado/legacy
- **Evidência (Apêndice):** `main.css` × `variables.css`; `components.css` × `components-new.css`; `announcement-feed-legacy.css` × `social-feed.css` × `notificacoes-mural.css`; `dashboard.css` + `dashboard-premium.css` + `bi-pedagogico-fixes.css`.
- **Impacto:** múltiplas folhas resolvendo o mesmo problema; difícil saber qual é a canônica.

---

## 5. Recomendações de Arte e Layout

> Ordem recomendada: **unificar marca → unificar tipografia → consolidar CSS → corrigir acessibilidade → polir**.

### 5.1 Unificar a marca em um único `--primary`
- Escolher **uma** cor de marca. Recomendação: manter **Emerald `#10b981`** (já é o token "novo" e a `theme-color` do PWA em `html/login.html:12`).
- Migrar as 11 páginas de `main.css` para `variables.css` + `base.css` + `components-new.css`, ou redefinir os tokens de `main.css` para apontar para os mesmos valores (`--primary: #10b981`) como ponte temporária.

### 5.2 Corrigir a cor de texto de corpo (RF-2)
- Trocar `p { color: var(--text-secondary) }` para `var(--text-primary)` (ou criar `--text-body: #e4e4e7`).
- Reservar verde (`#10b981`) exclusivamente para marca/links/sucesso, **não** para texto corrido.
- Renomear `--text-secondary` para algo honesto (`--text-accent` ou `--brand`), evitando que "secundário" signifique "verde".

### 5.3 Padronizar a tipografia
- Definir **Inter** como fonte única do app HTML (display opcional Instrument Serif só em landing/hero).
- Migrar `html/pages/*` (Outfit/Jakarta) para Inter.
- Alinhar o Portal do Responsável: trocar Poppins por Inter (ou adotar Inter+Instrument em ambos) para uma linguagem comum.
- Garantir que **toda** página carregue a fonte canônica (várias admin não carregam nenhuma).

### 5.4 Restaurar foco acessível (RF-4)
- Em vez de `outline: none`, usar um anel de foco visível e on-brand:
  ```css
  :focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 2px;
  }
  ```

### 5.5 Consolidar o CSS de glassmorphism (RF-6)
- Manter **uma** implementação de `.glass-card` (sugestão: `parallax-glass.css`) e remover as redefinições em `glass-premium.css`/`variables.css`, mantendo apenas tokens (`--glass-bg`, `--glass-blur`).

### 5.6 Reduzir estilos inline e revisar Tailwind (RF-7, RF-9)
- Extrair os estilos inline de `html/dashboard.html` para classes utilitárias do design system.
- Decidir Tailwind **ou** CSS próprio como base utilitária — evitar os dois resolvendo o mesmo (ex.: `.container`).

### 5.7 Aplicar `data-theme` em todas as páginas (RF-8)
- Adicionar `data-theme="dark"` ao `<html>` das ~17 páginas faltantes para habilitar a alternância de tema de forma uniforme.

### 5.8 Tratar outliers e limpar artefatos (RF-11, RF-13, RF-14)
- Dar a `html/admin/diagnostico.html` o mesmo `variables.css` + `base.css`.
- Mover `tailwind-input.css`/`main-compiled.css` para o pipeline de build (fora de `/css` servido).
- Marcar e remover gradualmente os CSS `*-legacy`.

### 5.9 Proposta de paleta unificada (alvo)

| Papel | Token | Valor sugerido |
|-------|-------|----------------|
| Marca | `--primary` | `#10b981` (Emerald) |
| Marca hover | `--primary-hover` | `#34d399` |
| Acento secundário | `--secondary` | `#0ea5e9` (Sky) |
| Fundo base | `--bg-primary` | `#09090b` |
| Card | `--bg-tertiary` | `#18181b` |
| Texto principal | `--text-primary` | `#fafafa` |
| **Texto de corpo** | **`--text-body`** | **`#d4d4d8`** *(novo — substitui verde)* |
| Texto atenuado | `--text-tertiary` | `#a1a1aa` |
| Sucesso | `--success` | `#10b981` |
| Aviso | `--warning` | `#f59e0b` |
| Erro | `--error` | `#ef4444` |
| Foco | `--border-focus` | `#10b981` (com `:focus-visible`) |

**Tipografia alvo:** Inter (texto) + Instrument Serif (display/landing) · **Ícones alvo:** Bootstrap Icons `1.11.3` (uma origem só).

---

## 6. Apêndice — Inventário de CSS

### 6.1 Arquivos em `/css` (linhas aproximadas)

| Arquivo | Linhas | Observação |
|---------|-------:|-----------|
| `index-landing.css` | 1847 | Landing (maior folha) |
| `bi-pedagogico.css` | 979 | BI da direção |
| `dashboard.css` | 884 | Layout do dashboard |
| `turma.css` | 874 | Detalhe de turma |
| `responsive-global.css` | 765 | Overrides responsivos globais |
| `components.css` | 744 | Componentes (geração antiga) |
| `login-new.css` | 665 | Login/reset |
| `cadastro-aluno.css` | 616 | Cadastro de aluno |
| `base.css` | 584 | Reset/typografia globais |
| `announcement-feed-legacy.css` | 574 | **Legacy** |
| `selecionar.css` | 532 | Seleção de turma |
| `components-new.css` | 529 | Componentes (geração nova) |
| `realtime.css` | 465 | Indicadores tempo real |
| `chatbot-ia.css` | 449 | Chatbot IA |
| `watermark.css` | 444 | Marca d'água |
| `social-feed.css` | 437 | Feed social |
| `neo-brutal.css` | 431 | Estilo neo-brutalista |
| `cadastro.css` | 419 | Formulários de cadastro |
| `main.css` | 372 | **Geração antiga (roxo)** |
| `parallax-glass.css` | 357 | Glassmorphism |
| `reactions.css` | 351 | Reações emoji |
| `notifications-panel.css` | 332 | Painel de notificações |
| `sidebar.css` | 330 | Sidebar |
| `ata.css` | 269 | ATA |
| `voice-orb.css` | 269 | Orb de voz |
| `gerenciar-salas.css` | 251 | Gerenciar salas |
| `variables.css` | 251 | **Tokens (fonte de verdade)** |
| `portal-responsavel-modern.css` | 237 | Seção landing do portal |
| `splash-screen.css` | 223 | Splash |
| `perfil.css` | 221 | Seleção de perfil |
| `notificacoes-mural.css` | 206 | Mural de notificações |
| `lista-professores.css` | 202 | Lista de professores |
| `dashboard-premium.css` | 172 | Camada premium do dashboard |
| `grade-horaria.css` | 92 | Grade horária |
| `glass-premium.css` | 74 | Glass (conflita com parallax-glass) |
| `bi-pedagogico-fixes.css` | 4 | Micro-patch |
| `tailwind-input.css` | 3 | **Fonte de build (não linkado)** |
| `main-compiled.css` | 1 | **Artefato build (não linkado)** |
| `tailwind-built.css` | 1 | Utilitários Tailwind (linkado em quase tudo) |

CSS fora de `/css` referenciados: `direcao/direcao.css` (602), `direcao/horario-jaguari.css` (1088), `direcao/direcao-modern.css` (81), `detalhes/detalhes.css` (130), `graficos/graficos.css` (384).

### 6.2 Clusters de duplicação

- **Fundação:** `main.css` (roxo) × `variables.css`+`base.css` (verde); `components.css` × `components-new.css`.
- **Glass:** `parallax-glass.css` × `glass-premium.css` × `variables.css`.
- **Feed/notificações:** `announcement-feed-legacy.css` × `social-feed.css` × `notificacoes-mural.css`.
- **Dashboard:** `dashboard.css` + `dashboard-premium.css` + `bi-pedagogico-fixes.css`.

---

## 7. Plano de Ação Sugerido (sem aplicar nesta etapa)

| Fase | Ação | Esforço | Risco |
|------|------|:------:|:----:|
| 1 | Corrigir cor de texto de corpo (RF-2) e restaurar `:focus-visible` (RF-4) | Baixo | Baixo |
| 2 | Unificar marca verde e migrar páginas `main.css` (RF-1) | Médio | Médio |
| 3 | Padronizar tipografia para Inter (RF-3) | Médio | Baixo |
| 4 | Remover banner "em desenvolvimento" das telas finais (RF-5) | Baixo | Baixo |
| 5 | Aplicar `data-theme` em todas as páginas (RF-8) | Baixo | Baixo |
| 6 | Consolidar glass + revisar Tailwind + limpar legacy (RF-6/7/14) | Alto | Médio |
| 7 | Alinhar Portal do Responsável ao design system (RF-10) | Médio | Médio |

---

**Status:** Análise concluída · **Nenhum arquivo de código foi alterado.**
**Próximo passo possível:** iniciar a Fase 1 (correções de baixo risco e alto impacto) mediante sua aprovação.
