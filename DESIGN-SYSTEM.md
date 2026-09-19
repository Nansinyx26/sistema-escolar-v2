# Design System · Sistema Escolar

Padronização de **UI** e **ícones (line icons)** nos dois frontends.

| Camada | Biblioteca | Status |
| --- | --- | --- |
| Ícones (ambos frontends) | **Lucide** | ✅ fundação pronta |
| UI — sistema legado (HTML + Tailwind) | **daisyUI** (prefixo `dui-`) | ✅ configurado |
| UI — Portal do Responsável (React + SCSS) | **Radix Primitives** | ✅ Dialog-piloto |
| Fonte | **Inter** | mantida |

Paleta: **verde institucional** — esmeralda `#10b981` (primária) + teal `#0d9488` (secundária). Sem roxo/neon.

---

## 1. Ícones — Lucide

### Sistema legado (HTML)
Já existe um **shim de compatibilidade** que converte `<i class="bi bi-*">` em SVGs Lucide no
carregamento, sem precisar reescrever as ~919 tags de uma vez. Ícones sem mapeamento continuam
como Bootstrap Icons (fallback) — nada quebra.

Adicione ao final do `<body>` de cada página (após o `bootstrap-icons.min.css` já existente):

```html
<script src="../js/libs/lucide.min.js"></script>
<script src="../js/libs/lucide-init.js"></script>
```

- Ícone novo: `<i data-lucide="graduation-cap"></i>`.
- Conteúdo injetado por JS (modais, listas): chame `window.renderLucideIcons()` depois de inserir.
- O mapa `bi → lucide` fica em [`js/libs/lucide-init.js`](js/libs/lucide-init.js); adicione entradas conforme necessário.

**Página aplicada (piloto):** [`html/dashboard.html`](html/dashboard.html).
**Referência visual:** [`html/design-system.html`](html/design-system.html).

### Portal do Responsável (React)
Use `lucide-react` (já instalado):

```tsx
import { GraduationCap } from 'lucide-react';
<GraduationCap size={18} />
```

> ⚠️ Dívida: 17 arquivos ainda usam Tabler (`<i className="ti ti-*">`). Migrar para `lucide-react`
> para unificar (ex.: `ti-x` → `<X/>`, `ti-clock` → `<Clock/>`, `ti-user` → `<User/>`).

---

## 2. UI legado — daisyUI (prefixo `dui-`)

O CSS custom já define `.btn` (155×), `.card` (107×), `.modal` (69×)… Por isso o daisyUI roda com
**`prefix: 'dui-'`** e **`base: false`** — não toca nas telas antigas.

Configuração em [`tailwind.config.js`](tailwind.config.js). Temas: `escolar` (claro) e
`escolar-dark` (escuro, casa com `data-theme="dark"`).

```html
<div data-theme="escolar-dark">
  <button class="dui-btn dui-btn-primary">Salvar</button>
  <div class="dui-card dui-bg-base-200">…</div>
  <span class="dui-badge dui-badge-primary">Ativa</span>
</div>
```

Rebuild do CSS após usar classes novas:

```bash
npm run build:tailwind   # tailwindcss -i css/tailwind-input.css -o css/tailwind-built.css --minify
```

---

## 3. UI do Portal — Radix Primitives

Componentes acessíveis (foco preso, ESC, aria-*) estilizados com o SCSS do portal.

Componente-piloto: [`portal-responsavel/src/components/ui/Dialog.tsx`](portal-responsavel/src/components/ui/Dialog.tsx).

```tsx
import Dialog from './components/ui/Dialog';
import { GraduationCap } from 'lucide-react';

<Dialog
  title="Confirmar matrícula"
  description="Esta ação notifica o responsável."
  icon={<GraduationCap size={18} />}
  trigger={<button className="btn">Matricular</button>}
>
  …conteúdo…
</Dialog>
```

Próximo passo sugerido: migrar `Modal.tsx` para usar este `Dialog` (herda acessibilidade do Radix).

