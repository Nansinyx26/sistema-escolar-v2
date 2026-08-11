# Qualidade de código e testes

Portões que rodam no pre-commit, no CI e antes de qualquer PR (AGENTS.md §10).

| Ferramenta | Comando | O que garante | Config |
|------------|---------|---------------|--------|
| **Biome** | `npm run lint` | Lint + formatação (JS, TS, JSON) | `biome.json` |
| **dependency-cruiser** | `npm run arch` | Contrato de camadas do backend | `.dependency-cruiser.cjs` |
| **Knip** | `npm run knip` | Código, deps e exports mortos | `knip.json` |
| **Jest + Codecov** | `npm run test:coverage` | Unitário/integração + cobertura | `backend/jest.config.js`, `codecov.yml` |
| **Playwright** | `npm run test:e2e` | Fluxos ponta a ponta | `playwright.config.ts` |
| **Stryker** | `npm run test:mutation` | Qualidade real dos testes (mutação) | `stryker.conf.json` |
| **commitlint** | automático (husky) | Mensagem de commit | `commitlint.config.js` |

Atalhos:

```bash
npm run verify        # gate do dia a dia: lint incremental + arch + knip + testes
npm run verify:full   # o mesmo, com lint COMPLETO (hoje ainda reprova, ver abaixo)
```

---

## Lint: adoção incremental

O repositório nunca teve lint. A primeira execução do Biome mediu o passivo:

```
831 erros · 758 avisos · 423 infos  —  em 450 arquivos
```

Ligar o gate completo de uma vez reprovaria 100% dos PRs no primeiro dia, e o
resultado prático seria o time desligar o lint. Por isso:

- **`npm run lint:changed`** — só arquivos alterados. É o **gate** que trava o PR.
- **`npm run lint`** — tudo. Roda no CI como **relatório**, sem travar.

Quando a dívida chegar a zero, troque o passo do CI por `npm run lint` e remova o
`continue-on-error`. Rastreado na Issue *"Zerar a dívida de lint acumulada"*.

### ⚠️ Nunca coloque comentário no `biome.json`

O Biome aceita JSONC, **mas um único comentário em qualquer lugar do arquivo faz
todos os `overrides` pararem de ser aplicados — em silêncio.** Sem erro, sem aviso:
as regras simplesmente deixam de valer.

Foi assim que os overrides deste projeto ficaram inertes durante a configuração
inicial. Se o `biome.json` tem comentário, `JSON.parse` falha — use isso como teste:

```bash
node -e "JSON.parse(require('fs').readFileSync('biome.json','utf8'))" && echo OK
```

Documente o racional aqui neste arquivo, não lá.

### Por que `js/**` tem regras desligadas

Os arquivos de `js/` são **scripts clássicos** servidos direto ao navegador
(`<script src>`), não módulos. Duas consequências:

1. `"use strict"` dentro da IIFE **não é redundante** — o Biome assume contexto de
   módulo (onde strict é implícito) e erra. Remover a diretiva jogaria o código em
   sloppy mode.
2. O estilo ES5 (`var`, concatenação, sem optional chaining) é proposital, para
   alcance de navegador antigo.

As regras desligadas no override de `js/**` são **conflito de contexto, não dívida**.

---

## Contrato de arquitetura

```
routes → controllers → services → models
```

Cada camada só enxerga a de baixo. `utils`, `config` e `validation` são transversais:
qualquer camada usa, e elas não dependem de ninguém.

Regras em `error` (travam): model não sobe, service não sobe, controller não importa
rota, sem ciclos, sem dependência fantasma, sem devDependency em produção.

Regras em `warn` (só reportam) onde já existe dívida legada — sobem para `error`
conforme forem pagas.

```bash
npm run arch          # valida
npm run arch:graph    # diagrama em docs/arquitetura.svg (precisa do graphviz)
```

---

## Cobertura

`codecov.yml` tem dois gates:

- **project: auto** — a cobertura não pode cair em relação à base
- **patch: 70%** — código **novo** vem testado. É o gate que morde no dia a dia.
- **observabilidade: 80%** — a barreira de PII precisa de cobertura alta; vazamento
  de dado de aluno é o tipo de defeito que não aparece em teste verde.

