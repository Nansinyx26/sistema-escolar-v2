# Conformidade legal — o que a lei exige e onde isso vive no código

> Este documento é o **mapa** entre exigência legal e arquivo. Ele serve para
> duas perguntas que aparecem em edital de licitação e em auditoria da
> prefeitura: *"o sistema cumpre?"* e *"me mostre onde"*.
>
> Ele também diz, sem eufemismo, **o que ainda não está pronto**. Um mapa que
> só lista o que funciona é pior que nenhum: ele faz a rede assinar um termo de
> conformidade sobre uma lacuna que ninguém sabia que existia.

Leis consideradas: **LGPD** (13.709/2018), **ECA** (8.069/1990, incl. as
alterações do ECA Digital), **Marco Civil da Internet** (12.965/2014), **LBI**
(13.146/2015), **LDB** (9.394/1996, com a Lei 13.803/2019), **LAI**
(12.527/2011) e as exigências do **Censo Escolar/INEP**.

---

## Como ler a coluna Situação

| Símbolo | Significa |
|---|---|
| **Pronto** | implementado, com teste automatizado apontado na linha |
| **Parcial** | o mecanismo existe, mas falta cobertura ou uma ponta (tela, política, campo) |
| **Pendente** | não existe no código — está aqui para não ser esquecido |
| **Infra** | não é código deste repositório; é decisão de hospedagem/contrato |

---

## 1. Privacidade e proteção de dados (LGPD e ECA)

| Exigência | Situação | Onde |
|---|---|---|
| Consentimento do responsável, auditável | **Pronto** | [`utils/consentimentoLgpd.js`](../backend/src/utils/consentimentoLgpd.js), histórico em `Usuario.lgpdHistory` (termo, versão, data, IP, navegador) |
| Termo de áudio e imagem, assinável por qualquer perfil | **Pronto** | [`utils/termoAudioImagem.js`](../backend/src/utils/termoAudioImagem.js), [`docs/moderacao/TERMO-DE-USO-AUDIO-IMAGEM.md`](moderacao/TERMO-DE-USO-AUDIO-IMAGEM.md) |
| Termo de privacidade em linguagem simples | **Pronto** | [`html/politica-privacidade.html`](../html/politica-privacidade.html) e `portal-responsavel/src/components/PoliticaPrivacidade.tsx` |
| Caixa de aceite **desmarcada** por padrão | **Pronto** | `portal-responsavel/src/components/CompletarCadastro.tsx` e `html/termo-audio-imagem.html` |
| Validação forte do aceite | **Pronto** | código de uso único por e-mail em `POST /api/conformidade/consentimento/codigo` + `/confirmar` ([`services/conformidade/validacaoConsentimento.js`](../backend/src/services/conformidade/validacaoConsentimento.js)); `metodoValidacao` gravado em `lgpdHistory` |
| Validação por SMS ou Gov.br | **Pendente** | os dois dependem de contrato/credenciamento do município — o campo `metodoValidacao` já existe para recebê-los; ver §7 |
| Privacidade por padrão (perfil de aluno nunca público) | **Pronto** | nenhuma rota pública devolve aluno; `FileController.servePublicImage` serve **só imagem**, documento exige `authJWT` |
| Segregação de acesso por perfil e por turma | **Pronto** | [`middleware/authorize.js`](../backend/src/middleware/authorize.js), [`middleware/horizontalFilter.js`](../backend/src/middleware/horizontalFilter.js), [`utils/matrizAcesso.js`](../backend/src/utils/matrizAcesso.js) |
| Isolamento entre escolas da rede | **Pronto** | [`middleware/filtrarPorEscola.js`](../backend/src/middleware/filtrarPorEscola.js) — falha **fechada**: sem escola resolvida, responde 503 em vez de varrer a rede |
| Anonimização / direito ao esquecimento | **Pronto** | usuário inativo há 12 meses em [`utils/anonimizacaoAutomatica.js`](../backend/src/utils/anonimizacaoAutomatica.js); **aluno que saiu da rede** em [`services/conformidade/anonimizacaoAluno.js`](../backend/src/services/conformidade/anonimizacaoAluno.js) — apaga identificador e dado de saúde, preserva notas, faltas, turma e situação |
| Canal de denúncia visível (ECA Digital) | **Pronto** | `POST /api/moderacao/denunciar` aceita denúncia sem mensagem vinculada; botão no cabeçalho do perfil, do dashboard e do portal do responsável ([`js/canal-denuncia.js`](../js/canal-denuncia.js), `portal-responsavel/src/components/CanalDenuncia.tsx`) |
| Retenção de log com prazo | **Pronto** | TTL de 365 dias em `AuditLog` — acima do mínimo de 6 meses do Marco Civil |
| Soberania de dados (dados no Brasil) | **Infra** | cluster MongoDB Atlas em região brasileira e Render em região compatível; ver §7 |

