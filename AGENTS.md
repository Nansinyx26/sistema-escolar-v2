# AGENTS.md — Padrão de Trabalho do Sistema Escolar v2

> **Este arquivo é a fonte de verdade do processo de desenvolvimento.**
> Vale para **qualquer agente de IA, de qualquer modelo** (Claude, GPT, Gemini, Copilot,
> Cursor, Codex, Windsurf, Devin…) e para qualquer pessoa desenvolvedora.
> Leia este arquivo **antes** de escrever a primeira linha de código.

Repositório: `https://github.com/Nansinyx26/sistema-escolar-v2` (privado)

---

## 1. Regra de ouro

**Nenhuma alteração entra na `main` sem passar por: Issue → Branch → PR → Review → Merge → Deploy.**

Não existe commit direto na `main`. Não existe PR sem Issue. Não existe Issue sem tipo.

```
┌────────┐   ┌────────┐   ┌─────┐   ┌────────┐   ┌───────┐   ┌────────┐
│ Issue  │──▶│ Branch │──▶│ PR  │──▶│ Review │──▶│ Merge │──▶│ Deploy │
└────────┘   └────────┘   └─────┘   └────────┘   └───────┘   └────────┘
     ▲                                                             │
     └──── a Issue fecha automaticamente quando o PR faz merge ◀───┘
```

---

## 2. Toda tarefa começa como Issue

Antes de codar **qualquer coisa**, abra uma Issue. Três tipos, e só três:

| Tipo | Label | Quando usar | Template |
|------|-------|-------------|----------|
| 🐛 **Correção** | `tipo:correcao` | Algo existe e está errado, quebrado ou fora do esperado | `01-correcao.yml` |
| ✨ **Melhoria** | `tipo:melhoria` | Algo existe e funciona, mas pode ficar melhor (perf, UX, refactor, acessibilidade, dívida técnica) | `02-melhoria.yml` |
| 🚀 **Nova função** | `tipo:nova-funcao` | Algo não existe e será criado | `03-nova-funcao.yml` |

**Se a tarefa não couber em um desses três tipos, ela não está clara o suficiente para ser executada.** Refine antes.

### Regras da Issue

- Título no imperativo, em português, sem ponto final: `Corrigir cálculo de frequência na planilha de faltas`
- Toda Issue recebe **um** `tipo:*`, **uma** `area:*` e **uma** `prioridade:*`
- Toda Issue precisa de **critério de aceite verificável** — como saber que acabou
- Agente que descobre um problema paralelo **não conserta junto**: abre outra Issue e referencia

### Criando via CLI

```bash
gh issue create \
  --title "Corrigir cálculo de frequência na planilha de faltas" \
  --label "tipo:correcao,area:backend,prioridade:alta" \
  --body "..."
```

---

## 3. Branch

Uma Issue = uma branch. Sempre a partir da `develop` atualizada.

```
<tipo>/<numero-da-issue>-<slug-curto>
```

| Tipo da Issue | Prefixo | Exemplo |
|---------------|---------|---------|
| Correção | `fix/` | `fix/142-calculo-frequencia` |
| Melhoria | `chore/` ou `refactor/` | `refactor/143-user-controller` |
| Nova função | `feat/` | `feat/144-relatorio-bimestral` |

```bash
git switch develop && git pull
git switch -c fix/142-calculo-frequencia
```

---

## 4. Commits — Conventional Commits (obrigatório)

Validado por **commitlint** no hook `commit-msg` e no CI. Commit fora do padrão é rejeitado.

```
<tipo>(<escopo>): <descrição no imperativo, minúscula, sem ponto final>

[corpo opcional]

Refs #142
```

Tipos aceitos: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`, `style`, `revert`.

Escopos usuais: `backend`, `frontend`, `portal`, `motion`, `obs`, `ci`, `deps`, `db`.

```bash
git commit -m "fix(backend): corrigir divisão por zero no cálculo de frequência

Refs #142"
```

---

## 5. Pull Request

### O PR **precisa** mencionar a Issue na descrição

Esta é a regra mais importante deste documento. Use uma **closing keyword** do GitHub na
descrição do PR (não no título), para que o merge feche a Issue automaticamente:

```markdown
Closes #142
```

Palavras aceitas pelo GitHub: `Closes` / `Fixes` / `Resolves` (+ `#numero`).
Para PRs que apenas se relacionam sem encerrar a Issue, use `Refs #142`.

> Um PR sem `Closes #`/`Refs #` na descrição é **bloqueado** pelo job `pr-policy` do CI.

### Abrindo o PR

```bash
git push -u origin fix/142-calculo-frequencia

gh pr create \
  --base develop \
  --title "fix(backend): corrigir cálculo de frequência" \
  --body "Closes #142

## O que muda
..."
```

O template em `.github/PULL_REQUEST_TEMPLATE.md` é preenchido automaticamente — **não apague a linha `Closes #`**.

### Um PR deve

- Resolver **uma** Issue. PR que resolve três Issues é três PRs.
- Passar em todo o CI (lint, testes, arquitetura, e2e)
- Não reduzir a cobertura de testes (gate do Codecov)
- Ter descrição que explica **o porquê**, não só o quê

---

## 6. Deploy é consequência do merge

Deploy **nunca** é manual. É o CI reagindo a um merge.

| Branch | Ambiente | Gatilho | Job |
|--------|----------|---------|-----|
| `develop` | **Dev** (Render) | merge do PR | `build-dev` → `migrations` |
| `main` | **Produção** (Render) | merge do PR `develop` → `main` | `build-prod` → release `v<run_number>` |