---

## 4. Base visual dos logins e painéis — `ui3` (épico #370)

Visual "giz neon": no escuro a tela é um quadro-negro (preto/grafite) com destaque
verde-turquesa; no claro vira quadro branco com o mesmo verde em tom de tinta.
Referência: as artes do Portal do Docente e do dashboard do professor.

| Arquivo | O que tem |
|---------|-----------|
| `css/ui-base.css` | Tokens (`--ui-*`) dos dois temas, botões, campos, caixa de seleção, selos, foco e o combobox de escola |
| `css/ui-login.css` | Layout dos logins de professor, direção e secretaria |
| `js/escola-combobox.js` | Aprimora `<select data-ui-combo>` com busca e teclado; o `value` (id) nunca aparece na tela |
| `js/login-tema.js` | Botão de tema dos logins (usa o `ThemeManager` de `theme.js`) |
| `portal-responsavel/src/components/LoginResponsavel.tsx` | Login do responsável (#365): importa as duas folhas acima e liga `ui3` no body só enquanto está montado; o próprio fica em `src/styles/login-responsavel.scss` (prefixo `lr-*`) |
| `css/ui-painel.css` | Esqueleto dos painéis (`body.ui3.ui-painel`): barra lateral, cabeçalho, saudação, cartões de número (`pn-kpi`), cartões (`pn-card`), agenda do dia, ações rápidas e o ajuste dos blocos montados por outros scripts (equipe online, mural, avaliações) |
| `js/ui-painel.js` | Tema, menu da conta, estado do hambúrguer e cartão "Instalar" dos painéis |
| `js/painel-professor.js` | Dados do painel do professor (#367): cartões, agenda do dia, estados vazio e de erro |

Como usar numa página:

- Marcar o `<body>` com `class="ui3"` e carregar `ui-base.css` **depois** dos CSS antigos.
- Usar só classes `ui-*` (ou um prefixo da própria tela, como `lg-*`): tudo é escopado em
  `body.ui3` para não colidir com `components-new.css`, `dashboard.css` etc.
- Tipografia: **Sora** (títulos e números, `ui-display`, `ui-num`) + **Inter** (texto).
- Cor que é informação (destaque, status, ícone em quadrado colorido) leva `ui-tint`
  (usa `--ui-tint`, padrão o verde) ou `ui-on-color` (texto sobre fundo colorido). Sem essas
  classes, a varredura do tema claro em `variables.css` pinta tudo de preto.
- Foco: o anel é o global de `acessibilidade.css` (3px). Componente novo não soma um
  segundo anel por cima.
- Movimento: entrada com `opacity + translateY(8px) + blur(4px)`, uma vez; nada em loop.

Nos painéis (`body.ui3.ui-painel`):

- Três colunas no desktop, duas até 1279px, uma até 1023px (as colunas viram `display:
  contents` e a ordem passa a ser a de uso). A barra lateral vira gaveta até 768px.
- Não usar nos elementos novos as classes antigas que o tema claro pinta de preto
  (`.welcome-section`, `.dashboard-card`, `.stat-card-premium`…): o claro dos painéis é
  cartão branco, como na arte. O card do mural, montado pelo React, é redeclarado no CSS.
- Carregamento é `.skeleton` (de `motion.css`) com o tamanho de `pn-skel`; vazio e erro
  usam `.pn-vazio`, que diz o que fazer.
- Escola ativa: só o nome (`[data-escola-ativa-nome]`, preenchido por `escola-switcher.js`).

---

## Próximos passos (replicação)
1. Incluir os 2 `<script>` do Lucide nas 57 páginas restantes (o shim faz o resto).
2. Migrar os 17 arquivos `ti ti-*` do portal para `lucide-react`.
3. Adotar `dui-` nas telas novas do legado; refatorar as antigas aos poucos.
4. Trocar `Modal.tsx` pelo `ui/Dialog.tsx` do Radix.
