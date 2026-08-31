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

### Issue #8 — o que foi medido antes de mexer

A #8 nasceu de um número: ~690 avisos de estilo. Medir de onde eles vinham mudou
completamente o que valia a pena fazer.

**A régua estava errada, e essa era a correção real.** O override de `js/**`
também forçava `"quoteStyle": "double"`, enquanto o resto do projeto usa
`"single"` — e o frontend está escrito em aspas simples. O formatador exigia
reescrever milhares de literais para contrariar a convenção do próprio código:

| régua | reescrita em `js/` |
| --- | --- |
| `single` (atual) | +9.851 / −5.993 |
| `double` (anterior) | +14.948 / −11.090 |

Remover essa única linha corta ~5.100 linhas de toda reformatação futura de
`js/`. As regras de **linter** do override continuam intactas — são conflito de
contexto, como explicado acima. Saiu só a configuração de **formatação**.

### Por que NÃO houve limpeza em massa

Nenhuma área do repositório está formatada segundo o Biome hoje:

| área | reformatação pendente |
| --- | --- |
| `backend/src` | +15.117 / −10.070 em 256 arquivos |
| `js/` | +14.961 / −11.102 em 90 arquivos |
| `portal-responsavel/src` | +3.253 / −1.467 em 38 arquivos |
| `scripts/` | +155 / −104 em 4 arquivos |

Isso tem uma consequência que não é óbvia: o `pre-commit` roda
`biome check --write --staged`, então **todo arquivo que entra em stage é
formatado por inteiro**. Aplicar as regras seguras de lint em todo o repositório
tocaria 171 arquivos por motivo cosmético — e o hook transformaria isso em
**+19.305 / −12.054**. Trinta mil linhas de mexida mecânica, `git blame` do
frontend inteiro apagado, e zero mudança de comportamento.

O gate é incremental de propósito: ele só cobra o arquivo que você tocou, e o
hook formata esse arquivo sozinho. A formatação chega arquivo a arquivo, junto
com trabalho que tem motivo próprio para existir. Forçá-la de uma vez troca um
incômodo pequeno e distribuído por um risco grande e concentrado.

**Regras seguras, para quando um arquivo for tocado por outro motivo:**
`useNodejsImportProtocol`, `useConst`, `useTemplate`, `useImportType`,
`noUnusedFunctionParameters`. Todas foram aplicadas e verificadas em uma
execução de teste (973 testes, 64 suítes, `tsc` do portal limpo) antes de serem
descartadas por causa do custo de diff. Aplique com
`--only=<regra> --javascript-formatter-enabled=false` para não arrastar a
formatação junto.

**Regras que NÃO devem ser aplicadas automaticamente, porque mudam comportamento:**

- `noGlobalIsNan` (22) — `isNaN("abc")` é `true`, `Number.isNaN("abc")` é
  `false`. Trocar onde o valor não foi convertido antes **inverte a validação**.
- `useParseIntRadix` (30) — muda o resultado de entradas com zero à esquerda.
- `noArrayIndexKey` (14) — mexe na reconciliação do React.
- `noRedundantUseStrict` (37) — ver a seção acima; aqui não é redundante.

**`noUnusedVariables` (235) fica como está — é sinal, não ruído.** O conserto
automático renomeia para `_error`. Mas 125 desses 235 são `e`, `err` e
`error`: exceções capturadas e nunca usadas, isto é, `catch` que engolem o erro
em silêncio. Renomear marcaria o engolimento como intencional e apagaria o aviso
para sempre. É o único sinal que ainda aponta para esses lugares.

### Teste que depende de formatação é teste frágil

`guiaSilenciar.test.js` comparava o **texto-fonte** de `js/onboarding-tour.js`
com `toContain("setAttribute(aria-pressed")`. Como o formatador troca aspas e
requebra chamadas longas, bastava formatar o arquivo para a suíte reprovar — com
a cara de uma regressão real, sem que nada no comportamento tivesse mudado. Foi
exatamente o que aconteceu ao testar a limpeza, e custou uma investigação inteira
até a causa aparecer.

As asserções agora colapsam os espaços antes de comparar: continuam garantindo
que a chave, o atributo e os rótulos existem no módulo, e ficam cegas a como o
arquivo está formatado.

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

## Código morto (Knip)

O Knip cruza **os três workspaces** declarados em `knip.json`: a raiz, o `backend/`
e o `portal-responsavel/`. Para o workspace do portal, ele carrega
`portal-responsavel/vite.config.ts` — que importa `vite` e `@vitejs/plugin-react`.

**Por isso o Knip exige as três instalações**, não só a da raiz:

```bash
npm run setup   # npm ci na raiz, no backend e no portal-responsavel
```

Sem a terceira, o Knip aborta no carregamento da configuração com
`ERROR: Error loading .../vite.config.ts` — e é isso que derruba `npm run verify`
num checkout limpo, sem nenhuma relação com o que a pessoa mudou.

