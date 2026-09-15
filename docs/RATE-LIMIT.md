# Rate limit e proteção contra abuso da API

Issue #333. Código em:

| Peça | Arquivo |
|------|---------|
| Limitadores (global, por endpoint, TTS, chat, IA…) | [`backend/src/middleware/rateLimiters.js`](../backend/src/middleware/rateLimiters.js) |
| Força bruta no login e bloqueio progressivo | [`backend/src/middleware/protecaoLogin.js`](../backend/src/middleware/protecaoLogin.js), [`services/protecaoAbuso/BloqueioIpService.js`](../backend/src/services/protecaoAbuso/BloqueioIpService.js) |
| Contador compartilhado no MongoDB | [`services/protecaoAbuso/StoreMongoRateLimit.js`](../backend/src/services/protecaoAbuso/StoreMongoRateLimit.js) |
| IP real do cliente e proxies confiáveis | [`backend/src/utils/ipCliente.js`](../backend/src/utils/ipCliente.js) |
| Variáveis de ambiente e padrões | [`backend/src/config/rateLimit.js`](../backend/src/config/rateLimit.js) |

As rotas **fora** de `/api` (páginas, estáticos, scanner, bot) são assunto da
proteção de borda da Issue #332.

---

## As camadas

Uma requisição a `/api` passa, nesta ordem:

1. **Teto global** (`globalLimiter`): 100 requisições/min por IP para quem não
   está autenticado, 200/min por conta para quem está. A conta sai do JWT com a
   assinatura verificada; token inválido ou forjado conta pelo IP. `/api/health`
   fica de fora.
2. **Regras por endpoint** (`RATE_LIMIT_ROTAS`), se houver alguma.
3. **Tetos específicos** que já existiam: códigos de 6 dígitos, recuperação de
   senha, cadastro, TTS, chat, IA, importação e moderação. Os números não mudaram.
4. **Login** (`POST /api/auth/login`): proteção por IP que conta só a tentativa
   que falha, com bloqueio progressivo, seguida do teto por conta
   (`authContaLimiter`) e do bloqueio de conta do próprio controller (`lockUntil`).

Toda recusa responde `429` com `Retry-After`, os cabeçalhos `RateLimit-*` e o
corpo no contrato que o front já trata:

```json
{ "success": false, "codigo": "MUITAS_TENTATIVAS", "retryEmSegundos": 900, "error": "..." }
```

> Até esta Issue o teto global **nunca rodou**: ele é montado em
> `app.use('/api', …)` e pulava quando `!req.path.startsWith('/api')`, mas dentro
> de um middleware montado em `/api` o Express entrega `req.path` sem o prefixo.
> Há teste de regressão para isso em `rateLimitGlobal.test.js`.

---

## Login: força bruta e bloqueio progressivo

- Conta só resposta **401** (credencial errada). Login certo, escolha de escola e
  desafio de 2FA devolvem a tentativa.
- A tentativa é contada **antes** do login rodar, na mesma operação que verifica
  o bloqueio. Uma rajada paralela não passa do teto esperando o contador
  atualizar.
- Tentativa feita durante o bloqueio não conta para depois do prazo.
- **5 falhas em 15 min** bloqueiam o IP. O bloqueio dobra a cada reincidência e
  para no teto:

  | Bloqueio | 1º | 2º | 3º | 4º | 5º | 6º | 7º em diante |
  |----------|----|----|----|----|----|----|--------------|
  | Duração  | 15 min | 30 min | 1 h | 2 h | 4 h | 8 h | 16 h, depois 24 h (teto) |

- A reincidência é esquecida depois de 24 h sem bloqueio.
- **Nada é permanente.** Todo bloqueio tem data para acabar e o registro some
  sozinho (índice TTL em `bloqueios_ip.expiraEm`). O evento fica na auditoria como
  `LOGIN_IP_BLOQUEADO`; a partir do 3º nível, também como alerta `BRUTE_FORCE_IP`.
- No log estruturado o IP aparece como hash com sal do processo, nunca em claro.

### A escola sai por um IP só

É o falso positivo mais provável: cinco erros de senha somados na sala dos
professores bloqueiam a escola inteira. Duas saídas:

- **Na hora:** o admin remove o bloqueio (abaixo). Isso zera também a reincidência.
- **De vez:** colocar o IP fixo da escola em `RATE_LIMIT_IPS_LIVRES`. Esse IP
  deixa de entrar no bloqueio por IP; o bloqueio por **conta** continua valendo
  para cada pessoa.

### Rotas administrativas (perfil admin)

```bash
# O que o servidor enxerga da SUA requisição (confira depois de mexer em TRUST_PROXY)
GET    /api/admin/seguranca/diag-ip

# Bloqueios ativos, com tempo restante e nível de reincidência
GET    /api/admin/seguranca/bloqueios-ip

# Remover um bloqueio (o id vem da listagem; use encodeURIComponent)
DELETE /api/admin/seguranca/bloqueios-ip/login%3A203.0.113.10
```

---

## IP real do cliente

A conexão que chega ao Node é do balanceador do Render. O IP do cliente viaja no
`X-Forwarded-For`, que o próprio cliente também consegue escrever. A cadeia é lida
da direita para a esquerda e só se atravessa salto que seja proxy **confiável**;
o primeiro endereço que não é proxy confiável é o cliente.