O `project` começa em `auto` e não num número fixo porque **a cobertura deste projeto
nunca foi medida**: o CI chamava `npm run coverage`, script inexistente, e o
`--if-present` fazia o passo passar em silêncio. Ver a Issue correspondente.

---

## Teste de mutação

Cobertura de linha diz que o código **rodou**, não que o teste **verifica** algo.
O Stryker altera o código de propósito (troca `>` por `>=`, remove linha, inverte
condição) e mede quantas dessas mutações a suíte pega. Mutação que sobrevive é
linha coberta sem asserção real.

Alvos iniciais: `backend/src/services`, `logSanitizer.js` e `observability/scrub.js`.

`break` está em `null` até o baseline ser medido — travar o CI antes de conhecer o
número atual só bloquearia todo mundo. Depois da primeira execução, defina um pouco
abaixo do medido e suba com o tempo.

### Como rodar

```bash
npm run test:mutation:dry   # valida a configuração sem mutar nada (~2 min)
npm run test:mutation:pii   # só a barreira de PII — alvo pequeno, valor alto
npm run test:mutation       # tudo que está em stryker.conf.json (horas)
```

No CI: workflow **🧬 Teste de mutação**, manual (`workflow_dispatch`, com campo para
escolher o alvo) e semanal aos domingos às 04:00 UTC. O relatório sai como artefato.

**Não roda em PR, de propósito.** O Stryker executa a suíte inteira *uma vez por
mutação*: só `scrub.js`, com 63 suítes, não termina em 10 minutos localmente. Amarrar
isso ao PR tornaria todo merge insuportável — e o job seria desligado em uma semana.

### Três armadilhas de configuração, já resolvidas

O Stryker não rodava. Custou três correções, todas do mesmo tipo — configuração que
não batia com o funcionamento real do sistema:

1. **Roda da RAIZ, não do `backend/`.** O sandbox precisa enxergar `js/` do frontend,
   porque `backend/src/utils/filtroPalavroes.js` faz `require('../../../js/filtro-palavroes')`.
   Rodando de dentro do backend, o módulo some e o dry run quebra.
2. **`jest` precisa estar na raiz.** É devDependency do `backend/`, e o runner do
   Stryker o resolve a partir do diretório de execução. Está em `ignoreDependencies`
   do Knip, porque de fato nada na raiz o importa.
3. **`ignorePatterns` não pode excluir `portal-responsavel/dist`.** É o que produção
   serve, e há teste que assere 200 nele. Excluí-lo do sandbox dava 404.

**Nunca use `--inPlace` aqui.** Ele dispensa o sandbox e é tentador, mas mutação
interrompida (Ctrl+C, timeout) deixa arquivo instrumentado no disco — aconteceu durante
a configuração. Com sandbox, o working tree nunca é tocado.

---

## E2E

Quatro projetos no Playwright: `chromium`, `firefox`, `mobile` (Pixel 7) e
**`reduced-motion`**.

O projeto `reduced-motion` existe porque `prefers-reduced-motion` é o tipo de regra
que entra no CSS, ninguém exercita, e quebra em silêncio na primeira refatoração. O
risco real não é a animação continuar rodando — é o conteúdo ficar preso no estado
inicial invisível e a página aparecer **vazia** para quem pediu menos movimento.

```bash
npm run test:e2e:install   # baixa os navegadores (uma vez)
npm run test:e2e
npm run test:e2e:ui        # modo interativo, melhor para escrever teste
```

O `webServer` aponta para `/` e não para `/api/health`: o health devolve 503 sem
Mongo saudável, e o Playwright ficaria esperando um 2xx que nunca chega.

---

## Estado atual

| Item | Situação |
|------|----------|
| Biome configurado e rodando | ✅ |
| Arquivos novos (motion, observabilidade, e2e) passando | ✅ 0 erros, 0 avisos |
| Suíte do backend | ✅ 60 suítes, 931 testes passando |
| Dívida de lint legada | ⚠️ 831 erros — gate incremental ativo |
| Baseline de mutação | ⏳ não medido |
| E2E | ⏳ escrito, não executado (requer `npm install`) |
| Contrato de arquitetura | ⏳ escrito, não executado (requer `npm install`) |
