# Observabilidade

Hub em [`backend/src/observability/`](../backend/src/observability/).
Ponta do navegador em [`js/observability.js`](../js/observability.js).

---

## Princípio

**Todo o sistema fala com um módulo só.** Nada no código chama Sentry, Datadog,
New Relic ou OpenTelemetry diretamente:

```js
const obs = require('../observability');
```

Trocar de fornecedor é mexer em `observability/`, não em duzentos call sites.

### Divisão de papéis

| Camada | Papel | Por quê |
|--------|-------|---------|
| **OpenTelemetry** | Traces e métricas | Padrão aberto. O mesmo OTLP exporta para Datadog, New Relic, Grafana ou Honeycomb sem reescrever instrumentação |
| **Sentry** | Exceções, agrupamento, release health | É o melhor no que faz; APM não é o forte dele |
| **Datadog** | APM + infraestrutura | Se a escola já usa Datadog |
| **New Relic** | APM alternativo | **Não rode junto com Datadog em produção** — dois agentes fazendo monkey-patch disputam os mesmos módulos |

### Tudo desligado por padrão

Um provedor só inicializa quando **a flag está em `true` E a credencial existe**.
Em `NODE_ENV=test` nada inicializa, mesmo com as variáveis preenchidas — senão a
suíte passaria a depender de rede e a poluir o painel com dado falso.

Os pacotes npm são **opcionais**: se não estiverem instalados, a camada não liga e o
servidor sobe normalmente. Observabilidade que impede o sistema de subir é pior que
a falta dela — a escola ficaria sem sistema por causa do painel.

---

## Instalação dos SDKs

Nenhum SDK vem instalado. Instale só o que for usar:

```bash
# OpenTelemetry (a base — comece por aqui)
npm run obs:install:otel

# Sentry
npm run obs:install:sentry

# Datadog
npm run obs:install:datadog

# New Relic
npm run obs:install:newrelic
```

Depois preencha as variáveis (ver `.env.example`) e ligue a flag.

---

## Uso

### Tracing

```js
const obs = require('../observability');

await obs.withSpan('matricula.criar', { escolaId }, async (span) => {
    span.setAttribute('turma', turmaId);
    return Matricula.create(dados);
});
```

Sem o OTel instalado, `withSpan` vira no-op e executa a função normalmente —
o call site é idêntico nos dois casos.

Para anexar atributos ao span já ativo:

```js
obs.annotate({ 'aluno.serie': serie });
```

### Exceções

```js
try {
    await enviarBoletim(alunoId);
} catch (err) {
    obs.captureException(err, { rota: 'POST /api/boletins', alunoId });
    throw err;
}
```

Erros 5xx que chegam ao handler global já são reportados automaticamente pelo
middleware — não precisa capturar de novo.

**4xx não é reportado.** Erro de uso não é defeito do sistema; reportar tudo
transformaria o painel em lixo e estouraria a cota.

### Identidade

```js
obs.setUser(req.user);
```

Envia **apenas** `id`, `perfil` e `escolaId`. Nunca nome, e-mail ou documento.

---

## Quem é dono do encerramento do processo

**`backend/src/index.js` é o único dono da política de encerramento.** Ele
registra os handlers de `uncaughtException` e `unhandledRejection` que decidem
se o processo sai.