### Achado não trava PR; erro de configuração trava

Esta distinção é feita pelo **código de saída**, e ela é sutil o bastante para ter
passado despercebida por meses (Issue #124):

| Situação | `knip --no-exit-code` sai com | No CI |
|---|---|---|
| Achou código/dependência/export morto | `0` | ✅ relatório, não trava |
| Não conseguiu carregar a configuração | `2` | ❌ reprova o job |

O `--no-exit-code` zera o código de saída dos **achados**. Ele não cobre falha de
carregamento — o processo ainda sai com 2.

O passo do CI **não tem `continue-on-error`**, de propósito. Era ele que apagava a
distinção: o passo terminava verde em 1 segundo, sem ter cruzado um único arquivo,
e o relatório de código morto que aparecia no PR era um relatório vazio por falha,
não por limpeza. Se alguém reintroduzir o `continue-on-error` para "destravar o CI",
o portão volta a ser decorativo.

### Como conferir a distinção na mão

```bash
npm run knip; echo "saida=$?"                       # achados  -> 0
mv portal-responsavel/node_modules /tmp/nm-portal
npm run knip; echo "saida=$?"                       # config   -> 2
mv /tmp/nm-portal portal-responsavel/node_modules
```

---

## Service worker: o bump do `VERSION`

O `service-worker.js` guarda os assets em **stale-while-revalidate** e depende de
um número escrito à mão (`VERSION`) para invalidar o cache. Sem trocá-lo, quem já
usou o sistema recebe o arquivo **antigo** no primeiro acesso depois do deploy.

Era um passo obrigatório, manual, sem verificação, num arquivo que quase ninguém
abre — e já foi esquecido: o commit `059577d` alterou `js/auth.js` sem bump. Não
causou dano porque outro commit bumpou antes do release; sorte de sequência, não
processo.

```bash
npm run sw:verificar            # compara com origin/develop
npm run sw:verificar -- --base origin/main
```

O gate roda no CI **em pull request** (passo `🔁 Bump do VERSION do service
worker`, no job de lint e teste), e depende do `fetch-depth: 0` do checkout para
ter com o que comparar.

### Por que aqui isso pesa mais que em outro projeto

`js/auth.js` e `js/guarda-acesso.js` estão na shell mínima. O guard é o que
impede uma página restrita em cache de aparecer sem verificação depois de um
logout ou numa troca de conta no mesmo aparelho. Servir a versão anterior desses
dois arquivos não deixa a interface feia — deixa a **checagem de acesso
desatualizada** no aparelho.

### A lista vem do próprio service worker

`scripts/verificar-bump-sw.js` extrai `STATIC_ASSETS` executando o
`service-worker.js` num contexto isolado. Não existe cópia da lista no script, e
há teste que reprova se passar a existir: uma cópia sai de sincronia no dia em
que alguém acrescenta um asset, e a verificação passaria a mentir exatamente
quando mais importa.

Caminho não escolhido, e por quê: gerar o `VERSION` a partir de um hash dos
assets no build eliminaria o passo humano de vez, mas exige um passo de build
para o service worker que hoje não existe. A verificação no CI resolve o
esquecimento a custo quase zero e não fecha a porta para isso.

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

### Baseline medido

Primeira execução real, sobre `observability/scrub.js`:

```
Score de mutação: 65,42%
70 mortos · 34 sobreviveram · 3 sem cobertura
Tempo: 58 min 40 s  ← para UM arquivo
```

Ou seja: a suíte mata dois terços das mutações naquele arquivo. Os 34 sobreviventes são
mutações que o teste não percebeu — vale olhar caso a caso, com atenção especial à
mutação de regex, porque um padrão de mascaramento quebrado passaria despercebido.

`break` segue em `null` **de propósito**: 65,42% é o número de um arquivo, e o conjunto
declarado em `mutate` (que inclui `services/**`) nunca foi medido. Cravar um limite
global a partir de uma amostra reprovaria o CI por algo que ninguém conhece. Meça o
conjunto uma vez — ou defina o limite por alvo — antes de ligar o bloqueio.

Os 58 minutos por arquivo são o motivo de não haver agendamento.

### Como rodar

```bash
npm run test:mutation:dry   # valida a configuração sem mutar nada (~2 min)
npm run test:mutation:pii   # só a barreira de PII — alvo pequeno, valor alto
npm run test:mutation       # tudo que está em stryker.conf.json (horas)
```

No CI: workflow **🧬 Teste de mutação**, **só manual** — aba *Actions* → *Run workflow*,
com campo para escolher o alvo. O relatório sai como artefato.

Não há agendamento de propósito: o repositório é privado, o GitHub Actions cobra por
minuto acima de 2.000/mês, e este job pode rodar por horas. Um agendamento semanal
consumiria a cota sozinho e a conta chegaria como surpresa.

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
