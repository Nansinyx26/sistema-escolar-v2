# Especificação Técnica — Sistema de Moderação de Conteúdo do Chat

**Sistema Escolar** · versão 1.0 · documento de especificação (sem código)

---

## 0. Ponto de partida: o que já existe

Esta spec **estende** o que está no repositório hoje. Não propõe substituir nada do que já funciona.

| Peça existente | Arquivo | Papel na moderação |
|---|---|---|
| Motor de filtro léxico isomórfico | [js/filtro-palavroes.js](../../js/filtro-palavroes.js) | Camada 1 de texto. Expõe `analisar(texto)` → `{ bloquear, nivel, termos, ocorrencias, mensagem }`, com níveis `leve` / `moderado` / `grave` |
| Ponte do backend + config por env | [backend/src/utils/filtroPalavroes.js](../../backend/src/utils/filtroPalavroes.js) | Aplica `FILTRO_PALAVROES_NIVEIS/EXTRAS/EXCECOES`; `registrarTentativa()` já loga **sem** o texto ofensivo |
| Middleware de bloqueio | [backend/src/middleware/bloquearPalavroes.js](../../backend/src/middleware/bloquearPalavroes.js) | Barra campos de `req.body` antes do controller; devolve `400 { codigo: 'CONTEUDO_IMPROPRIO' }` |
| Rotas do chat | [backend/src/routes/api.js:196-265](../../backend/src/routes/api.js#L196-L265) | `enviar`, `editar`, `encaminhar`, `upload`, `anexo/:id` |
| Upload de anexos | [backend/src/middleware/uploadChat.js](../../backend/src/middleware/uploadChat.js) + `validarAssinatura` | Lista branca de mimetypes, tetos de 10 MB / 5 MB (áudio), conferência de magic bytes |
| Persistência | [backend/src/models/ChatDireto.js](../../backend/src/models/ChatDireto.js), GridFS bucket `uploads` | Mensagem, `anexo`, `audio` |
| RBAC | [backend/src/middleware/authorize.js](../../backend/src/middleware/authorize.js) | Perfis; `admin` passa sempre |
| Isolamento multi-escola | `filtrarPorEscola` → `req.escolaId` | Toda consulta de moderação precisa herdar isso |
| Auditoria | [backend/src/models/AuditLog.js](../../backend/src/models/AuditLog.js) | Base para o log de ações de moderador |
| Rate limit | [backend/src/middleware/rateLimiters.js](../../backend/src/middleware/rateLimiters.js) | `chatMensagemLimiter`, `chatUploadLimiter`, `chatIpLimiter` |

**Lacunas que esta spec fecha:**

1. Áudio e imagem entram no chat **sem nenhuma moderação de conteúdo** — só validação de formato/tamanho.
2. `POST /chat-direto/upload` grava direto no GridFS e devolve a URL; o anexo fica **imediatamente servível** por `GET /chat-direto/anexo/:id`.
3. Não existe fila de revisão humana nem registro estruturado de ocorrências — hoje o bloqueio só vira linha de `logger.warn`.
4. Não existe canal de contestação (exigido pela cláusula 9 do Termo de Uso).
5. A resposta de bloqueio devolve `termos` e `nivel` ao cliente — útil para o front, mas entrega ao usuário exatamente qual palavra disparou o filtro (ver §5.3).

### 0.1 Barreiras já implementadas

As barreiras abaixo já estão no código. Foram escritas **antes** do que vai acioná-las, de propósito: sem elas, a primeira mensagem bloqueada continuaria saindo pelo histórico ou pelo encaminhamento, e a moderação seria enfeite.

| Barreira | Onde | Efeito hoje |
|---|---|---|
| Campo `moderacao` + índice parcial `fila_moderacao` | `models/ChatDireto.js` | Nenhum — default `'aprovada'`, sem migração |
| `getHistorico` oculta o não aprovado ao destinatário (remetente segue vendo) | `ChatDiretoController.js` | Nenhum até algo marcar uma mensagem |
| Quarentena por `metadata.moderacao.status` (409 `ANEXO_EM_ANALISE` / 403 `ANEXO_BLOQUEADO`) | `FileController.checarQuarentena` | Nenhum — arquivo sem o campo é servido |
| Encaminhamento recusa mensagem retida e devolve `ignoradas` | `ChatDiretoController.encaminharMensagem` | Nenhum |
| Modo enxuto do payload de bloqueio (§5.3) | `middleware/bloquearPalavroes.js` + rotas do chat | Chat deixa de devolver `termos`/`nivel` |
| `authorize.estrito` — admin precisa informar `escolaId` (§7.2) | `middleware/authorize.js` | Nenhum — sem consumidor ainda |

Testes: `backend/src/tests/chatDireto.moderacao.test.js` e `backend/src/tests/authorizeEstrito.test.js`.

**Falso alarme verificado, registrado para não virar "correção" indevida depois:** a legenda do anexo *não* passa sem filtro. O `POST /chat-direto/upload` recebe só `destinatarioId` + arquivos ([chat-direto-manager.js:1384-1400](../../js/chat-direto-manager.js#L1384-L1400)); o texto vai depois por `/chat-direto/enviar`, que já tem `bloquearPalavroes`.

---

## 1. Princípios de projeto

**P1 — Camada determinística primeiro, IA depois.** O léxico já existente resolve a maior parte dos casos com latência zero e custo zero. Classificador remoto é a segunda camada, para o que a lista não pega (ironia, ameaça sem palavrão, assédio).

**P2 — Fail-open para texto e áudio; fail-closed para imagem.** O código atual já escolheu fail-open no texto, e a justificativa é boa: *"o pior caso é um palavrão publicado, não o sistema fora do ar"*. Isso vale para texto e áudio. **Não vale para imagem**: uma imagem de nudez entregue é dano irreversível e potencialmente criminal, enquanto um anexo atrasado é inconveniência. Se a API de imagem falhar ou estourar timeout, o anexo fica **retido** e vai para revisão humana.

**P3 — Nunca duplicar o conteúdo sensível.** O registro de moderação aponta para a mensagem/arquivo original; não copia o texto nem o binário. É a mesma decisão já tomada em `registrarTentativa()`.

**P4 — Multi-tenant por construção.** Toda leitura da fila de moderação passa por `filtrarPorEscola`. Coordenação da escola A jamais vê ocorrência da escola B. `admin` global é a única exceção — e ela deve ser explícita, não implícita.

**P5 — Degradação, não indisponibilidade.** Provedor externo fora do ar ⇒ chat de texto continua 100% funcional (Camada 1 é in-process).

---

## 2. Moderação de texto

### 2.1 Camada 1 — léxico determinístico (já existe, síncrona, bloqueante)

Reaproveita `filtroPalavroes.analisar()`. Continua exatamente onde está: `bloquearPalavroes('mensagem')` antes do controller em [api.js:206-209](../../backend/src/routes/api.js#L206-L209).

Ajustes necessários:

- **A1** — o mesmo middleware deve cobrir também a **legenda** enviada junto com anexo (`req.body.mensagem` na rota `/chat-direto/upload`, hoje sem filtro).
- **A2** — normalização anti-evasão no motor, se ainda não coberta: *leetspeak* (`p0rr@`), separadores (`p.o.r.r.a`, `p o r r a`), repetição (`porraaaa`), homoglifos cirílicos, e remoção de diacríticos. Ponto único de mudança: [js/filtro-palavroes.js](../../js/filtro-palavroes.js), que serve front e back.
- **A3** — `encaminharMensagem` **não** precisa de filtro: ele copia documentos já persistidos e já filtrados ([ChatDiretoController.js:620-650](../../backend/src/controllers/ChatDiretoController.js#L620-L650)). Confirmado no código; registrado aqui para não virar "correção" indevida depois.

### 2.2 Camada 2 — classificador contextual (nova, assíncrona, não bloqueante)

**O que resolve:** ameaça sem palavrão (*"sei onde você mora"*), assédio, discurso de ódio velado, conteúdo sexual descritivo — coisas que lista de palavras não pega e que, se tentadas de forma síncrona, adicionariam 300–2000 ms a cada mensagem.

**Provedor sugerido:** Gemini, via a chave já configurada (`GEMINI_KEY` / `GOOGLE_TTS_API_KEY` em [config/env.js:41-42](../../backend/src/config/env.js#L41-L42)) — evita novo contrato, nova chave e novo encarregado de dados. Alternativas: OpenAI Moderation (gratuita, mas exige novo fornecedor no RIPD) ou Perspective API (bom em pt-BR para toxicidade).

**Contrato de saída esperado do classificador** (normalizado pelo adaptador, independente do provedor):

```
{
  categorias: {
    assedio: 0.0–1.0,
    odio: 0.0–1.0,
    sexual: 0.0–1.0,
    violencia: 0.0–1.0,
    autolesao: 0.0–1.0,
    ilegal: 0.0–1.0
  },
  severidade: 'nenhuma' | 'leve' | 'moderado' | 'grave',
  provedor: string,
  latenciaMs: number
}
```

**Fluxo:** mensagem persiste e é entregue normalmente → job assíncrono classifica → se `severidade >= moderado`, a mensagem é **retratada** (`moderacao.status = 'bloqueada'` ou `'em_revisao'`) e o cliente recebe evento Socket.IO `mensagem:moderada` para removê-la/tarjá-la das duas pontas.

**Trade-off explícito:** a Camada 2 é *reativa* — a mensagem chega a ser vista por alguns segundos. Torná-la síncrona é possível (flag `MODERACAO_TEXTO_SINCRONA=true`), ao custo de latência em todas as mensagens. Recomendação: assíncrona no lançamento; reavaliar com dados reais de volume e de taxa de acerto.

**Amostragem para custo:** classificar 100% das mensagens pode ser caro. Política sugerida — 100% quando o remetente tiver ocorrência nos últimos 30 dias ou for conta de aluno; amostragem de `MODERACAO_TEXTO_AMOSTRAGEM` (padrão `0.3`) nas demais; sempre 100% para mensagens com anexo.

---

## 3. Moderação de áudio

### 3.1 Pipeline

```
gravação (navegador, audio/webm)
   │
   ├─ POST /api/chat-direto/upload
   ├─ [já existe] mimetype allow-list + teto 5 MB + validarAssinatura
   │
   ├─ 1. grava no GridFS com metadata.moderacao.status = 'pendente'
   │     (o arquivo existe, mas serveFile NÃO o entrega — ver §8.3)
   │
   ├─ 2. STT: Google Speech-to-Text, pt-BR, modelo latest_short
   │     ├─ sucesso  → transcrição (texto)
   │     ├─ silêncio/ininteligível → §3.3
   │     └─ erro/timeout (8 s) → §3.4
   │
   ├─ 3. transcrição → filtroPalavroes.analisar()  ← MESMO motor do texto
   │                 → Camada 2 (classificador)     ← MESMO adaptador
   │
   ├─ 4. matriz de decisão (§4)
   │
   └─ 5. status final: 'aprovada' | 'em_revisao' | 'bloqueada'
         → Socket.IO 'anexo:liberado' ou 'mensagem:moderada'
```

**Decisão de UX:** o áudio é entregue **somente após a decisão**. Transcrição de um áudio de até 60 s leva tipicamente 1–3 s; o remetente vê o balão com indicador *"enviando…"*, comportamento já familiar de qualquer mensageiro. Entregar antes e retratar depois é pior: o destinatário já ouviu.

### 3.2 Armazenamento da transcrição

- Guardada em `audio.transcricao` **apenas se** `MODERACAO_GUARDAR_TRANSCRICAO=true` (padrão: `false`).
- Quando guardada, tem valor de produto (acessibilidade — legenda do áudio para quem não pode ouvir) e é coberta pela cláusula 8.1 do Termo, sendo excluída junto com o áudio.
- Quando **não** guardada, a transcrição existe apenas em memória durante a análise. O que persiste é somente o veredito e o hash.

### 3.3 Falso positivo / falso negativo

| Situação | Causa típica | Tratamento |
|---|---|---|
| **FP** — palavra do dicionário mal transcrita | STT confunde fonemas (*"foda" ← "sofá"*) | Exigir `confidence >= 0.75` do STT no trecho que contém o termo. Abaixo disso, não bloqueia: cai para `em_revisao` |
| **FP** — regionalismo/gíria inofensiva | Léxico amplo demais | `FILTRO_PALAVROES_EXCECOES` (mecanismo já existe) + contestação (§9) alimentando calibragem |
| **FP** — ruído classificado como grito/agressão | Classificador contextual | Camada 2 nunca decide sozinha bloqueio em áudio: `grave` da Camada 2 sem confirmação da Camada 1 vai para `em_revisao`, não para `bloqueada` |
| **FN** — palavrão sussurrado/abafado | STT não capta | Aceito. Mitigação: botão de denúncia do destinatário (§9.2) |
| **FN** — idioma não suportado | Áudio em outra língua | STT com detecção de idioma; idioma fora de `[pt-BR, es, en]` ⇒ `em_revisao` |
| **FN** — áudio sem fala | Música, ruído | Sem transcrição ⇒ não há o que filtrar ⇒ aprovado, com flag `semFala: true` no registro |

### 3.4 Timeout e falha do STT

Timeout de **8 s**. Ao estourar, ou em erro do provedor:

- áudio **não** é bloqueado (P2: fail-open para áudio);
- entra como `em_revisao` **se** o remetente for conta de aluno ou tiver ocorrência nos últimos 30 dias;
- caso contrário, é liberado com `moderacao.motivo = 'stt_indisponivel'` registrado.

Circuit breaker: 5 falhas consecutivas ⇒ modo degradado por 5 min (áudios liberados direto, com registro), evitando fila represada e chat travado.

---

## 4. Moderação de imagem

### 4.1 Onde entra

**Antes de a imagem ser servível.** Este é o ponto crítico da arquitetura atual: [uploadAnexo](../../backend/src/controllers/ChatDiretoController.js#L538) grava no GridFS e devolve a URL; `GET /chat-direto/anexo/:id` serve o arquivo autorizando por `metadata`. Sem alteração, uma imagem imprópria fica acessível assim que o upload retorna.

Solução: `metadata.moderacao.status` no GridFS + `FileController.serveFile` recusando `pendente` e `bloqueado` (§8.3). O arquivo entra no bucket em quarentena lógica.

### 4.2 Provedor

**Recomendação: Google Cloud Vision — SafeSearch Detection.** Mesma conta Google já usada para TTS/Gemini, retorna cinco eixos com escala de verossimilhança:

| Eixo SafeSearch | Uso |
|---|---|
| `adult` | Nudez / conteúdo sexual — **eixo crítico** |
| `violence` | Violência gráfica — **eixo crítico** |
| `racy` | Sugestivo (roupa íntima, pose) — eixo de revisão |
| `medical` | Ferimentos, conteúdo clínico — eixo de revisão (falso positivo comum: foto de atestado com ferimento) |
| `spoof` | Irrelevante aqui — ignorar |

Escala: `VERY_UNLIKELY` → `UNLIKELY` → `POSSIBLE` → `LIKELY` → `VERY_LIKELY`.

Alternativas: AWS Rekognition Moderation (taxonomia mais granular, novo fornecedor); Gemini Vision com prompt de classificação (mais flexível, menos determinístico, sem SLA de moderação).

### 4.3 Escopo

- **Analisadas:** `image/jpeg`, `image/png`, `image/webp`, `image/gif` (primeiro frame), `image/bmp`.
- **Não analisadas nesta fase:** vídeo (`video/*`) — custo de análise frame a frame não se justifica no volume inicial. **Mitigação obrigatória:** enquanto não houver moderação de vídeo, a direção deve poder desabilitar envio de vídeo por perfil (`MODERACAO_VIDEO_PERMITIDO`, padrão restrito a equipe escolar). Isso é uma limitação conhecida, não um esquecimento.
- **Não analisadas:** PDF, Office, ZIP. Estes seguem apenas a validação de assinatura já existente. ZIP com imagem imprópria dentro é vetor conhecido e **não coberto** — registrar como risco aceito ou desabilitar ZIP para contas de aluno.

### 4.4 Falha do provedor

**Fail-closed** (P2): timeout de 10 s ou erro ⇒ imagem fica `em_revisao`, não é entregue, e o remetente vê *"seu anexo está em análise e será entregue em breve"*. Circuit breaker aberto por 5 min após 5 falhas consecutivas — durante ele, **todas** as imagens vão para a fila humana. Isso pode gerar acúmulo; por isso a fila precisa de alerta operacional (§7.4).

---

## 5. Fluxo de decisão

### 5.1 Matriz de severidade

Severidade final = **maior** entre Camada 1 (léxico), Camada 2 (classificador) e análise de imagem.

| Severidade | Origem típica | Ação | Entrega | Fila humana |
|---|---|---|---|---|
| **CRÍTICA** | Indício de conteúdo sexual envolvendo menor; ameaça explícita à integridade física | Bloqueio + **escalonamento imediato à direção** (notificação push, não só fila) | Não | Sim, prioridade máxima |
| **GRAVE** | Léxico nível `grave`; `adult`/`violence` = `VERY_LIKELY`; classificador `grave` confirmado pela Camada 1 | Bloqueio automático | Não | Sim |
| **MODERADA** | Léxico nível `moderado`; `adult`/`violence` = `LIKELY`; `racy` = `VERY_LIKELY`; classificador `grave` **sem** confirmação | Retenção | Não, até decisão | Sim |
| **LEVE** | Léxico nível `leve`; `racy`/`medical` = `LIKELY`; classificador `moderado` | Entrega **com registro** | Sim | Não (entra em relatório agregado) |
| **NENHUMA** | — | Entrega | Sim | Não |

**Regra de agravamento por reincidência:** 3 ocorrências `LEVE`+ do mesmo usuário em 30 dias ⇒ a próxima `LEVE` é tratada como `MODERADA`. Contador em `ModeracaoOcorrencia`, calculado na análise.

**Regra de atenuação por perfil:** conteúdo enviado por `diretor`/`coordenacao`/`secretaria` classificado como `MODERADA` por eixo `medical` é entregue com registro em vez de retido — é o caso legítimo do atestado com ferimento. Não se aplica aos eixos `adult` e `violence`, nem à severidade `GRAVE`.

### 5.2 Prazo da fila

Item em `em_revisao` sem decisão em **24 h úteis**:

- se `MODERADA` ⇒ **liberado** automaticamente, com registro de "liberação por decurso de prazo";
- se `GRAVE` ou `CRÍTICA` ⇒ **permanece bloqueado** e escalona para a direção.

Sem essa regra, a fila vira um cemitério de mensagens legítimas quando a coordenação não olha o painel.

### 5.3 Feedback ao usuário

**Princípio:** dizer *que* foi bloqueado e *o que fazer*, sem ensinar *como* burlar.

| Situação | Mensagem exibida |
|---|---|
| Texto bloqueado (léxico) | *"Sua mensagem contém linguagem que não é permitida no chat da escola. Revise o texto e envie novamente."* + destaque visual do trecho |
| Texto bloqueado (classificador, pós-envio) | *"Esta mensagem foi removida por não seguir as regras de uso do chat."* + botão **Contestar** |
| Áudio bloqueado | *"Não foi possível enviar este áudio: o conteúdo não segue as regras de uso do chat."* + botão **Contestar** |
| Imagem bloqueada | *"Não foi possível enviar esta imagem: o conteúdo não segue as regras de uso do chat."* + botão **Contestar** |
| Em revisão | *"Seu envio está em análise e será entregue em breve."* |
| Provedor indisponível (imagem) | Mesma mensagem de "em análise" — **nunca** expor falha de infraestrutura |

**Ajuste no payload atual.** Hoje `bloquearPalavroes` devolve `detalhes: { campo, nivel, termos, trechos }`. Recomendação para o chat:

- **manter `trechos`** — são o texto do próprio usuário e servem para grifar o que remover (UX legítima, já implementada em [js/filtro-palavroes-ui.js](../../js/filtro-palavroes-ui.js));
- **remover `termos` e `nivel`** da resposta HTTP. `termos` entrega o gatilho exato, o que reduz a tentativa e erro necessária para achar uma grafia que escape; `nivel` revela o limiar. Ambos continuam no log servidor e no registro de ocorrência.
- Adicionar `opcoes.detalhado = false` ao middleware, aplicando o modo enxuto no chat e mantendo o comportamento atual nos demais recursos (comentários, avaliações) para não quebrar telas existentes.

**Sem sinal de tempo.** A resposta de bloqueio deve ter latência indistinguível da de sucesso: variação de tempo revela qual camada disparou.

**Notificação ao destinatário:** nenhuma. Mensagem bloqueada não gera notificação, badge de não-lida nem som — do ponto de vista do destinatário ela nunca existiu. Isso impede o uso do bloqueio como forma de assédio por notificação.

---

## 6. Registro e auditoria

### 6.1 O que **nunca** é gravado no registro de moderação

- Texto ofensivo em claro (mantém a decisão já documentada em `registrarTentativa()`)
- Transcrição do áudio (salvo o opt-in de §3.2, e mesmo assim no documento da mensagem, não no log)
- Cópia do binário da imagem
- Payload bruto de resposta do provedor externo

### 6.2 O que é gravado — coleção `moderacao_ocorrencias`

```
_id
escolaId              ← indexado; base do isolamento multi-tenant
mensagemId            ← ref ChatDireto (pode ser null se bloqueio foi pré-persistência)
gridfsId              ← ref ao arquivo, quando aplicável
tipoConteudo          'texto' | 'audio' | 'imagem'
conteudoHash          SHA-256 do texto normalizado ou do binário
                      ← permite detectar reenvio do mesmo conteúdo sem guardá-lo
remetenteId, remetentePerfil
destinatarioId
camada                'lexico' | 'classificador' | 'imagem_api' | 'denuncia'
severidade            'leve' | 'moderada' | 'grave' | 'critica'
categorias            { assedio: 0.9, odio: 0.1, ... }  ← escores, não conteúdo
termosDetectados      [ 'palavra' ]  ← só léxico; o dicionário já é público no repo
provedor, provedorLatenciaMs, provedorVersao
decisaoAutomatica     'bloqueada' | 'em_revisao' | 'entregue_com_registro'
statusAtual           'pendente' | 'mantida' | 'revertida' | 'expirada'
revisao: {
  moderadorId, moderadorPerfil, decididoEm,
  decisao: 'aprovar' | 'manter_bloqueio',
  justificativa
}
contestacao: {
  solicitadoEm, motivoUsuario, resultado, respondidoEm, respondidoPor
}
criadoEm, expiraEm    ← TTL index; ver §6.4
```

### 6.3 O que vai para `AuditLog`

Toda **ação humana**, porque é ela que precisa ser auditável para a cláusula 8.3 do Termo:

- `MODERACAO_VISUALIZAR` — moderador abriu conteúdo sinalizado (quem, qual ocorrência, quando)
- `MODERACAO_DECIDIR` — aprovou/manteve bloqueio, com justificativa
- `MODERACAO_CONTESTACAO_RESPONDER`
- `MODERACAO_CONFIG_ALTERAR` — mudança de limiar ou de lista de exceções
- `MODERACAO_EXPORTAR` — export de relatório

Visualizar conteúdo sinalizado é acesso a dado pessoal de terceiro por um funcionário: **precisa** deixar rastro.

### 6.4 Retenção

Alinhada à cláusula 8.1 do Termo:

| Registro | TTL |
|---|---|
| Ocorrência com conteúdo retido (`gridfsId` vivo) | 6 meses — depois o binário é expurgado e a ocorrência fica sem referência |
| Ocorrência sem conteúdo (só metadados) | 5 anos |
| `AuditLog` de moderação | 5 anos |

TTL index do Mongo em `expiraEm`. Job de expurgo do GridFS separado, porque TTL index não remove chunks do GridFS.

**Trava de exclusão:** ocorrência com contestação pendente ou apuração em curso recebe `expiraEm = null` (cláusula 8.6 do Termo). A rotina de expurgo deve respeitar isso explicitamente.

---

## 7. Papéis e permissões

### 7.1 Matriz

| Ação | admin | diretor | coordenacao | secretaria | professor | responsavel/aluno |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Denunciar mensagem recebida | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Contestar bloqueio próprio | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Ver fila de moderação da escola | ✔ | ✔ | ✔ | — | — | — |
| Abrir conteúdo sinalizado | ✔ | ✔ | ✔ | — | — | — |
| Aprovar / manter bloqueio | ✔ | ✔ | ✔ | — | — | — |
| Responder contestação | ✔ | ✔ | ✔¹ | — | — | — |
| Ver casos **CRÍTICOS** | ✔ | ✔ | — | — | — | — |
| Suspender chat de um usuário | ✔ | ✔ | — | — | — | — |
| Alterar limiares e exceções | ✔ | ✔ | — | — | — | — |
| Relatórios agregados | ✔ | ✔ | ✔ | — | — | — |

¹ Cláusula 9.3 do Termo exige revisor **distinto** de quem aplicou a medida contestada. Regra técnica: `contestacao.respondidoPor !== revisao.moderadorId`. Se a escola só tiver um coordenador, a contestação escala para a direção.

### 7.2 Implementação

`authorize('diretor', 'coordenacao')` + `filtrarPorEscola` em todas as rotas de `/api/moderacao/*`.

**Alerta sobre o RBAC atual:** [authorize.js:18-20](../../backend/src/middleware/authorize.js#L18-L20) libera `admin` para tudo, sem verificar escola. Para moderação isso significa que um `admin` de plataforma vê conteúdo de qualquer escola. Recomendação: exigir `escolaId` explícito na query para `admin` e registrar em `AuditLog` — acesso cross-tenant a conteúdo de menores não pode ser um efeito colateral silencioso do perfil.

### 7.3 Casos críticos

Severidade `CRÍTICA` **não** aparece na fila comum da coordenação. Vai direto para a direção, com notificação ativa (push via [NotificationService](../../backend/src/services/NotificationService.js) + e-mail), e o painel exibe o procedimento da cláusula 6.5 do Termo (comunicação a Conselho Tutelar/autoridades).

### 7.4 Alertas operacionais

- Fila com > 20 itens pendentes ⇒ alerta à direção.
- Item `MODERADA` prestes a expirar (§5.2) ⇒ lembrete 4 h antes.
- Circuit breaker aberto ⇒ alerta técnico (não ao usuário).

---

## 8. Impacto na arquitetura atual

### 8.1 Novos módulos

```
backend/src/services/moderacao/
  ModeracaoService.js        orquestrador: recebe {tipo, conteudo, contexto} → veredito
  adaptadores/
    lexicoAdapter.js         embrulha filtroPalavroes (Camada 1)
    textoClassificadorAdapter.js
    sttAdapter.js            Google STT
    imagemAdapter.js         Vision SafeSearch
  politicas/
    matrizSeveridade.js      §5.1, isolado para ser testável e ajustável
    reincidencia.js
  fila/
    moderacaoQueue.js        ver §8.5

backend/src/models/ModeracaoOcorrencia.js
backend/src/controllers/ModeracaoController.js
backend/src/routes/moderacao.js
backend/src/middleware/moderarAnexo.js   ← pós-upload, pré-resposta
```

Todo adaptador implementa a mesma interface (`analisar(entrada) → veredito normalizado`), para que trocar de provedor não toque a política de decisão.

### 8.2 Alterações no schema `ChatDireto`

```
moderacao: {
  status:     enum ['aprovada','pendente','em_revisao','bloqueada'], default 'aprovada',
  severidade: enum ['nenhuma','leve','moderada','grave','critica'],
  origem:     ['texto','audio','imagem'],
  ocorrenciaId: ObjectId,
  analisadaEm: Date
}
```

Índice novo: `{ escolaId: 1, 'moderacao.status': 1, createdAt: -1 }` — é a query da fila.

Default `'aprovada'` mantém todas as mensagens históricas visíveis sem migração de dados.

**`getHistorico` precisa mudar:** hoje devolve tudo. Passa a filtrar `moderacao.status` — o destinatário não vê `pendente`/`em_revisao`/`bloqueada`; o remetente vê as próprias, com tarja de estado. Sem esse ajuste, todo o resto da moderação é inútil, porque o histórico entrega o que o envio bloqueou.

### 8.3 Alterações no GridFS e no `serveFile`

`metadata.moderacao = { status, ocorrenciaId, analisadaEm }`.

[FileController.serveFile](../../backend/src/controllers/FileController.js) passa a recusar:

- `pendente` / `em_revisao` ⇒ `409` com `{ codigo: 'ANEXO_EM_ANALISE' }` (o front mostra o placeholder de análise)
- `bloqueado` ⇒ `403` com `{ codigo: 'ANEXO_BLOQUEADO' }` — **mesma resposta** para remetente e destinatário, para não revelar o veredito por diferença de comportamento

Ponto de atenção: `liberarAnexoPara()` (encaminhamento) adiciona destinatários ao `metadata`. Anexo com `moderacao.status !== 'aprovada'` **não pode ser encaminhado** — retornar erro em `encaminharMensagem`.

### 8.4 Alterações nas rotas ([api.js:196-265](../../backend/src/routes/api.js#L196-L265))

| Rota | Mudança |
|---|---|
| `POST /chat-direto/enviar` | Sem mudança na Camada 1. Após o controller persistir, enfileirar Camada 2 |
| `POST /chat-direto/upload` | Inserir `bloquearPalavroes('mensagem', { detalhado: false })` (legenda) e `moderarAnexo` **depois** de `receberAnexosChat`, antes de `uploadAnexo` |
| `GET /chat-direto/anexo/:id` | `serveFile` respeita §8.3 |
| `POST /chat-direto/encaminhar` | Recusa anexo não aprovado |
| `PUT /chat-direto/mensagem/:id` | Já filtrado; adicionar enfileiramento da Camada 2 |

Novas rotas, todas com `authJWT` + `filtrarPorEscola`:

```
GET   /api/moderacao/fila                      authorize('diretor','coordenacao')
GET   /api/moderacao/ocorrencia/:id            authorize('diretor','coordenacao')  → grava MODERACAO_VISUALIZAR
POST  /api/moderacao/ocorrencia/:id/decidir    authorize('diretor','coordenacao')
GET   /api/moderacao/metricas                  authorize('diretor','coordenacao')
POST  /api/moderacao/denunciar                 qualquer autenticado  + rate limit
POST  /api/moderacao/contestar                 qualquer autenticado  + rate limit
GET   /api/moderacao/minhas-contestacoes       qualquer autenticado
POST  /api/moderacao/aceite-termo              qualquer autenticado  ← cláusula 2 do Termo
GET   /api/moderacao/aceite-termo              qualquer autenticado
```

`denunciar` e `contestar` precisam de limiter próprio (sugestão: 10/hora por conta) — são vetores de abuso e de custo.

### 8.5 Fila e processamento assíncrono

**Não introduzir Redis/BullMQ nesta fase.** O deploy é single-process no Render; adicionar infraestrutura de fila é custo desproporcional ao volume esperado.

**Recomendação:** fila em MongoDB — coleção `moderacao_jobs` com `status`, `tentativas`, `proximaTentativaEm`, consumida por um worker in-process (`setInterval`, concorrência 2, backoff exponencial 1 s → 60 s, máx. 5 tentativas). Job que esgota tentativas vira `em_revisao` (fail-safe para a revisão humana, nunca descarte silencioso).

Migrar para BullMQ quando o volume passar de ~1000 análises/dia ou quando houver mais de uma instância — o `ModeracaoService` já isola essa troca atrás da interface de fila.

**Cuidado com o ambiente de teste:** o Jest só lê `backend/src/tests/` e o banco é isolado por worker; o worker in-process precisa de um kill-switch (`MODERACAO_WORKER_ATIVO=false`) para não ficar girando durante os testes.

### 8.6 Frontend

| Arquivo | Mudança |
|---|---|
| [js/chat-direto-manager.js](../../js/chat-direto-manager.js) | Estados de bolha (`em análise`, `bloqueada`); botões Denunciar/Contestar; tratar `409 ANEXO_EM_ANALISE` |
| [js/filtro-palavroes-ui.js](../../js/filtro-palavroes-ui.js) | Modo enxuto (§5.3): grifar `trechos` sem exibir `termos`/`nivel` |
| [js/realtime.js](../../js/realtime.js) | Novos eventos no socket já existente: `mensagem:moderada`, `anexo:liberado`, `moderacao:nova-ocorrencia` (só para moderadores) |
| `js/moderacao/painel.js` *(novo)* | Painel de fila |
| `html/direcao/moderacao.html` *(novo)* | Tela de fila e revisão |
| `js/termo-audio-imagem.js` *(novo)* | Modal de aceite (cláusula 2 do Termo), bloqueando os botões de áudio/imagem até o aceite |

Nota: o frontend é HTML + JS vanilla servido pelo próprio Express — não há build de React/TypeScript envolvido aqui.

### 8.7 Variáveis de ambiente (registrar em [config/env.js](../../backend/src/config/env.js))

```
MODERACAO_ATIVA                      true|false          (padrão true)
MODERACAO_MODO                       observar|aplicar    (padrão observar — ver §9.1)
MODERACAO_TEXTO_CLASSIFICADOR        none|gemini|openai  (padrão none)
MODERACAO_TEXTO_SINCRONA             false
MODERACAO_TEXTO_AMOSTRAGEM           0.3
MODERACAO_AUDIO_STT                  none|google         (padrão none)
MODERACAO_IMAGEM_PROVEDOR            none|vision         (padrão none)
MODERACAO_GUARDAR_TRANSCRICAO        false
MODERACAO_TIMEOUT_STT_MS             8000
MODERACAO_TIMEOUT_IMAGEM_MS          10000
MODERACAO_PRAZO_FILA_HORAS           24
MODERACAO_WORKER_ATIVO               true
MODERACAO_VIDEO_PERMITIDO            equipe|todos|ninguem
```

Todos com padrão que **desliga** os provedores externos: sem chave configurada, o sistema roda exatamente como hoje (só Camada 1). Nada quebra em ambiente de desenvolvimento ou em escola que não contratou os serviços.

---

## 9. Implantação

### 9.1 Fases

| Fase | Escopo | Critério de saída |
|---|---|---|
| **0** | Modelo, fila, painel, aceite do Termo, `moderacao` no ChatDireto, ajuste de `getHistorico` e `serveFile` — **nenhum provedor externo ligado** | Painel funcional com ocorrências da Camada 1 já existente |
| **1** | Imagem (`MODERACAO_MODO=observar`: analisa, registra, **não** bloqueia) | 2 semanas de dados; taxa de FP medida |
| **2** | Imagem em `aplicar` + áudio em `observar` | FP de imagem < 5% |
| **3** | Áudio em `aplicar` | FP de áudio < 5% |
| **4** | Classificador de texto (Camada 2), `observar` → `aplicar` | — |

O modo `observar` é o que permite calibrar limiares com dados reais antes de bloquear qualquer coisa de pai ou de professor. Não pular.

### 9.2 Métricas de acompanhamento

- Volume por tipo/severidade/escola
- Taxa de bloqueio automático e taxa de reversão em revisão (**> 15% de reversão ⇒ limiar mal calibrado**)
- Tempo mediano da fila
- Contestações abertas / procedentes
- Latência p50/p95 por provedor; taxa de timeout; custo por 1000 análises

### 9.3 Testes (em `backend/src/tests/`, único diretório lido pelo Jest)

- `moderacaoService.matriz.test.js` — matriz de severidade, com adaptadores mockados
- `moderacaoService.reincidencia.test.js`
- `moderacaoImagem.test.js` — inclusive timeout ⇒ fail-closed
- `moderacaoAudio.test.js` — inclusive STT indisponível ⇒ fail-open
- `moderacaoFila.test.js` — expiração por decurso de prazo
- `moderacaoPermissoes.test.js` — isolamento por escola; revisor ≠ decisor na contestação
- `chatDireto.moderacao.test.js` — `getHistorico` oculta bloqueadas; `serveFile` recusa quarentena; encaminhamento recusa anexo não aprovado

---

## 10. Riscos e decisões em aberto

| # | Questão | Recomendação |
|---|---|---|
| R1 | Custo por análise de imagem/STT em escala | Amostragem (§2.2) + teto mensal por escola; ao estourar, cair para Camada 1 apenas, com alerta |
| R2 | Transferência internacional de dados de menores para provedor de IA | Preferir região `southamerica-east1` do Google; registrar no RIPD e na Política de Privacidade. **Decisão jurídica, não técnica** |
| R3 | ZIP e vídeo não moderados | Restringir por perfil (§4.3). Risco aceito e documentado |
| R4 | `admin` com acesso cross-tenant a conteúdo de menores (§7.2) | Exigir `escolaId` explícito + `AuditLog`. Tratar como bloqueante da Fase 0 |
| R5 | Falso positivo em foto de atestado com ferimento | Atenuação por perfil (§5.1) + eixo `medical` nunca bloqueia sozinho |
| R6 | Fila abandonada em escola pequena | Liberação por decurso de prazo (§5.2) + alerta à direção (§7.4) |
| R7 | Moderação como vetor de assédio (usuário força bloqueios em série) | Rate limit em denúncia/contestação; reincidência em denúncia infundada é ocorrência própria |
| R8 | Deploy multi-instância quebra o worker in-process | Lock por documento (`findOneAndUpdate` atômico em `moderacao_jobs`) já resolve para 2–3 instâncias; acima disso, BullMQ |