A observabilidade **também** registra listeners nesses dois eventos, mas o papel
dela ali é só reportar. A distinção importa porque registrar um listener nesses
eventos **substitui o comportamento padrão do Node**, não o preserva — e o
comentário que vivia em `observability/index.js` afirmava exatamente o oposto
(Issue #129):

| Evento | Sem listener | Com listener registrado |
|---|---|---|
| `uncaughtException` | imprime o stack e sai com 1 | **não sai** — segue rodando |
| `unhandledRejection` | derruba o processo (padrão desde o Node 15) | **não derruba** — segue rodando |

### O repasse é explícito

`observability.init()` roda na **primeira linha do processo**. Os handlers do
`index.js` só entram **depois do `app.listen`** — e entre um ponto e outro
passam `connectDB`, o cache, os códigos secretos, a migração de voz e o
alinhamento de retenção. Nessa janela, só o listener da observabilidade
existiria: com ela ligada, uma exceção no boot seria reportada e **engolida**, e
o boot continuaria a partir de um passo que falhou.

Por isso o repasse é explícito, e não implícito na ordem dos arquivos:

```js
// observability/init() — arma a saída padrão que o próprio listener suprimiu
saidaPadraoArmada = true;

// src/index.js, depois do listen — assume a política
observability.assumirEncerramento();
```

Armada, a observabilidade **reporta e encerra como o Node faria** (stack em
`stderr`, saída 1). Desarmada, ela volta a **só reportar**. Nenhum dos dois
estados engole exceção.

Se um dia o `index.js` deixar de chamar `assumirEncerramento()`, o pior caso é
o processo encerrar como o Node encerraria — nunca ficar de pé em estado
inconsistente.

---

## PII: a regra que não se negocia

> Nunca sai daqui CPF, RG, endereço, telefone, e-mail, nome ou data de
> nascimento de aluno, responsável ou professor.

Isso vale em dobro para provedor externo: log interno fica no Render, evento de
APM fica num terceiro, sob outra jurisdição.

[`scrub.js`](../backend/src/observability/scrub.js) é a barreira, e reaproveita o
`utils/logSanitizer` que já é a fonte de verdade de masking do sistema — em vez de
manter uma segunda lista que sairia de sincronia.

O que ele faz em todo evento:

- Remove chave sensível por nome (`cpf`, `endereco`, `telefone`, `nome`, `senha`, …)
- Mascara CPF, e-mail e telefone em texto livre, inclusive dentro de mensagem de erro
- Limpa querystring: `?cpf=123…` vira `?cpf=[REDACTED]`
- Descarta `cookies`, `authorization` e corpo da requisição
- Reduz a identidade a `id` + `perfil` + `escolaId`

**Se a higienização falhar, o evento não sai.** Vazar é pior que perder telemetria.

---

## Frontend

`js/observability.js` captura `error` e `unhandledrejection` e envia para
`POST /api/observability/frontend-error`.

**Não carrega SDK de terceiro**, por dois motivos:

1. **CSP** — o backend trava `script-src` em `'self'` + hashes SHA-256 dos inline
   (`backend/src/utils/cspHashes.js`). Script de CDN não executaria, e afrouxar a
   CSP para caber um SDK de APM seria trocar segurança real por observabilidade.
2. **Privacidade** — encaminhando pelo backend, o mesmo scrub se aplica ao que sai
   do navegador, e o DSN não vai para o HTML.

Proteções: teto de 10 eventos por sessão, deduplicação por mensagem, lista de ruído
conhecido (`ResizeObserver loop`, `Script error`, `AbortError`) e limite de 30
requisições por minuto por IP no servidor.

Reporte manual de erro já tratado:

```js
Observability.captureException(err, { contexto: 'salvar-nota' });
```

---

## Correlação

Toda resposta traz o header **`X-Trace-Id`**. É o número que o usuário informa no
suporte e que amarra log ↔ trace ↔ evento de erro.

```js
const res = await fetch('/api/notas', { method: 'POST', body });
const traceId = Observability.traceIdDaResposta(res);
```

No backend: `obs.currentTraceId()`.

---

## Health

```
GET /api/health/observability
```

```json
{
  "ok": true,
  "observabilidade": {
    "enabled": true,
    "env": "production",
    "release": "a1b2c3d",
    "providers": ["otel", "sentry"],
    "otel":     { "active": true,  "reason": null },
    "sentry":   { "active": true,  "reason": null },
    "datadog":  { "active": false, "reason": "dd-trace não instalado" },
    "newrelic": { "active": false, "reason": null }
  }
}
```

Diz **quais** provedores estão ligados e por que os outros não estão. Nunca
expõe DSN, chave ou endpoint — o retorno é público.

---

## Checklist para código novo (AGENTS.md §9)

- [ ] Operação relevante dentro de um `withSpan`
- [ ] Erro capturado vai para `obs.captureException`, não só `console.error`
- [ ] Nenhuma PII em atributo de span, contexto ou mensagem
- [ ] 4xx não é reportado como exceção
