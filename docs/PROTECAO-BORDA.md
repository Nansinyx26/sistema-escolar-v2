# Proteção de borda

Camada que barra tráfego automatizado **antes** de ele gastar CPU, disco ou banda da
instância. Código em [`backend/src/middleware/edgeGuard.js`](../backend/src/middleware/edgeGuard.js),
testes em [`backend/src/tests/edgeGuard.test.js`](../backend/src/tests/edgeGuard.test.js),
Issue #332.

## Por que existe

Os limitadores de [`rateLimiters.js`](../backend/src/middleware/rateLimiters.js) protegem
endpoints (login, códigos, IA, chat, upload), e o `globalLimiter` só vale para `/api`. O resto
do site não tinha teto nenhum: as 66 páginas, os arquivos estáticos e principalmente o 404
global, que lê `html/404.html` do disco a cada caminho desconhecido.

Um scanner comum dispara centenas de caminhos que não existem aqui (`/wp-login.php`, `/.env`,
`/vendor/phpunit/...`). Cada um atravessava compressão, logger, helmet com hash de CSP e o gate
de páginas, e terminava lendo arquivo do disco. No plano free do Render (CPU compartilhada,
512 MB) isso basta para deixar o sistema lento para quem está usando, sem explorar falha
nenhuma.

Um CDN ou WAF (Cloudflare e similares) faria esse filtro na frente do servidor. Aqui não há
domínio próprio nem borda externa, e o projeto não pode gerar custo, então a borda possível é
o primeiro middleware do Express.

## As seis etapas

| # | Etapa | Onde roda | Resposta |
|---|---|---|---|
| 1 | **Banimento** | antes de compressão e logger | `429` com `Retry-After` |
| 2 | **Método** fora da allowlist (TRACE, PROPFIND, CONNECT) | depois do logger, antes do helmet | `405` com `Allow` |
| 3 | **Armadilha** (caminho-isca do `robots.txt`) | idem | `404`, banimento imediato |
| 4 | **Sondagem** (PHP, WordPress, dotfile, painel de outro stack, dump, travessia, injeção) | idem | `404` em texto puro; `400` para codificação quebrada (`%ZZ`) |
| 5 | **User-agent** de ferramenta de ataque ou raspador de SEO/IA | idem | `403` |
| 6 | **Taxa**: teto por IP em todas as rotas, janelas de 10 s e 5 min | idem | `429` com `Retry-After` |

A ordem na cadeia é deliberada:

- **A etapa 1 vem antes de tudo.** Um IP banido custa uma consulta a `Map` e nada mais: não
  paga compressão, contexto de log nem span de trace.
- **As etapas 2 a 6 vêm depois do logger e da observabilidade.** O bloqueio aparece nas
  métricas por rota, e é isso que permite enxergar um ataque em curso. Mas ficam antes do
  helmet, do gate de páginas e do `express.static`, ou seja, antes de qualquer leitura de
  disco ou cálculo de hash de CSP.

A sondagem recebe **404**, não 403. Um 403 confirma a quem está mapeando o servidor que existe
um filtro ali; o 404 não se distingue de "não existe". E a resposta é texto montado em
memória: nunca `sendFile` da página de 404.

A exceção é a codificação quebrada (`%ZZ`), que recebe **400**. É o status correto para URL
que não decodifica e o que qualquer servidor responde, então não revela filtro nenhum.

Duas consequências que valem saber:

- **Travessia com `..` só chega crua ao servidor quando vem de ferramenta** (scanner,
  `curl --path-as-is`). Navegadores normalizam o caminho antes de enviar, e o cliente dos
  testes (superagent) também, então para quem navega nada muda: o gate de páginas segue
  decidindo. É o `..` cru, que só ferramenta manda, que para aqui.
- **Sufixo de backup numa página real** (`/html/<área>/entrar.html.bak`) para aqui com 404,
  antes do gate, que respondia com redirecionamento para o login. A página continua sem ser
  entregue; só mudou quem recusa. `paginaEntrarAdmin.test.js` registra isso.

## Armadilhas

`/painel-interno`, `/admin-console`, `/backup-sistema` e `/config-sistema` não existem, não são
linkados de lugar nenhum e aparecem como `Disallow` no `robots.txt`. A única forma de chegar
neles é ler o `robots.txt` procurando o que parece interessante. Crawler que respeita o
`robots.txt` não entra, e gente também não. Quem entra é bot, com banimento imediato.

