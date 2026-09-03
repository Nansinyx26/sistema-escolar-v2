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
| Validação forte do aceite (SMS ou Gov.br) | **Pendente** | hoje o aceite é autenticado pela sessão do responsável; ver §7 |
| Privacidade por padrão (perfil de aluno nunca público) | **Pronto** | nenhuma rota pública devolve aluno; `FileController.servePublicImage` serve **só imagem**, documento exige `authJWT` |
| Segregação de acesso por perfil e por turma | **Pronto** | [`middleware/authorize.js`](../backend/src/middleware/authorize.js), [`middleware/horizontalFilter.js`](../backend/src/middleware/horizontalFilter.js), [`utils/matrizAcesso.js`](../backend/src/utils/matrizAcesso.js) |
| Isolamento entre escolas da rede | **Pronto** | [`middleware/filtrarPorEscola.js`](../backend/src/middleware/filtrarPorEscola.js) — falha **fechada**: sem escola resolvida, responde 503 em vez de varrer a rede |
| Anonimização / direito ao esquecimento | **Parcial** | [`utils/anonimizacaoAutomatica.js`](../backend/src/utils/anonimizacaoAutomatica.js) anonimiza **usuário** inativo há 12 meses; falta o fluxo de **aluno transferido** preservando o histórico escolar exigido pela LDB |
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
| Coleção de log imutável (append-only) | **Parcial** | nenhuma rota da aplicação apaga log, mas a **imutabilidade real depende do banco**; ver §7 |
| 2FA para perfis administrativos | **Pronto** | [`utils/politica2FA.js`](../backend/src/utils/politica2FA.js), [`docs/2FA-OBRIGATORIO.md`](2FA-OBRIGATORIO.md) — padrão `diretor,secretaria` |
| Senha com hash forte | **Pronto** | bcrypt em `AuthenticationService`; códigos de backup em scrypt ([`utils/codigosBackup.js`](../backend/src/utils/codigosBackup.js)) |
| HTTPS ponta a ponta | **Infra** | terminação TLS no Render; `helmet` com HSTS no `app.js` |
| Nunca logar PII | **Pronto** | [`utils/logSanitizer.js`](../backend/src/utils/logSanitizer.js) e a regra do `CLAUDE.md` |

---

## 3. Acessibilidade digital (LBI, WCAG/eMAG)

| Exigência | Situação | Onde |
|---|---|---|
| `prefers-reduced-motion` respeitado | **Pronto** | [`docs/MOTION.md`](MOTION.md) |
| Leitor de tela, contraste, navegação por teclado | **Pendente** | não há auditoria WCAG/eMAG registrada; ver §7 |

Esta é a lacuna com maior risco de **desclassificação em licitação**: o edital
costuma exigir declaração de conformidade eMAG, e ela não se produz por
afirmação — precisa do laudo.

---

## 4. Conformidade pedagógica (LDB e INEP)

| Exigência | Situação | Onde |
|---|---|---|
| Frequência mínima de 75% (LDB, art. 24, VI) | **Pronto** | [`services/conformidade/frequenciaLdb.js`](../backend/src/services/conformidade/frequenciaLdb.js) |
| Alerta automático de infrequência | **Pronto** | `GET /api/conformidade/frequencia/alertas` |
| Comunicação obrigatória ao Conselho Tutelar (LDB, art. 12, VIII) | **Pronto** | gatilho em 30% do limite legal — 15 faltas em 200 dias letivos |
| Ficha de encaminhamento pronta para assinar | **Pronto** | `GET /api/conformidade/frequencia/:alunoId/ficha-conselho` → PDF ([`services/conformidade/fichaConselhoTutelar.js`](../backend/src/services/conformidade/fichaConselhoTutelar.js)) |
| Exportação para o Censo Escolar | **Parcial** | [`services/conformidade/educacenso.js`](../backend/src/services/conformidade/educacenso.js) aplica os códigos oficiais e aponta pendências; **não** gera o arquivo posicional do leiaute anual — ver §5 |
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

