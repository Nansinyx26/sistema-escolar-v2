# Backlog de Issues

Backlog derivado da auditoria do repositório em **2026-08-09**. Cada item vira uma Issue no
GitHub seguindo o padrão de [AGENTS.md](../AGENTS.md).

Para criar tudo de uma vez (requer `gh` autenticado):

```bash
bash scripts/gh-bootstrap.sh          # cria labels + todas as Issues
bash scripts/gh-bootstrap.sh --dry-run # apenas mostra o que faria
```

Legenda de prioridade: 🔴 crítica · 🟠 alta · 🟡 média · 🟢 baixa

---

## 🐛 Correções

### C1 🔴 Corrigir job de migrations que executa script errado no deploy de dev
`tipo:correcao` `area:infra` `prioridade:critica`

`.github/workflows/ci-cd.yml` (job `migrations`) roda `npm run migrate up`. No `backend/package.json`,
`migrate` aponta para `node scripts/migrate_indexeddb_to_mongodb.js` — uma migração **one-shot** de
IndexedDB para MongoDB. O argumento `up` é ignorado. Ou seja: **toda push na `develop` reexecuta uma
migração de dado histórica contra o banco de dev**, e a migração real versionada em
`backend/migrations/1718745600000-add-deve-mudar-senha.js` nunca roda.

**Aceite**
- [ ] Existe um runner de migrations de verdade (`migrate:up` / `migrate:down`) lendo `backend/migrations/`
- [ ] O job do CI chama o runner, não o script one-shot
- [ ] `migrate_indexeddb_to_mongodb.js` renomeado para deixar claro que é histórico e manual
- [ ] Migrations são idempotentes e registram o que já aplicaram

### C2 🟠 Corrigir upload de cobertura que nunca recebe arquivo
`tipo:correcao` `area:infra` `prioridade:alta`

O CI roda `npm run coverage --if-present`, mas o script no backend chama-se `test:coverage`.
Com `--if-present`, o passo termina em sucesso **sem gerar nada**. O passo seguinte envia
`./backend/coverage/lcov.info` ao Codecov — arquivo que não existe. A cobertura nunca foi medida.

**Aceite**
- [ ] O CI chama o script correto e gera `backend/coverage/lcov.info`
- [ ] O Codecov recebe o relatório e reporta no PR
- [ ] `codecov.yml` define os gates de projeto e de patch

### C3 🟠 Corrigir passo de ESLint que nunca executa
`tipo:correcao` `area:infra` `prioridade:alta`

O CI roda `npm run lint --if-present` no backend, mas não existe script `lint` nem configuração de
ESLint em lugar nenhum do repositório. O passo ainda tem `continue-on-error: true`. O job se chama
"Lint & Test" e nunca fez lint. Resolvido pela adoção do Biome (M4).

**Aceite**
- [ ] `npm run lint` existe e falha de verdade quando há problema
- [ ] O passo do CI não tem `continue-on-error`

### C4 🟡 Remover artefatos de trabalho versionados na raiz
`tipo:correcao` `area:infra` `prioridade:media`

`full_diff.patch` (40 KB), `lines.txt`, `fix_cicd.py` e `debug-db.js` estão versionados na raiz.
Também há `portal-responsavel/%TEMP%/portal_verify.css` — um diretório criado por expansão falha de
variável de ambiente no Windows — e `portal-responsavel/dist/` (build) commitado.

**Aceite**
- [ ] Artefatos removidos do versionamento
- [ ] `.gitignore` cobre `dist/`, `*.patch` e `%TEMP%`
- [ ] Build do portal continua funcionando

---

## ✨ Melhorias

### M1 🟠 Aplicar skeleton, lazy loading e motion em toda a interface
`tipo:melhoria` `area:ux` `prioridade:alta`

Nenhuma das 66 páginas usa `loading="lazy"`. Não há sistema de skeleton unificado, e as
transições existentes usam `ease` puro em vários pontos. Entregue pelo sistema em
`css/motion.css` + `js/motion.js`, conforme [`docs/MOTION.md`](MOTION.md).

**Aceite**
- [ ] Skeleton em todo estado de carregamento
- [ ] `loading="lazy"` + `decoding="async"` em imagens abaixo da dobra
- [ ] Entrada/saída com os tokens de motion; saída mais sutil que a entrada
- [ ] `prefers-reduced-motion` respeitado em 100% do movimento
- [ ] Nenhuma animação de `width`/`height`/`top`/`left`

### M2 🟠 Corrigir o alcance da suíte de testes e da cobertura
`tipo:melhoria` `area:backend` `prioridade:alta`

A suíte é grande — **60 arquivos** em `backend/src/tests/`. Os problemas são de alcance:

1. `backend/tests/integration.test.js` **nunca roda**: o `testMatch` do Jest é
   `**/src/tests/**/*.test.js` e esse arquivo está fora de `src/`.
2. `collectCoverageFrom` cobre só `src/controllers` e `src/middleware`. `src/services`,
   `src/utils` e `src/observability` ficam invisíveis no relatório.
3. `coverageThreshold` global é de 50% de linhas, sem gate por diretório.

**Aceite**
- [ ] `backend/tests/integration.test.js` roda (movido para `src/tests/` ou `testMatch` ajustado)
- [ ] `collectCoverageFrom` inclui `src/services`, `src/utils` e `src/observability`
- [ ] Cobertura mínima de 60% em `src/controllers` e `src/services`
- [ ] Gate de cobertura ativo no Codecov

