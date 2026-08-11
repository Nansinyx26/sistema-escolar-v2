# CLAUDE.md

## Leia primeiro: [AGENTS.md](AGENTS.md)

Todo o processo de trabalho deste repositório está em **[`AGENTS.md`](AGENTS.md)** — que vale
para qualquer agente de qualquer modelo. Este arquivo existe apenas para garantir que o Claude
Code carregue esse padrão automaticamente.

**Resumo do que é obrigatório:**

1. Toda tarefa vira uma **Issue** antes do código (`tipo:correcao` | `tipo:melhoria` | `tipo:nova-funcao`)
2. Uma Issue = uma **branch** (`fix/` | `chore/` | `feat/` + número da Issue)
3. Commits em **Conventional Commits** (validado por commitlint)
4. Todo **PR menciona a Issue na descrição** com `Closes #<numero>` — o CI bloqueia se faltar
5. **Deploy é consequência do merge**: `develop` → dev, `main` → produção. Nunca manual.
6. Antes de abrir o PR: `npm run verify`

## Stack

- **Frontend principal**: HTML/CSS/JS vanilla (66 páginas), SCSS + Tailwind, PWA com service worker
- **Portal do responsável**: React 18 + Vite + TypeScript (`portal-responsavel/`)
- **Backend**: Node + Express + MongoDB/Mongoose + Socket.IO (`backend/`)
- **Deploy**: Render, orquestrado por `.github/workflows/ci-cd.yml`

## Padrões de interface

Use a skill **`design-motion-principles`** (`.claude/skills/design-motion-principles/`) para
qualquer trabalho de motion. Weighting deste projeto: **Emil (primário) · Jakub (secundário)**.
Skeleton, lazy loading e `prefers-reduced-motion` são obrigatórios — ver [`docs/MOTION.md`](docs/MOTION.md).

Para direção visual (paleta, tipografia, layout) use a skill **`frontend-design`**
(`.claude/skills/frontend-design/`). Registries de componentes (shadcn, Magic UI,
React Bits, 21st.dev) estão configurados **apenas no `portal-responsavel/`** —
ver [`docs/UI-TOOLING.md`](docs/UI-TOOLING.md).

## Observabilidade

Hub em `backend/src/observability/`. Ver [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md).
Nunca logar PII (CPF, endereço, telefone, e-mail de aluno/responsável).