O `robots.txt` é servido por rota em `app.js`, montado a partir da constante `ARMADILHAS`, e
não como arquivo no disco. Com duas cópias da lista, a primeira mudança deixaria iscas
anunciadas que não banem, ou iscas que banem sem nunca terem sido anunciadas, e aí sim com
risco de pegar gente.

## User-agent

- **Ferramenta de ataque** que se identifica (sqlmap, nikto, nuclei, wpscan…): bloqueio na
  primeira requisição. O user-agent é trivial de trocar, e quem troca cai nas etapas 4 e 6,
  que não dependem dele. A etapa 5 existe para o tráfego de fundo, que em sua maioria roda
  com o user-agent padrão da ferramenta.
- **Raspador de SEO/IA** (AhrefsBot, SemrushBot, Bytespider…): varre o site inteiro,
  repetidamente, ignorando o `robots.txt`. A lista aceita acréscimos e exceções pelo
  ambiente (`EDGE_SCRAPERS_EXTRA`, `EDGE_SCRAPERS_LIBERAR`), porque bloquear raspador é
  decisão de política, não de segurança.
- **Sempre passam**: preview de link (WhatsApp, Telegram, Facebook), buscadores (Google,
  Bing) e monitores de uptime. A escola manda o endereço do portal por WhatsApp; bloquear o
  preview daria um sintoma ("o link não abre direito no zap") que ninguém ligaria a um
  filtro de segurança.
- **Sem user-agent** também passa: service worker e health check chegam assim em alguns
  caminhos. Quem cobre esse caso é o teto de taxa.

## Pontuação e banimento

Um bloqueio isolado **não** bane: navegador com extensão estranha, link velho colado no
WhatsApp e crawler mal configurado geram falso positivo. O que bane é a reincidência.

| Sinal | Pontos |
|---|---|
| Método não permitido | 8 |
| Sondagem | 10 |
| URL malformada (`%ZZ`) | 6 |
| User-agent de ferramenta de ataque | 25 |
| User-agent de raspador | 25 |
| Armadilha | banimento imediato |
| Estouro do teto de taxa | 4, **uma vez por janela** estourada |

Limiar padrão: **25 pontos**. Os pontos de um IP zeram depois de 10 minutos sem novo sinal.
Três sondagens banem; um sqlmap bane na primeira requisição.

A pena **dobra a cada reincidência**: 10 min, 20, 40, 80… até o teto de 12 h. O histórico fica
guardado por 24 h depois do fim da pena, mesmo quando os pontos já zeraram. Sem isso, o
reincidente voltaria sempre como se fosse a primeira vez, e o escalonamento, que é o que torna
caro insistir, não aconteceria.

## Teto de taxa e a escola atrás de NAT

A escola sai por NAT: trinta máquinas do laboratório chegam aqui como **um** IP. Esse é o
cenário que mais importa acertar nesta camada.

Os tetos são folgados: **240 requisições por IP a cada 10 s** e **1500 a cada 5 min**. Uma
primeira visita ao painel da direção puxa cerca de 74 arquivos (HTML, CSS, JS, fontes,
imagens). Com quatro pessoas abrindo o painel ao mesmo tempo, o teto de rajada é atingido.
É uso normal, e a resposta é um `429` passageiro para as requisições excedentes; o navegador
refaz a busca e o service worker guarda os estáticos para as próximas visitas.

Estourar o teto **não bane a escola**. O `express-rate-limit` chama o tratador para *cada*
requisição acima do teto, e a primeira versão deste módulo pontuava ali dentro. Sete
requisições excedentes da mesma rajada somavam 28 pontos e baniam o IP. Na prática, quatro
pessoas abrindo o painel juntas deixavam a escola inteira bloqueada por 10 minutos, depois 20,
40… Isso foi reproduzido com os tetos de produção antes da correção: banimento na 247ª
requisição.

Agora o estouro pontua **uma vez por janela** de cada limitador (`registrarEstouroDeTaxa`).
Uma rajada vale 4 pontos, e o banimento só vem de estouro sustentado: sete janelas de 10 s
estouradas, o que exige no mínimo um minuto de inundação contínua. É isso que separa um flood
de uma turma entrando junto na aula. O teste
"QUATRO pessoas atras do mesmo NAT abrindo o painel NAO banem a escola" fixa esse cenário.

Se a rede da escola tem **IP fixo**, coloque-o em `EDGE_ALLOWLIST_IPS`: o IP fica isento da
camada inteira, inclusive do `429` em dia de primeiro acesso de uma turma.