| `TRUST_PROXY` | Quando usar |
|---------------|-------------|
| *(vazio)* = `1` | Render: um salto, o balanceador. Mesmo valor que já rodava. |
| `2`, `3`… | Mais proxies fixos na frente (ex.: CDN + balanceador). |
| `loopback,uniquelocal` | Nginx ou balanceador na rede privada. |
| `10.0.0.0/8,cloudflare` | Lista explícita; `cloudflare` expande as faixas publicadas. |
| `false` | Servidor exposto direto, sem proxy. |
| `true` | **Recusado.** Qualquer cliente escolheria o próprio IP. |

`IP_CLIENTE_CABECALHO=cf-connecting-ip` usa o cabeçalho de IP único da CDN, mas
só quando a conexão veio de proxy confiável.

Cuidado com o atalho `cloudflare`: requisições feitas de dentro de um Cloudflare
Worker também saem dessas faixas. Por isso ele não faz parte do padrão.

**Conferir em produção:** logado como admin, abra `GET /api/admin/seguranca/diag-ip`. O
`ipResolvido` precisa ser o seu IP público. Se aparecer um endereço do
balanceador (`10.x`, por exemplo), todo mundo está dividindo o mesmo contador e a
configuração não bate com a infraestrutura. O servidor também registra uma vez no
log (`proxy.cadeiaIgnorada`) quando recebe `X-Forwarded-For` de conexão que não é
proxy confiável.

IPv6 conta pelo prefixo /64, o bloco que o provedor entrega a um assinante, e o
endereço é expandido antes (`2001:db8::1` e `2001:db8:0:0::2` são o mesmo /64).

---

## Onde ficam os contadores

No MongoDB que o sistema já usa, sem serviço novo nem custo:

- `rate_limit_contadores`: um documento por limitador e chave, com TTL no fim da janela;
- `bloqueios_ip`: falhas, bloqueio e reincidência do login, com TTL.

As atualizações são atômicas, então várias instâncias contam juntas sem perder
requisição. Se o banco cair, cada instância volta a contar na própria memória
até ele responder (aviso `ratelimit.storeFallback` no log); o limite nunca é
desligado por falha do banco. `RATE_LIMIT_STORE=memoria` força a memória local.

Custo: uma operação no banco a mais por requisição a `/api` (mais uma em cada
endpoint com teto próprio). Nenhum serviço novo e nenhuma conta nova.

---

## Variáveis

Todas opcionais. Durações sempre com unidade (`30s`, `15m`, `1h`, `2d`): número
sem unidade é recusado, porque "15" lido como segundos afrouxaria o limite sem
ninguém perceber. Valor inválido volta para o padrão com aviso no log.

| Variável | Padrão | O que faz |
|----------|--------|-----------|
| `RATE_LIMIT_GLOBAL_IP` | `100` | Teto geral por IP anônimo, por janela |
| `RATE_LIMIT_GLOBAL_USUARIO` | `200` | Teto geral por conta autenticada |
| `RATE_LIMIT_GLOBAL_JANELA` | `1m` | Janela do teto geral |
| `RATE_LIMIT_ROTAS` | *(vazio)* | Regras por endpoint, em JSON (abaixo) |
| `RATE_LIMIT_LOGIN_FALHAS` | `5` | Falhas de login por IP antes do bloqueio |
| `RATE_LIMIT_LOGIN_JANELA` | `15m` | Janela de contagem das falhas |
| `RATE_LIMIT_LOGIN_BLOQUEIO` | `15m` | Primeiro bloqueio; dobra a cada reincidência |
| `RATE_LIMIT_LOGIN_BLOQUEIO_MAX` | `24h` | Teto do bloqueio progressivo |
| `RATE_LIMIT_LOGIN_MEMORIA` | `24h` | Sem bloqueio nesse tempo, a reincidência recomeça |
| `RATE_LIMIT_IPS_LIVRES` | *(vazio)* | IPs/faixas fora do bloqueio por IP |
| `RATE_LIMIT_STORE` | `mongo` | `mongo` ou `memoria` |
| `TRUST_PROXY` | `1` | Proxies confiáveis (tabela acima) |
| `IP_CLIENTE_CABECALHO` | *(vazio)* | Cabeçalho de IP da CDN |
| `RATE_LIMIT_LOGIN_IP` | `15` | Teto por IP de forgot/reset-password (15 min) |

Fora de produção os tetos globais são 10 vezes maiores, para o desenvolvimento
local não esbarrar neles. Em teste os limitadores ficam desligados; a suíte que
testa o login real liga a proteção com `RATE_LIMIT_EM_TESTE=true`.

### Regras por endpoint

```bash
RATE_LIMIT_ROTAS='[
  {"rota": "POST /api/relatorios", "limite": 10, "janela": "1m", "chave": "usuario"},
  {"rota": "/api/exportar", "limite": 3, "janela": "1h"}
]'
```

- `rota`: `"MÉTODO /api/..."` ou só o caminho (qualquer método). Casa o caminho e
  tudo abaixo dele.
- `chave`: `ip`, `usuario` ou `usuario-ou-ip` (padrão). Regra `usuario` não conta
  o anônimo, que já está coberto pelo teto global por IP.
- Cada regra tem contador próprio e vale somada ao teto global. Regra inválida é
  ignorada com aviso no log, sem derrubar as outras.