Fluxo completo de uma entrega:

```
feat/144-x ──PR──▶ develop ──(deploy dev + migrations)──▶ PR release ──▶ main ──(deploy prod + release)
```

**Hotfix de produção**: Issue `tipo:correcao` + `prioridade:critica` → branch `hotfix/<issue>-<slug>`
a partir da `main` → PR para `main` → em seguida PR de sincronização `main` → `develop`.

---

## 7. Instruções específicas para agentes de IA

Ao receber uma tarefa neste repositório, **nesta ordem**:

1. **Classifique** a tarefa: correção, melhoria ou nova função.
2. **Verifique se já existe Issue** — `gh issue list --search "<termo>"`. Se existir, use-a. Nunca duplique.
3. **Crie a Issue** se não existir, com template, labels e critério de aceite.
4. **Crie a branch** a partir da `develop`, nomeada com o número da Issue.
5. **Implemente**, respeitando os padrões das seções 8 a 10.
6. **Rode o gate local** antes de abrir o PR:
   ```bash
   npm run verify      # biome + arch + knip + testes
   ```
7. **Abra o PR** com `Closes #<numero>` na descrição.
8. **Reporte ao usuário** os links da Issue e do PR.

### Proibições

- ❌ Commitar direto na `main` ou na `develop`
- ❌ Abrir PR sem Issue vinculada na descrição
- ❌ Fazer merge do próprio PR sem CI verde
- ❌ Ampliar o escopo do PR além da Issue ("já que eu estava aqui…")
- ❌ Desativar teste, lint ou gate para o CI passar — conserte a causa
- ❌ Commitar segredo, `.env`, chave ou credencial

### Quando a tarefa for grande

Quebre em uma Issue-guarda-chuva (`tipo:nova-funcao`, label `epico`) com checklist de sub-Issues.
Cada sub-Issue vira seu próprio PR. Nunca um PR gigante.

---

## 8. Padrão de interface — Motion, Skeleton e Lazy Loading

Toda interface do sistema segue a skill **`design-motion-principles`**
(instalada em `.claude/skills/design-motion-principles/`).

Weighting deste projeto: **Emil Kowalski (primário) · Jakub Krehel (secundário)** —
é um SaaS administrativo de uso diário, então a régua é *restrição e velocidade*, não espetáculo.

Regras não negociáveis:

- Todo estado de carregamento usa **skeleton**, nunca spinner solto nem tela em branco
- Toda imagem abaixo da dobra usa `loading="lazy"` e `decoding="async"`
- Toda entrada de conteúdo usa `opacity` + `translateY` + `blur` (recipe do cookbook)
- Saída sempre **mais sutil** que a entrada
- Só se anima `transform`, `opacity`, `filter` e `clip-path` — nunca `width`/`height`/`top`/`left`
- Nada de `ease` ou `ease-in-out` puros — use os tokens de easing de `css/motion.css`
- **Todo** movimento respeita `prefers-reduced-motion`
- Ação de alta frequência (salvar, digitar, navegar por teclado) **não anima**

Detalhes em [`docs/MOTION.md`](docs/MOTION.md).

---

## 9. Padrão de observabilidade

Todo código novo de backend precisa ser observável. Detalhes em [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md).

- Erro capturado vai para o hub de observabilidade, não só para `console.error`
- Operação relevante roda dentro de um span do OpenTelemetry
- Nunca logar PII de aluno, responsável ou professor (CPF, endereço, telefone, e-mail)

---

## 10. Portões de qualidade

Rodam no hook de pre-commit, no CI e devem passar antes de qualquer PR:

| Ferramenta | Comando | O que garante |
|------------|---------|---------------|
| **Biome** | `npm run lint` | Lint e formatação |
| **dependency-cruiser** | `npm run arch` | Contrato de arquitetura (camadas) |
| **Knip** | `npm run knip` | Código, deps e exports mortos |
| **Jest + Codecov** | `npm run test:coverage` | Unitário/integração + cobertura |
| **Playwright** | `npm run test:e2e` | Fluxos ponta a ponta |
| **Stryker** | `npm run test:mutation` | Qualidade real dos testes (mutação) |
| **commitlint** | automático | Mensagem de commit |

Atalho: **`npm run verify`** roda o conjunto obrigatório de uma vez.

Detalhes, armadilhas de configuração e o estado atual de cada portão em
[`docs/QUALITY.md`](docs/QUALITY.md). Dois pontos que economizam tempo:

- O gate de lint hoje é **incremental** (`lint:changed`): existe dívida legada de
  831 problemas anteriores à adoção do Biome, e travar tudo de uma vez só faria o
  time desligar o lint. Código novo, porém, precisa entrar limpo.
- **Nunca coloque comentário no `biome.json`.** Um único comentário faz todos os
  `overrides` pararem de valer, sem emitir erro nenhum.

---

## 11. Referência rápida

```bash
# 1. Issue
gh issue create --title "..." --label "tipo:correcao,area:backend,prioridade:alta"

# 2. Branch
git switch develop && git pull && git switch -c fix/142-slug

# 3. Trabalho
npm run verify

# 4. Commit
git commit -m "fix(backend): ...

Refs #142"

# 5. PR  (a linha Closes # é obrigatória)
git push -u origin fix/142-slug
gh pr create --base develop --title "fix(backend): ..." --body "Closes #142"

# 6. Deploy: automático no merge
```
