# Arquitetura de Escalabilidade e Múltiplas Instâncias

> Documentação técnica consolidada do **Épico #334** — Preparar o backend para rodar em várias instâncias atrás de um balanceador de carga.

---

## 1. Visão Geral

O Sistema Escolar foi projetado como uma aplicação **stateless** no backend. O estado volátil de sessão e coordenação foi desacoplado da memória local dos processos, permitindo que duas ou mais instâncias do backend executem simultaneamente atrás de um balanceador de carga HTTP/WebSocket (como o Render, Nginx, HAProxy ou AWS Application Load Balancer).

```
                            ┌───────────────┐
                            │ Balanceador   │
                            │ de Carga (LB) │
                            └───────┬───────┘
                                    │
               ┌────────────────────┼────────────────────┐
               ▼                    ▼                    ▼
        ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
        │ Backend #1  │      │ Backend #2  │      │ Backend #N  │
        │ (PID 101)   │      │ (PID 102)   │      │ (PID 10N)   │
        └──────┬──────┘      └──────┬──────┘      └──────┬──────┘
               │                    │                    │
               └────────────────────┼────────────────────┘
                                    ▼
                     ┌─────────────────────────────┐
                     │     MongoDB Atlas Cluster   │
                     │  (Replica Set Gerenciado)   │
                     │                             │
                     │  • Dados operacionais       │
                     │  • Adapter Socket.IO        │
                     │  • Travas Distribuídas      │
                     └─────────────────────────────┘
```

---

## 2. Princípios da Arquitetura

1. **Zero dependência de memória local compartilhada**: Nenhuma informação de autorização, sessão ou bloqueio depende da memória RAM de um processo específico.
2. **MongoDB Atlas como barramento único de coordenação**: Em vez de introduzir custos extras com instâncias Redis adicionais, o próprio cluster MongoDB Atlas (com Replica Set) atua como barramento de sincronização pub/sub e coordenador de concorrência.
3. **Idempotência em rotinas agendadas**: Agendamentos via cron disparam em cada instância, mas executam uma única vez por janela temporal.
4. **Resiliência e desligamento gracioso**: O processo encerra conexões sem derrubar requisições em trânsito e responde a sondas de integridade para guiar o roteamento do balanceador.

---

## 3. Componentes Centrais

### 3.1 Sondas de Saúde e Ciclo de Vida (Issue #335)

Para que o balanceador de carga saiba quando direcionar tráfego e quando reiniciar processos degradados, o backend expõe dois endpoints distintos:

- **Liveness Probe (`GET /health`)**:
  - Verifica unicamente se o loop de eventos e o processo Node.js estão vivos e aptos a processar requisições.
  - Não consulta o banco de dados. Oscilações momentâneas de rede no MongoDB não derrubam o container no balanceador.
  - Resposta: `200 OK` com `{ status: 'ok', uptime, timestamp, memoria }`.

- **Readiness Probe (`GET /ready`)**:
  - Verifica se a instância está pronta para receber tráfego de usuários reais.
  - Testa a conectividade ativa com o MongoDB (`mongoose.connection.readyState === 1`).
  - Resposta: `200 OK` se conectado, ou `503 Service Unavailable` com `{ status: 'unready', database: 'disconnected' }`.

- **Desligamento Gracioso (Graceful Shutdown)**:
  - Ao receber sinais `SIGTERM` ou `SIGINT`, o backend para de aceitar novas requisições (`server.close()`), aguarda o término das requisições em processamento (com timeout máximo de segurança de 10s) e desconecta o pool do Mongoose de forma ordenada.

### 3.2 Travas Distribuídas em Rotinas Agendadas (Issue #336)

Quando o serviço roda com múltiplas instâncias, cron jobs (como envio de resumo diário, avisos de atualização do sistema, anonimização LGPD e rotação de segredos 2FA) disparam simultaneamente em cada nó.

Para evitar execuções duplicadas:
- O módulo `src/utils/travaDistribuida.js` coordena a concorrência através da coleção `travas_distribuidas` no MongoDB.
- **Trava por Janela (`executarComTravaJanela`)**: Utiliza `_id: "<rotina>:<janela>"` (ex: `digest-diario:2026-09-18`). A primeira instância que tenta inserir o documento com sucesso obtém a trava; as demais capturam o erro de duplicidade (`E11000`) e encerram a execução sem duplicar ações. Um índice TTL automático remove os registros antigos.
- **Arrendamento com Lease (`executarComArrendamento`)**: Para tarefas de longa duração que necessitam de lock com renovação periódica e recuperação após falhas de nó.

### 3.3 Padronização e Blindagem de Respostas de Erro (Issue #337)