### M3 🟡 Endurecer o gate de segurança do CI
`tipo:melhoria` `area:infra` `prioridade:media`

`npm audit` e o Trivy rodam com `continue-on-error` / `exit-code: "0"`. O job "Security Scan"
não reprova nada hoje — o próprio arquivo documenta isso como dívida consciente.

**Aceite**
- [ ] Vulnerabilidades CRITICAL/HIGH existentes triadas
- [ ] Trivy com `exit-code: "1"` depois da triagem
- [ ] `npm audit --audit-level=high` sem `continue-on-error`

### M4 🟠 Zerar a dívida de lint acumulada
`tipo:melhoria` `area:infra` `prioridade:alta`
Ver também: C3

O Biome já está configurado e rodando. A primeira execução mediu o passivo:

```
831 erros · 758 avisos · 423 infos  —  em 450 arquivos
```

Toda essa dívida é anterior à existência de lint no projeto. Por isso o gate do CI
morde apenas o **código alterado no PR** (`biome check --changed`); o lint completo roda
ao lado como relatório, sem travar.

**Aceite**
- [x] `biome.json` na raiz cobrindo `js/`, `backend/src/` e `portal-responsavel/src/`
- [x] `npm run lint`, `lint:changed` e `format` funcionando
- [x] Gate incremental no CI + hook de pre-commit
- [ ] Dívida zerada por área (comece por `backend/src/observability` e `js/`)
- [ ] Passo do CI trocado para `npm run lint` completo e `continue-on-error` removido

### M5 🟡 Eliminar código, dependências e exports mortos com Knip
`tipo:melhoria` `area:infra` `prioridade:media`

A raiz declara `@types/react`, `@types/react-dom` e `three` sem uso aparente no frontend vanilla;
`js/` tem 105 arquivos com pastas `legacy/` e duplicatas (`db.js` e `database.js`,
`announcement-feed-legacy.js` e `announcement-feed-react.js`).

**Aceite**
- [ ] `npm run knip` sem achados não justificados
- [ ] Dependências não usadas removidas
- [ ] Duplicações resolvidas ou documentadas

### M6 🟡 Medir a qualidade real dos testes com Stryker
`tipo:melhoria` `area:backend` `prioridade:media`

**Aceite**
- [ ] `npm run test:mutation` rodando sobre `backend/src/services`
- [ ] Score de mutação inicial registrado como baseline
- [ ] Threshold de quebra definido

### M7 🟡 Impor o contrato de arquitetura em camadas
`tipo:melhoria` `area:backend` `prioridade:media`

Não há nada impedindo um `model` importar um `controller`, ou uma rota falar direto com o banco.

**Aceite**
- [ ] `.dependency-cruiser.cjs` com as regras de camada (routes → controllers → services → models)
- [ ] `npm run arch` reprova violação
- [ ] Violações existentes corrigidas ou registradas como exceção com prazo

### M8 🟢 Documentar o processo de release e hotfix
`tipo:melhoria` `area:infra` `prioridade:baixa`

**Aceite**
- [ ] `CONTRIBUTING.md` descreve release `develop` → `main` e o fluxo de hotfix

---

## 🚀 Novas funções

### N1 🟠 Instrumentar o sistema com observabilidade
`tipo:nova-funcao` `area:backend` `prioridade:alta`

Não existe nenhuma instrumentação hoje. Entregue por `backend/src/observability/`,
com OpenTelemetry como base e Sentry, Datadog e New Relic plugáveis por variável de ambiente.
Ver [`docs/OBSERVABILITY.md`](OBSERVABILITY.md).

**Aceite**
- [ ] OpenTelemetry gerando traces de HTTP, Express e MongoDB
- [ ] Sentry capturando exceções de backend e de frontend
- [ ] Datadog e New Relic ativáveis por env, desligados por padrão
- [ ] Nenhuma PII enviada aos provedores
- [ ] Endpoint de health/readiness reportando o estado dos provedores

### N2 🟠 Cobrir os fluxos críticos com testes end-to-end (Playwright)
`tipo:nova-funcao` `area:frontend` `prioridade:alta`

**Aceite**
- [ ] Playwright configurado com projetos desktop e mobile
- [ ] E2E de login, dashboard, lançamento de frequência e portal do responsável
- [ ] Rodando no CI com relatório publicado como artefato
- [ ] Verificação de acessibilidade e de `prefers-reduced-motion` nos fluxos

### N3 🟠 Bloquear no CI o PR que não referencia Issue
`tipo:nova-funcao` `area:infra` `prioridade:alta`

Torna executável a regra central de [AGENTS.md](../AGENTS.md).

**Aceite**
- [ ] Job `pr-policy` reprova PR sem `Closes #`/`Refs #` na descrição
- [ ] Valida também o padrão do nome da branch e o título em Conventional Commits
- [ ] Mensagem de erro explica como corrigir

### N4 🟡 Ativar proteção de branch e CODEOWNERS
`tipo:nova-funcao` `area:infra` `prioridade:media`

**Aceite**
- [ ] `main` e `develop` protegidas contra push direto
- [ ] PR exige CI verde e uma aprovação
- [ ] `.github/CODEOWNERS` definindo revisores por área

### N5 🟡 Publicar dashboard de saúde do sistema
`tipo:nova-funcao` `area:infra` `prioridade:media`
Depende de: N1

**Aceite**
- [ ] Painel com latência, taxa de erro e disponibilidade por rota
- [ ] Alerta de erro em produção chegando ao canal do time
