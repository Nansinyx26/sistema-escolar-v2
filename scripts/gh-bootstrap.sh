#!/usr/bin/env bash
#
# gh-bootstrap.sh — cria as labels e o backlog inicial de Issues no GitHub.
#
# Requisitos: gh CLI autenticado (`gh auth login`) com acesso a Nansinyx26/sistema-escolar-v2.
#
#   bash scripts/gh-bootstrap.sh --dry-run   # mostra o que faria, sem criar nada
#   bash scripts/gh-bootstrap.sh             # cria labels e Issues
#   bash scripts/gh-bootstrap.sh --labels    # apenas as labels
#
# É idempotente: label que já existe é atualizada, Issue com título igual já
# aberta é pulada. Rodar duas vezes não duplica nada.

set -euo pipefail

REPO="${REPO:-Nansinyx26/sistema-escolar-v2}"
DRY_RUN=false
LABELS_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --labels)  LABELS_ONLY=true ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "Argumento desconhecido: $arg" >&2; exit 2 ;;
  esac
done

if ! $DRY_RUN; then
  command -v gh >/dev/null 2>&1 || {
    echo "ERRO: gh CLI não encontrado. Instale com:  winget install --id GitHub.cli" >&2
    echo "      (para só conferir o que seria criado, rode com --dry-run)" >&2
    exit 1
  }
  gh auth status >/dev/null 2>&1 || {
    echo "ERRO: gh não autenticado. Rode:  gh auth login" >&2
    exit 1
  }
fi