## Nunca barrados

`/api/health`, `/api/health/observability`, `/health`, `/ready` e `/robots.txt` passam por
cima de banimento e teto de taxa. Health check barrado derruba o serviço: o Render marca a
instância como doente e para de rotear para ela. `/health` e `/ready` já estão na lista para
as sondas da Issue #335.

## Memória

O atacante escolhe quantos IPs mandar, então um `Map` sem teto seria o próprio incidente. O
registro guarda no máximo `EDGE_MAX_IPS_RASTREADOS` IPs (padrão 5000) e, ao atingir o teto,
descarta nesta ordem:

1. as entradas vencidas (pontos, pena e histórico todos expirados);
2. as mais antigas **não banidas** (`Map` preserva a ordem de inserção);
3. se ainda estourou, a mais antiga mesmo estando banida. Perder um banimento antigo é melhor
   do que crescer sem limite e derrubar o processo por falta de memória.

Uma varredura a cada 5 minutos limpa as entradas vencidas.

## Limites conhecidos

- **O estado é do processo.** Com mais de uma instância, cada uma tem seu próprio contador. O
  efeito é um limiar N vezes maior, não uma falha. Estado compartilhado exigiria um store em
  Redis ou Mongo, com uma ida ao banco por requisição, o que anularia boa parte do ganho da
  etapa 1. O épico #334 (várias instâncias atrás de um balanceador) e a Issue #333 (contador
  compartilhado para o rate limit da API) tratam desse cenário.
- **Não substitui nada.** Isto é filtro de volume e de ruído automatizado. Autenticação, CSRF,
  os limitadores por endpoint e o gate de páginas restritas continuam sendo o que protege
  dado.

## Privacidade

O IP é dado pessoal sob a LGPD, e este sistema atende menores. Esta camada nunca grava o IP em
claro: o log leva `ipHash`, 12 caracteres hexadecimais de um SHA-256 com sal gerado a cada
início do processo. Dá para correlacionar linhas do mesmo ofensor dentro de uma execução, e
não dá para montar um dicionário do espaço de IPv4 a partir dos logs guardados.

## Variáveis de ambiente

Todas opcionais. Ausente ou inválida, vale o padrão.

| Variável | Padrão | Efeito |
|---|---|---|
| `EDGE_ALLOWLIST_IPS` | vazio | IPs isentos da camada inteira, separados por vírgula |
| `EDGE_RAJADA_MAX` | `240` | Requisições por IP a cada 10 s |
| `EDGE_SUSTENTADO_MAX` | `1500` | Requisições por IP a cada 5 min |
| `EDGE_LIMIAR_BAN` | `25` | Pontos que disparam o banimento |
| `EDGE_BAN_MINUTOS` | `10` | Duração do 1º banimento (dobra a cada reincidência, teto 12 h) |
| `EDGE_MEMORIA_BAN_HORAS` | `24` | Por quanto tempo a reincidência é lembrada |
| `EDGE_MAX_IPS_RASTREADOS` | `5000` | Teto de IPs no registro |
| `EDGE_SCRAPERS_EXTRA` | vazio | Nomes de raspador a acrescentar ao bloqueio |
| `EDGE_SCRAPERS_LIBERAR` | vazio | Nomes de raspador a tirar do bloqueio |

Fora de produção os tetos de taxa são dez vezes maiores. Em teste (`NODE_ENV=test`), banimento
e teto de taxa ficam desligados no app, para as suítes não se banirem umas às outras; os
filtros de método, caminho e user-agent continuam ligados, porque não acumulam estado.

## Diagnóstico

- Cada bloqueio gera uma linha `warn` com a mensagem `[EdgeGuard] requisicao bloqueada`, com
  `ipHash`, `motivo`, `metodo` e os primeiros 120 caracteres do caminho. No estouro de taxa,
  sai só a primeira linha de cada janela, para o log não virar o custo do próprio flood.
- Cada banimento novo gera um alerta `EDGE_IP_BANIDO`, com `ipHash`, `motivo` e a duração em
  minutos.
- Uma escola reclamando de "Acesso temporariamente bloqueado" é banimento (etapa 1); "Muitas
  requisicoes" é teto de taxa (etapa 6). O primeiro caso, depois da correção do NAT, só
  acontece com sinal hostil real saindo daquele IP, como uma máquina infectada rodando
  scanner. Vale investigar antes de liberar o IP pela allowlist.