### A matriz de acesso, na forma em que o setor público a cobra

| Perfil | Vê dados do aluno | Edita notas/chamada | Prontuário de saúde | Exporta dado governamental |
|---|---|---|---|---|
| Admin/TI | sim | não | não | sim |
| Secretaria/Direção | todos da escola | sim | sim | sim |
| Professor | **só as turmas dele** | só as turmas dele | alertas básicos (alergias) | não |
| Responsável/Aluno | só os próprios | não | só os próprios | não |

A coluna "Professor" é a que o código protege de forma mais visível: veja o
teste `conformidadeRotas.test.js`, caso *"professor enxerga apenas os alunos das
turmas que leciona"*, e a recusa 403 ao pedir aluno de outra turma.

---

## 2. Segurança da informação e auditoria (Marco Civil, art. 15)

| Exigência | Situação | Onde |
|---|---|---|
| Log de quem acessou, quando e o que alterou | **Pronto** | [`models/AuditLog.js`](../backend/src/models/AuditLog.js) — guarda perfil, ação, recurso, `valorAnterior`/`valorNovo`, IP, user-agent |
| Log em toda exportação de dado de aluno | **Pronto** | `ConformidadeController` grava `EXPORTAR_FICHA_CONSELHO_TUTELAR`, `EXPORTAR_EDUCACENSO` e `EXPORTAR_DADOS_ABERTOS` |
| Guarda mínima de 6 meses | **Pronto** | TTL de 365 dias (§1) |
| Coleção de log imutável (append-only) | **Pronto (aplicação)** | hooks em [`models/AuditLog.js`](../backend/src/models/AuditLog.js) recusam update, delete, replace e `save()` de documento existente |
| Imutabilidade no banco | **Infra** | usuário de aplicação com `insert`/`find` e **sem** `update`/`remove` em `audit_logs`; ver §7 |
| 2FA para perfis administrativos | **Pronto** | [`utils/politica2FA.js`](../backend/src/utils/politica2FA.js), [`docs/2FA-OBRIGATORIO.md`](2FA-OBRIGATORIO.md) — padrão `diretor,secretaria` |
| Senha com hash forte | **Pronto** | bcrypt em `AuthenticationService`; códigos de backup em scrypt ([`utils/codigosBackup.js`](../backend/src/utils/codigosBackup.js)) |
| HTTPS ponta a ponta | **Infra** | terminação TLS no Render; `helmet` com HSTS no `app.js` |
| Nunca logar PII | **Pronto** | [`utils/logSanitizer.js`](../backend/src/utils/logSanitizer.js) e a regra do `CLAUDE.md` |

---

## 3. Acessibilidade digital (LBI, WCAG/eMAG)

