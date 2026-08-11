# Ferramentas de UI e design

Este documento descreve as ferramentas de design/componentes ligadas ao repositório e
como usá-las. Complementa [`MOTION.md`](MOTION.md), que continua sendo a referência
obrigatória para animação e `prefers-reduced-motion`.

## Onde cada coisa se aplica

O repositório tem duas frentes de interface, e nem toda ferramenta serve às duas:

| Frente | Stack | shadcn / Magic UI / React Bits |
| --- | --- | --- |
| Sistema principal (66 páginas) | HTML/CSS/JS vanilla, SCSS + Tailwind 3 + daisyUI | ❌ não — são bibliotecas React |
| `portal-responsavel/` | React 18 + Vite + TypeScript | ✅ sim — é aqui que os registries estão configurados |

Para o sistema principal, o valor está na **skill `frontend-design`** e no **DESIGN.md**
(direção visual, tipografia, paleta), não nos registries de componentes React.

---

## 1. Skill `frontend-design` (Anthropic)

Instalada em [`.claude/skills/frontend-design/`](../.claude/skills/frontend-design/),
baixada de [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design).

Orienta direção estética, tipografia e escolhas que não pareçam template genérico.
Usar em qualquer trabalho de **UI nova ou redesenho**. Para **motion**, a skill do projeto
continua sendo `design-motion-principles` (ver [CLAUDE.md](../CLAUDE.md)) — as duas se
complementam: `frontend-design` define a linguagem visual, `design-motion-principles`
define como ela se move.

Atualizar:

```bash
curl -sfL https://raw.githubusercontent.com/anthropics/skills/main/skills/frontend-design/SKILL.md \
  -o .claude/skills/frontend-design/SKILL.md
```

## 2. shadcn/ui — CLI + registries

O `portal-responsavel/` tem [`components.json`](../portal-responsavel/components.json)
configurado. A partir da raiz do portal:

```bash
cd portal-responsavel

# shadcn/ui (registry padrão)
npx shadcn@latest add button card dialog

# Magic UI
npx shadcn@latest add @magicui/marquee @magicui/shimmer-button

# React Bits
npx shadcn@latest add @reactbits/SplitText-TS-CSS
```

Componentes caem em `src/components/ui/` e usam o helper
[`cn`](../portal-responsavel/src/lib/utils.ts) (`clsx` + `tailwind-merge`).

> Os registries geram código no estilo do Prettier (aspas duplas, sem ponto e vírgula),
> que o Biome deste repositório reprova. **Rode `npm run lint:fix` na raiz depois de cada
> `shadcn add`** — senão o gate de lint do CI quebra o PR.

### Convenção de nomes do React Bits

O registry do React Bits expõe uma variante por combinação de linguagem e estilo:
`{Componente}-{TS|JS}-{CSS|TW}`. **Prefira as variantes `-CSS`** — o portal usa CSS
Modules em SCSS, e a variante CSS não depende de classes utilitárias do Tailwind.

Catálogo: [reactbits.dev](https://www.reactbits.dev) · [magicui.design](https://magicui.design)

## 3. 21st.dev (MCP)

O 21st.dev **não publica registry JSON público** — o acesso é via MCP HTTP autenticado.
Já está declarado em [`.mcp.json`](../.mcp.json), mas exige uma chave:

1. Gere uma chave em <https://21st.dev/mcp>
2. Exporte `TWENTY_FIRST_API_KEY` no ambiente (nunca commitar — `.env` está no `.gitignore`)
3. Reinicie o Claude Code e aprove o servidor MCP do projeto

Sem a variável, o servidor `21st` simplesmente falha ao conectar; o resto do fluxo
(shadcn, Magic UI, React Bits) continua funcionando normalmente.

## 4. DESIGN.md (getdesign.md)

[getdesign.md](https://getdesign.md) é um catálogo web de análises de design system —
sem CLI e sem MCP. O uso prático é: escolher uma análise, salvar como `DESIGN.md` na raiz
do repositório e tratá-la como o briefing visual que os agentes leem antes de mexer em UI.

Isso é opcional e **ainda não foi feito** — escolher a referência estética do sistema é
decisão de produto, não de tooling.

---

## Tailwind no portal — decisão e cuidado

O portal passou a ter Tailwind v4 (`@tailwindcss/vite`) porque shadcn e Magic UI dependem
dele. A instalação foi feita para **não tocar no visual existente**:

- [`src/styles/tailwind.css`](../portal-responsavel/src/styles/tailwind.css) importa
  **apenas as camadas `theme` e `utilities`**. O `preflight` (reset global do Tailwind)
  fica de fora de propósito — ligá-lo zeraria o reset próprio do portal em `global.scss`
  e os CSS Modules em SCSS.
- O import entra em `main.tsx` **depois** de `global.scss`.
- Os tokens (`--background`, `--primary`, …) são os do shadcn e só afetam componentes que
  os consomem.

**Ao mexer nesse arquivo, não substitua os imports por `@import "tailwindcss";`** — essa
forma traz o preflight junto e quebra o estilo de todas as telas atuais.

O Tailwind 3 + daisyUI do sistema principal continua independente: escopos de
`package.json` separados, builds separados.
