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

## Próximos passos (replicação)
1. Incluir os 2 `<script>` do Lucide nas 57 páginas restantes (o shim faz o resto).
2. Migrar os 17 arquivos `ti ti-*` do portal para `lucide-react`.
3. Adotar `dui-` nas telas novas do legado; refatorar as antigas aos poucos.
4. Trocar `Modal.tsx` pelo `ui/Dialog.tsx` do Radix.