| Exigência | Situação | Onde |
|---|---|---|
| `prefers-reduced-motion` respeitado | **Pronto** | [`docs/MOTION.md`](MOTION.md) e o padrão da opção de movimento em [`js/acessibilidade.js`](../js/acessibilidade.js) |
| Pular para o conteúdo (WCAG 2.4.1) | **Pronto** | injetado em todas as páginas, com `tabindex="-1"` no alvo |
| Foco sempre visível (WCAG 2.4.7) | **Pronto** | `:focus-visible` em [`css/acessibilidade.css`](../css/acessibilidade.css) |
| Alto contraste | **Pronto** | escopo `[data-contraste="alto"]`, que desliga o glassmorphism |
| Redimensionamento de texto (WCAG 1.4.4) | **Pronto** | escala 100/115/130% guardada por navegador |
| Alvo de toque mínimo (WCAG 2.5.5) | **Pronto** | 44–48px nos controles do painel e do canal de denúncia |
| Auditoria com leitor de tela real + laudo eMAG | **Pendente** | ver §7 |

Os recursos estão em **todas** as páginas — a injeção é um codemod idempotente
(`scripts/inject-acessibilidade.js`), porque acessibilidade que existe em
algumas telas não cumpre a lei: ninguém escolhe por qual página entra no
sistema.

O que ainda falta é o **laudo**: o edital costuma exigir declaração de
conformidade eMAG, e ela não se produz por afirmação de quem escreveu o código.
A semântica de cada página (ordem de cabeçalhos, rótulo de formulário, texto
alternativo) continua sendo responsabilidade dela, e é isso que a auditoria com
leitor de tela real vai apontar.

---

## 4. Conformidade pedagógica (LDB e INEP)

| Exigência | Situação | Onde |
|---|---|---|
| Frequência mínima de 75% (LDB, art. 24, VI) | **Pronto** | [`services/conformidade/frequenciaLdb.js`](../backend/src/services/conformidade/frequenciaLdb.js) |
| Alerta automático de infrequência | **Pronto** | `GET /api/conformidade/frequencia/alertas` |
| Comunicação obrigatória ao Conselho Tutelar (LDB, art. 12, VIII) | **Pronto** | gatilho em 30% do limite legal — 15 faltas em 200 dias letivos |
| Ficha de encaminhamento pronta para assinar | **Pronto** | `GET /api/conformidade/frequencia/:alunoId/ficha-conselho` → PDF ([`services/conformidade/fichaConselhoTutelar.js`](../backend/src/services/conformidade/fichaConselhoTutelar.js)) |
| Exportação para o Censo Escolar (JSON auditável) | **Pronto** | [`services/conformidade/educacenso.js`](../backend/src/services/conformidade/educacenso.js) — códigos oficiais e lista de pendências por aluno |
| Arquivo de migração delimitado | **Parcial** | [`services/conformidade/leiauteEducacenso.js`](../backend/src/services/conformidade/leiauteEducacenso.js) gera o `.txt` e **recusa** lote com pendência; a ordem dos campos precisa ser conferida contra o caderno da edição — ver abaixo |
| Nunca bloquear boletim por pendência financeira | **Pronto por ausência** | o sistema não tem módulo financeiro; nenhuma rota de boletim/frequência consulta débito |

### As contas, explícitas

Para um ano letivo de **200 dias** (mínimo da LDB, art. 24, I):

```
limite de faltas   = 200 × 25%  = 50 dias   → risco crítico de reprovação
gatilho do Conselho = 50 × 30%  = 15 dias   → comunicação obrigatória
```

Dois detalhes que os testes fixam e que costumam ser implementados errado:

1. **Falta é DIA, não registro de chamada.** A escola que lança presença por
   matéria gera cinco documentos por dia. Contar documentos dispararia a
   comunicação ao Conselho com três dias de ausência.
2. **Falta justificada continua contando** para a frequência mínima. O atestado
   explica, não abona — as exceções legais (Decreto-Lei 1.044/1969, Lei
   6.202/1975) são regime domiciliar deferido pela direção, não um campo da
   chamada. A ficha marca os dias justificados com `(J)` para a secretaria
   avaliar o contexto antes de acionar o Conselho.