run() {
  if $DRY_RUN; then
    printf '  [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------- labels

echo "==> Labels"

# formato: nome|cor|descrição
LABELS=(
  "tipo:correcao|d73a4a|Algo existe e está errado ou quebrado"
  "tipo:melhoria|a2eeef|Algo existe e pode ficar melhor"
  "tipo:nova-funcao|0e8a16|Algo que não existe e será criado"
  "area:backend|1d76db|Node, Express, Mongoose, Socket.IO"
  "area:frontend|5319e7|HTML, CSS e JS das 66 páginas"
  "area:portal|8b5cf6|Portal do responsável (React + Vite)"
  "area:infra|586069|CI/CD, deploy, tooling, observabilidade"
  "area:banco|0052cc|MongoDB, migrations, modelagem"
  "area:ux|e99695|Interface, motion, acessibilidade"
  "prioridade:critica|b60205|Produção quebrada, sem contorno"
  "prioridade:alta|ff9f1c|Bloqueia usuário, há contorno"
  "prioridade:media|fbca04|Incomoda, não bloqueia"
  "prioridade:baixa|c2e0c6|Cosmético ou adiável"
  "epico|3e4b9e|Guarda-chuva com sub-Issues"
  "bloqueada|000000|Depende de algo externo"
)

for entry in "${LABELS[@]}"; do
  IFS='|' read -r name color desc <<<"$entry"
  echo "  - $name"
  run gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force
done

$LABELS_ONLY && { echo "Somente labels. Fim."; exit 0; }

# ---------------------------------------------------------------- issues

echo "==> Issues"

# Títulos já abertos, para não duplicar.
if $DRY_RUN; then
  EXISTING=""
else
  EXISTING="$(gh issue list --repo "$REPO" --state all --limit 500 --json title --jq '.[].title')"
fi

criar_issue() {
  local titulo="$1" labels="$2" corpo="$3"

  if [ -n "$EXISTING" ] && grep -Fxq "$titulo" <<<"$EXISTING"; then
    echo "  = já existe, pulando: $titulo"
    return 0
  fi

  echo "  + $titulo"
  if $DRY_RUN; then
    printf '      labels: %s\n' "$labels"
    return 0
  fi
  gh issue create --repo "$REPO" --title "$titulo" --label "$labels" --body "$corpo"
}

RODAPE=$'\n\n---\n\nProcesso: [AGENTS.md](../blob/main/AGENTS.md). O PR que resolver esta Issue precisa conter `Closes #<numero>` na descrição.\nOrigem: auditoria do repositório em 2026-08-09 ([docs/BACKLOG.md](../blob/main/docs/BACKLOG.md)).'

# ---- Correções ----

criar_issue \
  "Corrigir job de migrations que executa script errado no deploy de dev" \
  "tipo:correcao,area:infra,prioridade:critica" \
  "## Problema

O job \`migrations\` em \`.github/workflows/ci-cd.yml\` roda \`npm run migrate up\`.

No \`backend/package.json\`, \`migrate\` aponta para \`node scripts/migrate_indexeddb_to_mongodb.js\` —
uma migração **one-shot** de IndexedDB para MongoDB. O argumento \`up\` é simplesmente ignorado.

Consequências:

1. Toda push na \`develop\` reexecuta uma migração de dado histórica contra o banco de dev.
2. A migração realmente versionada em \`backend/migrations/1718745600000-add-deve-mudar-senha.js\`
   nunca é executada — não há runner que leia esse diretório.

## Critério de aceite

- [ ] Existe um runner de migrations de verdade (\`migrate:up\` / \`migrate:down\`) lendo \`backend/migrations/\`
- [ ] O job do CI chama o runner, não o script one-shot
- [ ] \`migrate_indexeddb_to_mongodb.js\` renomeado/movido para deixar claro que é histórico e manual
- [ ] Migrations são idempotentes e registram o que já foi aplicado$RODAPE"

criar_issue \
  "Corrigir upload de cobertura que nunca recebe arquivo" \
  "tipo:correcao,area:infra,prioridade:alta" \
  "## Problema

O CI roda \`npm run coverage --if-present\`, mas o script no backend chama-se \`test:coverage\`.
Com \`--if-present\`, o passo termina em **sucesso sem gerar nada**.

O passo seguinte envia \`./backend/coverage/lcov.info\` ao Codecov — arquivo que nunca existiu.
Resultado: a cobertura do projeto nunca foi medida, e o badge/gate não significa nada.

## Critério de aceite

- [ ] O CI chama o script correto e gera \`backend/coverage/lcov.info\`
- [ ] O Codecov recebe o relatório e comenta no PR
- [ ] \`codecov.yml\` define os gates de projeto e de patch$RODAPE"

criar_issue \
  "Corrigir passo de ESLint que nunca executa" \
  "tipo:correcao,area:infra,prioridade:alta" \
  "## Problema

O CI roda \`npm run lint --if-present\` no backend, mas **não existe** script \`lint\` nem
configuração de ESLint em nenhum lugar do repositório. O passo ainda tem \`continue-on-error: true\`.

O job se chama \"Lint & Test\" e nunca fez lint em nenhum commit.

## Critério de aceite

- [ ] \`npm run lint\` existe e falha de verdade quando há problema
- [ ] O passo do CI não tem \`continue-on-error\`

Resolvido em conjunto com a adoção do Biome.$RODAPE"

criar_issue \
  "Remover artefatos de trabalho versionados na raiz" \
  "tipo:correcao,area:infra,prioridade:media" \
  "## Problema

Estão versionados sem motivo:

- \`full_diff.patch\` (40 KB)
- \`lines.txt\`
- \`fix_cicd.py\`
- \`debug-db.js\`
- \`portal-responsavel/%TEMP%/portal_verify.css\` — diretório criado por expansão falha de variável de ambiente no Windows
- \`portal-responsavel/dist/\` — build commitado

## Critério de aceite

- [ ] Artefatos removidos do versionamento
- [ ] \`.gitignore\` cobre \`dist/\`, \`*.patch\` e \`%TEMP%\`
- [ ] Build do portal continua funcionando$RODAPE"

# ---- Melhorias ----

criar_issue \
  "Aplicar skeleton, lazy loading e motion em toda a interface" \
  "tipo:melhoria,area:ux,prioridade:alta" \
  "## Problema

Auditoria da interface encontrou:

- **Zero** ocorrências de \`loading=\"lazy\"\` nas 66 páginas HTML
- Nenhum sistema unificado de skeleton — telas em branco durante carregamento
- Transições usando \`ease\` puro, sem curva customizada
- Movimento sem tratamento consistente de \`prefers-reduced-motion\`

## Solução

Sistema em \`css/motion.css\` + \`js/motion.js\`, seguindo a skill \`design-motion-principles\`
com weighting **Emil (primário) · Jakub (secundário)** — SaaS administrativo de uso diário.

Ver \`docs/MOTION.md\`.

## Critério de aceite

- [ ] Skeleton em todo estado de carregamento, nunca spinner solto ou tela em branco
- [ ] \`loading=\"lazy\"\` + \`decoding=\"async\"\` em imagens abaixo da dobra
- [ ] Entrada/saída com os tokens de motion; saída mais sutil que a entrada
- [ ] \`prefers-reduced-motion\` respeitado em 100% do movimento
- [ ] Nenhuma animação de \`width\`/\`height\`/\`top\`/\`left\`
- [ ] Ações de alta frequência e atalhos de teclado não animam$RODAPE"

criar_issue \
  "Corrigir o alcance da suíte de testes e da cobertura" \
  "tipo:melhoria,area:backend,prioridade:alta" \
  "## Problema

A suíte é grande — **60 arquivos** em \`backend/src/tests/\`. Os problemas são de alcance:

1. \`backend/tests/integration.test.js\` **nunca roda**: o \`testMatch\` do Jest é
   \`**/src/tests/**/*.test.js\` e esse arquivo está fora de \`src/\`. Ele existe, passa
   despercebido e dá falsa sensação de cobertura de integração.
2. \`collectCoverageFrom\` cobre só \`src/controllers\` e \`src/middleware\`.
   \`src/services\`, \`src/utils\` e \`src/observability\` ficam invisíveis no relatório.
3. \`coverageThreshold\` global é de 50% de linhas, sem gate por diretório.

## Critério de aceite

- [ ] \`backend/tests/integration.test.js\` roda (movido para \`src/tests/\` ou \`testMatch\` ajustado)
- [ ] \`collectCoverageFrom\` inclui \`src/services\`, \`src/utils\` e \`src/observability\`
- [ ] Cobertura mínima de 60% em \`src/controllers\` e \`src/services\`
- [ ] Gate de cobertura ativo no Codecov$RODAPE"

criar_issue \
  "Endurecer o gate de segurança do CI" \
  "tipo:melhoria,area:infra,prioridade:media" \
  "## Problema

No job \`security\`, \`npm audit\` roda com \`continue-on-error: true\` e o Trivy com \`exit-code: \"0\"\`.
Nada reprova. O próprio workflow documenta isso como dívida consciente, à espera de triagem.

## Critério de aceite

- [ ] Vulnerabilidades CRITICAL/HIGH existentes triadas
- [ ] Trivy com \`exit-code: \"1\"\` depois da triagem
- [ ] \`npm audit --audit-level=high\` sem \`continue-on-error\`$RODAPE"

criar_issue \
  "Zerar a dívida de lint acumulada" \
  "tipo:melhoria,area:infra,prioridade:alta" \
  "## Contexto

O repositório nunca teve lint — nem ESLint, nem Prettier. O Biome já foi configurado e
está rodando; a primeira execução mediu o passivo:

\`\`\`
831 erros · 758 avisos · 423 infos  —  em 450 arquivos
\`\`\`

Toda essa dívida é anterior à existência de lint no projeto.

## Estratégia

Ligar o gate completo de uma vez reprovaria 100% dos PRs no primeiro dia, e o resultado
prático seria o time desligar o lint. Por isso o CI hoje:

- **trava** o PR por problema em arquivo alterado (\`biome check --changed\`)
- **reporta sem travar** o lint completo, para a dívida ficar visível

## Critério de aceite

- [x] \`biome.json\` na raiz cobrindo \`js/\`, \`backend/src/\` e \`portal-responsavel/src/\`
- [x] \`npm run lint\`, \`lint:changed\` e \`format\` funcionando
- [x] Gate incremental no CI + hook de pre-commit
- [ ] Dívida zerada por área (comece por \`backend/src/observability\` e \`js/\`)
- [ ] Passo do CI trocado para \`npm run lint\` completo, sem \`continue-on-error\`$RODAPE"

criar_issue \
  "Eliminar código, dependências e exports mortos com Knip" \
  "tipo:melhoria,area:infra,prioridade:media" \
  "## Problema

Suspeitas levantadas na auditoria:

- \`package.json\` da raiz declara \`@types/react\`, \`@types/react-dom\` e \`three\` — o frontend principal é vanilla
- \`js/\` tem 105 arquivos, incluindo uma pasta \`legacy/\`
- Prováveis duplicatas: \`db.js\` e \`database.js\`; \`announcement-feed-legacy.js\` e \`announcement-feed-react.js\`

## Critério de aceite

- [ ] \`npm run knip\` sem achados não justificados
- [ ] Dependências não usadas removidas
- [ ] Duplicações resolvidas ou documentadas$RODAPE"

criar_issue \
  "Medir a qualidade real dos testes com Stryker" \
  "tipo:melhoria,area:backend,prioridade:media" \
  "## Problema

Cobertura de linha não diz se o teste **verifica** alguma coisa. Teste mutante mede isso.

## Critério de aceite

- [ ] \`npm run test:mutation\` rodando sobre \`backend/src/services\`
- [ ] Score de mutação inicial registrado como baseline
- [ ] Threshold de quebra definido$RODAPE"

criar_issue \
  "Impor o contrato de arquitetura em camadas" \
  "tipo:melhoria,area:backend,prioridade:media" \
  "## Problema

Nada impede hoje um \`model\` importar um \`controller\`, ou uma rota conversar direto com o banco
pulando o service. A estrutura de camadas existe por convenção, não por contrato.

## Critério de aceite

- [ ] \`.dependency-cruiser.cjs\` com as regras de camada (routes → controllers → services → models)
- [ ] \`npm run arch\` reprova violação
- [ ] Violações existentes corrigidas ou registradas como exceção com prazo$RODAPE"

criar_issue \
  "Documentar o processo de release e hotfix" \
  "tipo:melhoria,area:infra,prioridade:baixa" \
  "## Critério de aceite

- [ ] \`CONTRIBUTING.md\` descreve o release \`develop\` → \`main\`
- [ ] Fluxo de hotfix de produção documentado, incluindo a sincronização \`main\` → \`develop\`$RODAPE"

# ---- Novas funções ----

criar_issue \
  "Instrumentar o sistema com observabilidade" \
  "tipo:nova-funcao,area:backend,prioridade:alta" \
  "## Problema

Não existe nenhuma instrumentação no sistema. Quando algo quebra em produção, a única fonte é
o log do Render. Não há trace, métrica, alerta nem agrupamento de erro.

## Solução

Hub em \`backend/src/observability/\`, com **OpenTelemetry** como base vendor-neutral e
**Sentry**, **Datadog** e **New Relic** plugáveis por variável de ambiente — desligados por padrão.

Ver \`docs/OBSERVABILITY.md\`.

## Critério de aceite

- [ ] OpenTelemetry gerando traces de HTTP, Express e MongoDB
- [ ] Sentry capturando exceções de backend e de frontend
- [ ] Datadog e New Relic ativáveis por env, desligados por padrão
- [ ] Nenhuma PII de aluno/responsável enviada aos provedores
- [ ] Endpoint de health/readiness reportando o estado dos provedores$RODAPE"

criar_issue \
  "Cobrir os fluxos críticos com testes end-to-end (Playwright)" \
  "tipo:nova-funcao,area:frontend,prioridade:alta" \
  "## Problema

Não há teste end-to-end. Regressão em login ou em lançamento de frequência só aparece em produção.

## Critério de aceite

- [ ] Playwright configurado com projetos desktop e mobile
- [ ] E2E de login, dashboard, lançamento de frequência e portal do responsável
- [ ] Rodando no CI com relatório publicado como artefato
- [ ] Verificação de acessibilidade e de \`prefers-reduced-motion\` nos fluxos$RODAPE"

criar_issue \
  "Bloquear no CI o PR que não referencia Issue" \
  "tipo:nova-funcao,area:infra,prioridade:alta" \
  "## Problema

A regra central de \`AGENTS.md\` — todo PR menciona a Issue — depende hoje de disciplina humana.
Precisa ser executável.

## Critério de aceite

- [ ] Job \`pr-policy\` reprova PR sem \`Closes #\`/\`Refs #\` na descrição
- [ ] Valida também o padrão do nome da branch e o título em Conventional Commits
- [ ] Mensagem de erro explica como corrigir$RODAPE"

criar_issue \
  "Ativar proteção de branch e CODEOWNERS" \
  "tipo:nova-funcao,area:infra,prioridade:media" \
  "## Problema

\`main\` e \`develop\` aceitam push direto. O fluxo de PR é opcional na prática.

## Critério de aceite

- [ ] \`main\` e \`develop\` protegidas contra push direto
- [ ] PR exige CI verde e uma aprovação
- [ ] \`.github/CODEOWNERS\` definindo revisores por área$RODAPE"

criar_issue \
  "Publicar dashboard de saúde do sistema" \
  "tipo:nova-funcao,area:infra,prioridade:media" \
  "Depende da Issue de observabilidade.

## Critério de aceite

- [ ] Painel com latência, taxa de erro e disponibilidade por rota
- [ ] Alerta de erro em produção chegando ao canal do time$RODAPE"

echo
echo "Pronto."
$DRY_RUN && echo "(dry-run: nada foi criado)"
echo "Issues: https://github.com/$REPO/issues"