Em ambiente multi-instância, rastreabilidade é crítica:
- Toda requisição recebe ou gera um identificador único de rastreio (`X-Request-Id` / `requestId`), propagado em logs estruturados (Pino) e nos payloads de erro.
- Respostas HTTP 4xx e 5xx contam com código de erro amigável (`codigo`, ex: `VALIDACAO_FALHOU`, `NAO_AUTORIZADO`, `MUITAS_TENTATIVAS`).
- **Blindagem em Produção**: Respostas 500 nunca expõem mensagens cruas de exceptions (`error.message`), stack traces ou detalhes internos de coleções e índices do MongoDB, retornando mensagem genérica segura e registrando o erro detalhado internamente vinculado ao `requestId`.

### 3.4 Índices Compostos e Paginação (Issue #338)

As coleções de `comunicados` e `notificacoes` possuem volume contínuo de inserção. Consultas ordenadas por `dataCriacao: -1` sem índices correspondentes forçam o MongoDB a ordenar em memória, com risco de atingir o teto de 32 MB (`Executor error during subplanning: Sort exceeded memory limit`).

- **Índices Compostos Declarados no Schema**:
  - `Comunicado`: `{ escolaId: 1, ativo: 1, dataCriacao: -1 }` e `{ ativo: 1, dataCriacao: -1 }`
  - `Notificacao`: `{ escolaId: 1, dataCriacao: -1 }` e `{ tipo: 1, dataCriacao: -1 }`
- **Paginação Opcional**:
  - Endpoints de listagem (`GET /api/comunicados`, `GET /api/notificacoes`, `GET /api/secretaria/comunicados`) aceitam parâmetros opcionais `?page=1&limit=20`.
  - **Compatibilidade Retroativa**: Se `page` e `limit` não forem passados, a resposta mantém o contrato original intacto (array completo em `data`).
  - Quando paginado, a resposta inclui o bloco `pagination: { page, limit, total, pages, hasNextPage, hasPrevPage, nextPage, prevPage }`.
  - Limites acima do teto (`limit > 100`) são automaticamente reduzidos para 100.

### 3.5 Sincronização em Tempo Real (Socket.IO)

- O servidor WebSocket suporta o adapter MongoDB oficial (`@socket.io/mongo-adapter`).
- Com `SOCKET_ADAPTER=mongo`, os eventos emitidos em uma instância (ex: novo comunicado, nova notificação, atualização de notas) são publicados em uma capped collection do Mongo e retransmitidos instantaneamente pelos sockets conectados nas demais instâncias.

---

## 4. Variáveis de Ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP em que a instância escuta |
| `NODE_ENV` | `development` | Ambiente de execução (`production` ativa blindagem de 500) |
| `MONGODB_URI` | Obrigatório | String de conexão com o MongoDB Atlas |
| `SOCKET_ADAPTER` | `memory` | `mongo` para sincronização multi-instância via MongoDB |
| `MONGODB_MAX_POOL_SIZE` | `50` | Máximo de conexões simultâneas no pool por instância |
| `MONGODB_MIN_POOL_SIZE` | `5` | Mínimo de conexões mantidas abertas |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | `5000` | Tempo limite para eleição/conexão do Replica Set |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Prazo máximo de espera no encerramento gracioso |

---

## 5. Como Executar Localmente com Múltiplas Instâncias

Para simular e validar o comportamento multi-instância em ambiente de desenvolvimento:

### 5.1 Subir Instâncias em Portas Diferentes

Em terminais separados:

```bash
# Terminal 1 — Instância A
PORT=3001 SOCKET_ADAPTER=mongo npm run dev:backend

# Terminal 2 — Instância B
PORT=3002 SOCKET_ADAPTER=mongo npm run dev:backend
```

### 5.2 Teste com Balanceador Local (Exemplo com Caddy ou Nginx)

Exemplo de configuração simples de balanceamento local com `Caddyfile`:

```caddy
localhost:8080 {
    reverse_proxy localhost:3001 localhost:3002 {
        lb_policy round_robin
        health_uri /health
        health_interval 5s
    }
}
```

Ou com `nginx.conf`:

```nginx
upstream backend_cluster {
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}

server {
    listen 8080;
    location / {
        proxy_pass http://backend_cluster;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 6. O que Continua Opcional

- **Redis**: Suportado como alternativa para ambientes com centenas de instâncias e dezenas de milhares de conexões WebSocket simultâneas. No escopo atual, o MongoDB Atlas atende integralmente à carga sem incorrer em custos de infraestrutura adicionais.
- **Presença Online Compartilhada (Issue #339)**:
  - O estado de presença ("quem está online" e "digitando...") é mantido em memória por padrão para máxima performance em instâncias únicas.
  - Em ambientes multi-instância, o adapter do Socket.IO permite consultar os sockets de todas as instâncias via `io.fetchSockets()`, tornando a presença distribuída uma evolução opcional sem impacto na entrega de dados e mensagens.
