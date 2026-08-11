# Contribuindo

O processo de trabalho — Issue → Branch → PR → Deploy — está em **[AGENTS.md](AGENTS.md)**,
e vale para pessoas e para agentes de qualquer modelo. Leia antes.

Este arquivo cobre o que o AGENTS.md resume: **como publicar** e **como agir quando a
produção está quebrada**.

---

## Antes de abrir qualquer PR

```bash
npm run verify      # lint do que você mudou + arquitetura + código morto + testes
```

Se passar aqui, passa no CI. As exceções conhecidas estão em [docs/QUALITY.md](docs/QUALITY.md).

---

## Release: `develop` → `main`

Deploy nunca é manual. Publicar em produção é abrir um PR de release e mesclá-lo.

### 1. Confira o que vai

```bash
git fetch origin
git log origin/main..origin/develop --oneline
```

Se aparecer algo que você não reconhece, **pare e investigue**. Um release é o momento
errado para descobrir o que entrou na `develop`.

### 2. Abra o PR

```bash
gh pr create --base main --head develop \
  --title "chore(release): <o que esta entrega muda para quem usa>"
```

O título é o que fica no histórico da `main` para sempre. `Develop` não serve —
e o gate reprova, com razão.

Na descrição, liste os PRs incluídos e o que muda no comportamento. Se houver migração de
banco ou variável de ambiente nova, diga isso em destaque.

### 3. Espere o CI e mescle

O merge dispara `build-prod`, que faz o deploy no Render e cria a release `v<run_number>`.

### O que o gate NÃO exige do release

O PR de release não precisa de Issue vinculada nem de nome de branch no padrão — ele
promove trabalho já revisado, um PR por vez, na entrada da `develop`. O **título**
continua obrigatório.

---

## Hotfix: produção quebrada

Use quando o sistema está fora do ar ou com defeito grave em produção, e **esperar o ciclo
normal custa mais que o risco de pular a `develop`**. Fora disso, o caminho é o de sempre.

### 1. Issue primeiro — sim, mesmo com pressa

```bash
gh issue create --title "Corrigir <o que está quebrado>" \
  --label "tipo:correcao,area:backend,prioridade:critica"
```

Leva trinta segundos e é o que permite entender depois por que a `main` recebeu um commit
fora do release.

### 2. Branch a partir da `main`, não da `develop`

```bash
git switch main && git pull
git switch -c hotfix/<numero-da-issue>-<slug>
```

A `develop` pode conter trabalho não publicado. Partir dela levaria esse trabalho junto
para produção, sem revisão de release.

### 3. Corrija o mínimo

Hotfix não é hora de refatorar. Só o que faz a produção voltar.

### 4. PR para a `main`

```bash
gh pr create --base main --title "fix(<escopo>): <correção>" --body "Closes #<numero>"
```

O CI roda igual. Se estiver tudo fora do ar e o CI for o único obstáculo, veja
[Emergência](#emergência) abaixo — mas leia a seção inteira antes.

### 5. Sincronize de volta — este passo não é opcional

```bash
gh pr create --base develop --head main \
  --title "chore(sync): devolver à develop o hotfix de <assunto>"
```

**Sem isto, a correção não existe na `develop`.** O próximo release reintroduz o defeito
em produção, e o sintoma volta sem que ninguém entenda por quê — o commit está na `main`,
afinal.

Este PR também é isento de Issue e de nome de branch no gate.

---

## Emergência

Se a produção está fora do ar e o CI é o único obstáculo:

1. *Settings → Branches* → desative a proteção da `main`
2. Publique a correção
3. **Reative a proteção imediatamente**
4. Abra a Issue descrevendo o que foi feito e por quê

O passo 3 é o que costuma ser esquecido. Proteção desligada "por um minuto" tem o hábito
de ficar desligada por meses, e ninguém percebe até o dia em que ela faria falta.

---

## Ambientes

| Branch | Ambiente | O que dispara |
|--------|----------|---------------|
| `develop` | Dev (Render) | merge de qualquer PR → build + migrations |
| `main` | **Produção** (Render) | merge do PR de release → build + release `v<n>` |

Migrations rodam **só na `develop`**, por `npm run migrate:up`. São idempotentes: aplicam
apenas as pendentes e registram cada uma em `__migrations__`.

---

## Onde está o resto

| Assunto | Arquivo |
|---------|---------|
| Processo completo, regras para agentes | [AGENTS.md](AGENTS.md) |
| Motion, skeleton, lazy loading | [docs/MOTION.md](docs/MOTION.md) |
| Observabilidade e a barreira de PII | [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md) |
| Lint, arquitetura, cobertura, e2e | [docs/QUALITY.md](docs/QUALITY.md) |
| Backlog auditado | [docs/BACKLOG.md](docs/BACKLOG.md) |