### Por que o Educacenso é "Parcial", e não "Pronto"

O leiaute do Educacenso é **posicional e muda todo ano** (o INEP publica o
caderno de instruções e o leiaute de migração a cada edição). Um módulo que
alegasse aderência a um leiaute fixo seria pior do que não existir: a escola
confiaria nele e perderia o prazo. O que está pronto é a parte que não muda e
que consome o tempo da secretaria — a **tradução para os códigos oficiais** e a
**lista de pendências por aluno** (`cor/raça`, `sexo`, `data de nascimento`,
`nacionalidade`, e o **tipo** da deficiência, sem o qual não há repasse
adicional do Fundeb). A geração do arquivo final do ano corrente é trabalho de
uma issue por edição, com o caderno do INEP na mão.

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

Parâmetros comuns: `?anoLetivo=2026` e `?diasLetivos=200` (padrão da LDB).

O professor identifica a infrequência, mas **quem comunica a autoridade é a
gestão da unidade** — por isso a ficha e as exportações ficam fora do perfil
dele, e o teste cobre esse 403.

---

## 7. O que falta — lista de trabalho

Cada item vira uma Issue, no padrão do [`AGENTS.md`](../AGENTS.md).

1. **Imutabilidade real do log** (`tipo:melhoria`). Hoje nenhuma rota apaga
   `audit_logs`, mas um usuário de banco com privilégio consegue. O reforço é de
   infraestrutura: usuário de aplicação **sem** `remove`/`update` na coleção, ou
   coleção com *time-series*/*append-only* no Atlas.
2. **Anonimização do aluno transferido** (`tipo:nova-funcao`). Apagar os
   identificadores pessoais preservando histórico escolar e estatística
   pedagógica — o direito ao esquecimento da LGPD sem violar o dever de guarda
   do histórico da LDB.
3. **Auditoria WCAG/eMAG** (`tipo:melhoria`). Leitor de tela, contraste e
   navegação por teclado, com laudo anexado — é o item que aparece em edital.
4. **Validação forte do consentimento** (`tipo:melhoria`). Código por SMS ou
   integração Gov.br do responsável, gravando `metodoValidacao` no histórico.
5. **Botão de denúncia (ECA Digital)** (`tipo:nova-funcao`). A moderação de
   conteúdo já existe ([`docs/moderacao/`](moderacao/)); falta o canal explícito
   e visível de denúncia de bullying/assédio no perfil de aluno e responsável.
6. **Arquivo do leiaute Educacenso do ano corrente** (`tipo:nova-funcao`), com o
   caderno do INEP da edição.
7. **Confirmar região dos dados** (`tipo:melhoria`). Registrar por escrito, no
   README de infraestrutura, a região do cluster Atlas e do serviço no Render —
   Portaria SGD/MGI nº 5.950/2023.

---

## 8. Testes que sustentam este documento

| Arquivo | O que fixa |
|---|---|
| [`frequenciaLdb.test.js`](../backend/src/tests/frequenciaLdb.test.js) | os gatilhos legais nas bordas (14 vs 15 faltas, 49 vs 50) |
| [`conformidadeRotas.test.js`](../backend/src/tests/conformidadeRotas.test.js) | contagem por dia, recorte por perfil e por escola, e o rastro em `AuditLog` |
| [`educacenso.test.js`](../backend/src/tests/educacenso.test.js) | códigos do INEP e a lista de pendências |
| [`dadosAbertosAnonimato.test.js`](../backend/src/tests/dadosAbertosAnonimato.test.js) | a supressão que impede reidentificação |
| [`fichaConselhoTutelar.test.js`](../backend/src/tests/fichaConselhoTutelar.test.js) | o conteúdo do documento oficial (endereço, responsáveis, dias) |