### O que está pronto no Educacenso, e o que exige conferência anual

Pronto e estável: a **tradução para os códigos oficiais** e a **lista de
pendências por aluno** (`cor/raça`, `sexo`, `data de nascimento`,
`nacionalidade`, e o **tipo** da deficiência, sem o qual não há repasse
adicional do Fundeb). É a parte que consome o tempo da secretaria — descobrir em
novembro que 40 alunos estão sem data de nascimento.

Pronto e **dependente de conferência**: o arquivo delimitado por `|`. O leiaute
do Educacenso muda a cada edição, então a ordem dos campos vive em
`REGISTROS`, como **dado** — atualizar para o ano é editar essa estrutura, não a
função que escreve o arquivo. O `cabecalho.versaoLeiaute` acompanha o arquivo
justamente para ninguém entregar um `.txt` montado com a referência do ano
passado sem perceber.

Duas proteções que valem citar em auditoria:

- o gerador **se recusa** a escrever com pendência (`409`, listando o que
  falta). Arquivo com aluno incompleto é declaração errada, e este é o último
  momento em que dá tempo de corrigir o cadastro;
- todo valor é sanitizado contra o separador. Um `|` digitado no campo "tipo de
  deficiência" deslocaria todas as colunas seguintes daquela linha, e o INEP
  leria "turma" no lugar de "nome".

---

## 5. Transparência sem vazamento (LAI)

| Exigência | Situação | Onde |
|---|---|---|
| Painel de dados abertos anonimizado | **Pronto** | `GET /api/conformidade/dados-abertos` ([`services/conformidade/dadosAbertos.js`](../backend/src/services/conformidade/dadosAbertos.js)) |
| Proteção contra reidentificação | **Pronto** | supressão complementar com limiar (**k = 5**) |

O ponto delicado não é esconder o nome — é a **célula pequena**. Publicar
"aprovação por turma" numa turma de 8 alunos com 1 reprovado entrega a criança
para a comunidade inteira. E esconder *uma* célula com o total publicado não
resolve: o valor volta por subtração. Por isso a supressão é iterativa — o balde
"Outros" absorve a menor célula pública até deixar de identificar alguém
(teste: *"não dá para deduzir a célula suprimida por subtração do total"*).

---

## 6. Rotas de conformidade

Todas sob `/api/conformidade`, com `authJWT` + `horizontalFilter` +
`filtrarPorEscola` ([`routes/conformidade.js`](../backend/src/routes/conformidade.js)).

| Rota | Perfis | O que devolve |
|---|---|---|
| `GET /frequencia/alertas` | professor (suas turmas), secretaria, diretor, admin | alunos que já exigem providência legal, mais graves primeiro |
| `GET /frequencia/:alunoId` | idem | apuração individual com a lista de dias faltados |
| `GET /frequencia/:alunoId/ficha-conselho` | secretaria, diretor, admin | PDF da ficha de comunicação ao Conselho Tutelar |
| `GET /educacenso` | secretaria, diretor, admin | lote do Censo com pendências (`?formato=arquivo` para baixar) |
| `GET /dados-abertos` | secretaria, diretor, admin | indicadores agregados e anonimizados |
| `GET /soberania` | secretaria, diretor, admin | onde os dados estão hospedados (§7) |
| `POST /alunos/:alunoId/anonimizar` | secretaria, diretor, admin | direito ao esquecimento; exige `{ "confirmar": true }` |
| `POST /consentimento/codigo` | qualquer titular autenticado | envia o código de confirmação por e-mail |
| `POST /consentimento/confirmar` | qualquer titular autenticado | registra o consentimento com `metodoValidacao` |

`GET /educacenso` aceita `?formato=arquivo` (JSON para download) e
`?formato=txt` (arquivo de migração delimitado; responde 409 com a lista de
pendências enquanto houver cadastro incompleto).

