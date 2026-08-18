# Alunos por Turma — cadastro individual e importação em lote

Módulo da **Secretaria** para colocar alunos dentro de uma turma, de duas formas:

- **Fluxo A — individual**: modal com autocomplete de aluno já cadastrado + formulário.
- **Fluxo B — em lote**: upload do relatório **"Relação de Alunos por Classe"** da SEDUC-SP
  (PDF exportado da SED), ou de planilha XLSX/CSV, com **pré-visualização obrigatória**
  antes de qualquer gravação.

Tela: [`html/secretaria/turma-alunos.html`](../html/secretaria/turma-alunos.html)
(acessível pelo card **Alunos por Turma** no painel da secretaria).

---

## 1. Como usar

### Adicionar um aluno

1. Abra a turma e clique em **Adicionar aluno**.
2. Se o aluno **já existe na escola**, digite 3+ letras do nome ou do RA no campo do topo e
   selecione-o. Os campos travam e a ação vira **"Vincular à turma"** — nenhum cadastro é duplicado.
3. Se não existe, preencha o formulário. O RA aceita colar com pontos e traços (a máscara limpa).
   O dígito verificador aceita `X`.
4. Se o RA já estiver cadastrado, o sistema **oferece o vínculo** em vez de recusar.

### Importar a lista da turma

1. Na SED: **Gestão Escolar → Classes → Relação de Alunos por Classe**. Selecione a classe e
   exporte em **PDF**. Envie o arquivo **sem editar**.
2. Clique em **Importar lista** e solte o arquivo (PDF, XLSX ou CSV — até 5 MB).
3. Confira a pré-visualização:
   - o badge verde **"30 de 30 alunos lidos"** confirma que a contagem bate com o campo
     `Cadastrados` do cabeçalho do relatório;
   - um **alerta amarelo** aparece quando os números divergem, ou quando o relatório parece
     ser de outra turma. **Nenhum dos dois bloqueia** — os dois pedem conferência;
   - cada linha traz um status (ver tabela abaixo) e vem marcada ou não conforme o caso.
4. Clique em **Confirmar**. Nada é gravado antes desse clique.
5. Por **24 horas** o botão **Desfazer importação** fica disponível.

### Status de cada linha

| Status | Significa | Marcada? |
|---|---|---|
| **Novo** | RA não existe na escola | ✅ cria aluno + matrícula |
| **Já cadastrado** | RA existe, mas não nesta turma | ✅ só cria a matrícula |
| **Já está na turma** | RA já matriculado aqui neste ano | ⬜ nada a fazer |
| **Divergente** | RA existe, mas nome ou nascimento diferem | ⚠️ marcada; você escolhe se atualiza o cadastro |
| **Repetido no arquivo** | RA aparece 2× no mesmo arquivo | ⚠️ só a 1ª ocorrência entra |
| **Com erro** | Campo obrigatório ausente ou inválido | ❌ não é importável |

### Desfazer

Remove **apenas o que aquele lote criou**: as matrículas do lote e os alunos que ele
cadastrou. Aluno que já existia antes da importação **nunca** é apagado, e um aluno criado
pelo lote que depois ganhou matrícula em outra turma também é preservado.

---

## 2. Arquitetura

```
backend/src/
├── services/importacaoAlunos/      ← camada PURA (sem Express, sem Mongoose)
│   ├── normalizacao.js             validação/normalização de nome, RA, data, situação
│   ├── parserPdfSeduc.js           parser do relatório da SED
│   ├── parserPlanilha.js           XLSX e CSV → mesmos registros
│   ├── leitorXlsx.js               leitor de XLSX próprio (ZIP + XML)
│   ├── classificador.js            novo/existente/divergente/erro + conferência de totais
│   └── index.js                    detecção de tipo por magic bytes + roteamento
├── controllers/SecretariaTurmaAlunosController.js
├── models/ImportacaoAlunos.js      sessão de pré-visualização, com TTL de 2 h
├── middleware/uploadImportacao.js  multer memoryStorage, 5 MB, 1 arquivo
└── utils/nomeAluno.js              normalização de nome (models/ não pode importar services/)
```

O serviço não conhece Express nem Mongoose de propósito: recebe buffer, devolve objeto.
É o que torna as armadilhas do parser testáveis sem subir banco.

### Endpoints

Todos sob `/api/secretaria`, exigindo sessão + perfil `secretaria`/`diretor`/`admin`, e todos
conferem que a `:turmaId` pertence à escola da sessão.

| Método | Rota |
|---|---|
| `GET` | `/turmas/:turmaId/alunos` |
| `POST` | `/turmas/:turmaId/alunos` |
| `DELETE` | `/turmas/:turmaId/alunos/:alunoId` |
| `GET` | `/alunos/buscar?q=` |
| `POST` | `/turmas/:turmaId/alunos/importar/preview` *(multipart, campo `arquivo`)* |
| `POST` | `/turmas/:turmaId/alunos/importar/:importacaoId/confirmar` |
| `POST` | `/turmas/:turmaId/alunos/importar/:importacaoId/cancelar` |
| `POST` | `/turmas/:turmaId/alunos/importar/:importacaoId/desfazer` |
| `GET` | `/turmas/:turmaId/alunos/importar/historico` |