Parâmetros comuns: `?anoLetivo=2026` e `?diasLetivos=200` (padrão da LDB).

O professor identifica a infrequência, mas **quem comunica a autoridade é a
gestão da unidade** — por isso a ficha e as exportações ficam fora do perfil
dele, e o teste cobre esse 403.

---

## 7. O que falta — lista de trabalho

Tudo que dependia **só de código** foi implementado. O que resta depende de
laudo, de contrato ou de configuração de infraestrutura — e continua aqui
justamente para não sumir.

1. **Permissão do banco para o log de auditoria** (`tipo:melhoria`, infra). A
   aplicação já recusa update e delete em `audit_logs`, mas middleware só vale
   para quem passa pelo mongoose. O usuário de aplicação no Atlas precisa ter
   `insert` e `find` na coleção e **não** ter `update`/`remove`. O código impede
   o acidente; a permissão impede o dolo.
2. **Auditoria WCAG/eMAG com leitor de tela real** (`tipo:melhoria`). Os
   recursos estão entregues (§3); falta o laudo, que é o que o edital pede — e
   que vai apontar a semântica página a página.
3. **Validação por SMS ou Gov.br** (`tipo:nova-funcao`). Dependem de contrato
   com gateway e de credenciamento do município como serviço confiante. O campo
   `metodoValidacao` já existe e já distingue as forças de validação, então
   entrar com um deles não exige remodelar nada.
4. **Conferir o leiaute do Educacenso da edição corrente** (`tipo:melhoria`,
   anual). Abrir o caderno do INEP do ano e conferir `REGISTROS` em
   `leiauteEducacenso.js`. É trabalho de uma issue por edição, por definição.
5. **Declarar a região dos dados** (`tipo:chore`, infra). Definir `DATA_REGION`
   e `DATA_REGION_PAIS` no Render e conferir a região do cluster no Atlas. O
   boot já registra a situação e `GET /api/conformidade/soberania` responde a
   pergunta com data — enquanto não houver declaração, o log sai em nível de
   alerta.

---

## 8. Testes que sustentam este documento

| Arquivo | O que fixa |
|---|---|
| [`frequenciaLdb.test.js`](../backend/src/tests/frequenciaLdb.test.js) | os gatilhos legais nas bordas (14 vs 15 faltas, 49 vs 50) |
| [`conformidadeRotas.test.js`](../backend/src/tests/conformidadeRotas.test.js) | contagem por dia, recorte por perfil e por escola, e o rastro em `AuditLog` |
| [`educacenso.test.js`](../backend/src/tests/educacenso.test.js) | códigos do INEP e a lista de pendências |
| [`dadosAbertosAnonimato.test.js`](../backend/src/tests/dadosAbertosAnonimato.test.js) | a supressão que impede reidentificação |
| [`fichaConselhoTutelar.test.js`](../backend/src/tests/fichaConselhoTutelar.test.js) | o conteúdo do documento oficial (endereço, responsáveis, dias) |
| [`auditLogImutavel.test.js`](../backend/src/tests/auditLogImutavel.test.js) | que nenhuma escrita além de inserção passa em `audit_logs` |
| [`anonimizacaoAluno.test.js`](../backend/src/tests/anonimizacaoAluno.test.js) | a lista de campos que saem e os que ficam — inclusive a chave de busca |
| [`validacaoConsentimento.test.js`](../backend/src/tests/validacaoConsentimento.test.js) | as bordas do código de confirmação (expirado, travado, nunca pedido) |
| [`canalDenuncia.test.js`](../backend/src/tests/canalDenuncia.test.js) | gravidade por categoria e o fato de nada ser bloqueado |
| [`leiauteEducacenso.test.js`](../backend/src/tests/leiauteEducacenso.test.js) | sanitização do separador e a recusa de gerar lote incompleto |
| [`soberaniaDados.test.js`](../backend/src/tests/soberaniaDados.test.js) | o conflito entre região declarada e infraestrutura real |