Resposta no padrão do projeto: `{ success: true, data }` ou `{ success: false, error, detalhes }`.

---

## 3. As armadilhas do parser do PDF

O texto extraído de um PDF não tem colunas — tem fragmentos na ordem em que foram desenhados.
Cada item abaixo tem teste dedicado em [`parserSeducPdf.test.js`](../backend/src/tests/parserSeducPdf.test.js).

1. **Âncora, não linha inteira.** A sequência `RA (12 dígitos) + dígito + UF + data` é o único
   trecho rígido do registro. Tudo é deduzido em volta dela.
2. **Dígito verificador pode ser `X`.** Um `\d` no lugar de `[0-9Xx]` faz esses alunos sumirem
   **em silêncio** — sem erro, sem log, simplesmente não são reconhecidos.
3. **O cabeçalho das colunas se repete a cada página** e às vezes gruda no último registro da
   página anterior. Ele é removido antes da segmentação. **O relatório oficial traz o erro de
   digitação "Defciência"** (sem o `i`); a regex tolera as duas grafias.
4. **Nome partido na quebra de página.** O final do nome pode aparecer solto no fim do
   documento. Qualquer sobra após a última âncora que pareça continuação de nome (caixa alta,
   sem dígito, duas palavras ou ligada por preposição) é reanexada, com aviso na tela.
5. **`Não` de "Não Comp." × `Não` de deficiência.** A cauda do registro é lida em ordem fixa:
   **situação (lista fechada) → data de movimentação → deficiência → transtornos**. Inverter
   essa ordem faz o `Não` de "Não Comp." ser lido como deficiência.
6. **Conferência de totais.** O `Cadastrados: N` do cabeçalho é comparado com o número de
   registros lidos. É o mecanismo de segurança mais importante do módulo: qualquer falha de
   segmentação aparece como número que não bate. **Nunca bloqueia** a importação.

### Validação do RA

Só o **formato** é validado: 12 dígitos + 1 caractere `0-9|X`. **Não existe cálculo de dígito
verificador** neste sistema, e isso é deliberado — o algoritmo do DV do RA paulista não é
público nem estável. Um aluno real recusado por um cálculo inventado é um problema muito pior
que um RA digitado errado, que a secretaria corrige na hora.

---

## 4. Segurança e LGPD

Este módulo processa dado pessoal de criança. Os pontos não negociáveis:

| Item | Como está implementado |
|---|---|
| **Isolamento de escola** | `escolaId` em toda query, sempre da sessão — nunca do corpo. A `turmaId` da URL é conferida contra a escola da sessão (fecha o IDOR). Coberto por teste. |
| **Arquivo enviado** | Lido em memória (`multer.memoryStorage`), parseado e **descartado**. Nunca vai para disco nem storage externo. `req.file.buffer` é liberado no `finally`. |
| **Tipo do arquivo** | Decidido pelos **magic bytes**, não pelo `mimetype` do multipart (que o cliente forja). |
| **Logs** | Só `importacaoId`, `escolaId`, `usuarioId`, contadores e **índice** da linha com erro. Nunca nome, RA ou nascimento. |
| **Auditoria** | `AuditLog` registra quem, quando, para qual turma, nome do arquivo, SHA-256 e contadores — sem o conteúdo. |
| **Retenção** | A pré-visualização vive **2 h** (índice TTL). Confirmada, o prazo vai a 24 h para o desfazer. Cancelar ou desfazer apaga as linhas na hora. |
| **Rate limit** | 10 uploads/hora por usuário (`RATE_LIMIT_IMPORTACAO_USUARIO`), 40/hora por IP. |
| **XSS** | A tela monta tudo por `textContent`. Não há `innerHTML` com dado vindo do arquivo. |
| **Fixtures** | 100% sintéticas. Nenhum RA, nome ou data real no repositório. |

---

## 5. Migração

```bash
cd backend
npm run migrate:up      # aplica 1771286400000-alunos-turma-importacao
npm run migrate:status  # confere
```

O que a migração faz:

1. Preenche `nomeNormalizado` nos alunos existentes, em blocos de 500. **Sem esse passo o
   autocomplete só enxerga alunos criados após o deploy.**
2. Preenche os defaults de `raUf` (`SP`), `situacao` (`ativo`) e `origemCadastro` (`manual`).
3. Cria os índices via `syncIndexes()` e **falha explicitamente** se o TTL de
   `importacoes_alunos` não tiver sido criado.

Índices novos:

| Collection | Índice | Para quê |
|---|---|---|
| `alunos` | `{ escolaId, nomeNormalizado }` | autocomplete e duplicata por nome |
| `alunos` | `{ escolaId, importacaoId }` *(parcial)* | desfazer importação |
| `matriculas` | `{ escolaId, turmaId, anoLetivo }` | listagem da tela da turma |
| `matriculas` | `{ escolaId, importacaoId }` *(parcial)* | desfazer importação |
| `importacoes_alunos` | `{ expiraEm }` **TTL** | retenção mínima (LGPD) |
| `importacoes_alunos` | `{ escolaId, turmaId, criadoEm }` | histórico de lotes |

O índice único `{ escolaId, matricula }` em `alunos` **já existia** — é a última linha de
defesa contra RA duplicado e não foi alterado.

> A migração é **idempotente**: rodar de novo não causa efeito colateral.

### A migração é testada antes de tocar produção

`backend/src/tests/migracaoAlunosTurma.test.js` roda `up()` e `down()` de verdade, contra um
MongoDB real (o in-memory da suíte). Ela verifica o que dói descobrir só no deploy:

- `nomeNormalizado` preenchido em **600** alunos — de propósito acima do bloco de 500, porque é
  na segunda volta que um cursor mal paginado vira laço infinito;
- defaults aplicados **sem sobrescrever** quem já tinha valor (um aluno vindo de importação não
  pode ser reescrito como `manual`);
- índices criados, incluindo o TTL, e o `{escolaId, matricula}` único ainda de pé;
- idempotência: a segunda execução preenche 0;
- `down()` removendo só os campos novos, com RA, nome, nascimento, código secreto e matrículas
  **intactos**;
- base vazia não quebra.

```bash
cd backend && npx jest src/tests/migracaoAlunosTurma.test.js
```

---

## 6. Rollback

**Se der problema em produção**, na ordem:

1. **Reverter o deploy** (PR de revert na `main`). O módulo é aditivo: as telas e rotas antigas
   não foram alteradas, então o sistema volta ao comportamento anterior sem mais nada.
2. **Só se for necessário reverter o schema:**
   ```bash
   cd backend
   npm run migrate:down
   ```

O `down()` remove **apenas** os campos que esta migração introduziu (`nomeNormalizado`,
`raDigito`, `raUf`, `situacao`, `dataMovimentacao`, `transtornos`, `origemCadastro`,
`importacaoId`, `Matricula.serie`), derruba os índices novos e apaga a collection
`importacoes_alunos`.

**Nada de dado real é perdido**: `matricula` (o RA), nome, nascimento, alunos e matrículas não
são tocados.

⚠️ **Uma consequência a considerar antes de rodar o `down`:** sem `importacaoId` e
`origemCadastro`, as importações já confirmadas ficam **irreversíveis** — não há mais como
distinguir o aluno que um lote criou do que já existia. Os alunos continuam existindo e
funcionando normalmente; só o botão "Desfazer" deixa de ter como agir.

### Desligar o módulo sem reverter nada

Comente as rotas do bloco **T3b** em [`backend/src/routes/secretaria.js`](../backend/src/routes/secretaria.js)
e remova o card **Alunos por Turma** do painel. O resto do sistema não depende delas.

---

## 7. Testes

```bash
cd backend
npm test                                          # suíte completa
npx jest src/tests/parserSeducPdf.test.js         # parser
npx jest src/tests/secretariaTurmaAlunos.test.js  # endpoints
npx jest src/tests/importacaoRamosDeErro.test.js  # ramos de erro
```

### `--experimental-vm-modules` é padrão do projeto

Os testes que abrem um **PDF binário de verdade** precisam desse flag. Não é limitação do
sistema — em produção a leitura funciona normalmente. É o VM do Jest que bloqueia o `import()`
dinâmico com que o `pdfjs-dist` (usado por dentro do `pdf-parse`) carrega seu worker.

Até a Issue #55 esses 3 testes ficavam num script à parte e eram **pulados no CI**. Como a
suíte inteira passa com o flag (68 suites, 1061 testes, zero pulados), ele passou a ser padrão
em `test`, `test:watch` e `test:coverage` — e o caminho de leitura de PDF passou a ser
exercitado no CI, não só localmente.

Quem invocar `npx jest` direto, sem o flag, continua vendo os 3 casos como pulados em vez de
uma falha confusa — a guarda no arquivo de teste detecta a ausência do flag.

### Dependências

Uma única dependência nova: **`pdf-parse@^2.4.5`**.

O leitor de XLSX e o de CSV são próprios. O motivo é específico: o pacote `xlsx` (SheetJS)
parou na **0.18.5** no npm, versão que carrega **CVE-2023-30533** (prototype pollution *ao
parsear planilha*) e **CVE-2024-22363** (ReDoS); as correções existem apenas fora do npm.
Colocar essa versão exatamente no caminho que ingere arquivo enviado por terceiro, contendo
dado pessoal de criança, seria trocar um problema resolvido por um risco conhecido. Ler as
quatro partes XML de que precisamos (`worksheet`, `sharedStrings`, `styles`, `workbook`) é
menos código do que auditar essa dependência — e é código que só faz o que este módulo precisa.
