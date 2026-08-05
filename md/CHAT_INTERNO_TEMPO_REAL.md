# Chat interno em tempo real — arquitetura e uso

Chat direto entre membros da equipe escolar (Professores, Diretores, Secretaria)
e responsáveis, integrado ao dashboard. Abre em janelas flutuantes sobre a
página, sem redirecionamento, no estilo do WhatsApp Desktop.

## Onde fica cada peça

| Camada | Arquivo | Papel |
| --- | --- | --- |
| Card de usuários online | `js/professores-online.js` | Lista a equipe com foto, cargo, status, tempo online, não lidas e o botão **💬 Conversar** |
| Estilos do card | `css/professores-online.css` | Card embutido + FAB + painel flutuante |
| Janelas de conversa | `js/chat-direto-manager.js` | `ChatManager` (global) + `ChatWindowInstance` (uma por conversa) |
| Estilos da conversa | `css/chat-flutuante.css` | Janela, bolhas, previews, menus, modais, tema claro/escuro, responsivo |
| API REST | `backend/src/controllers/ChatDiretoController.js` | Enviar, histórico, upload, editar, apagar, reagir, encaminhar, presença |
| Rotas | `backend/src/routes/api.js` (seção *6. Chat Direto*) | Registro dos endpoints |
| Persistência | `backend/src/models/ChatDireto.js` | Coleção `chat_direto` |
| Upload | `backend/src/middleware/uploadChat.js` | Lista branca de mimetypes do chat |
| Autorização de anexo | `backend/src/controllers/FileController.js` | Regra `metadata.type === 'chat_anexo'` |
| Presença | `backend/src/realtime/presence.js` | Online/ausente/offline em memória, por escola |
| Socket.IO | `backend/src/index.js` | Salas, `chat:*`, `presence:idle` |

O `window.socket` é criado por `js/realtime.js` — **toda página que usar o chat
precisa carregá-lo antes** de `chat-direto-manager.js`, senão o chat cai só no
polling e mensagens novas não chegam sozinhas.

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| POST | `/api/chat-direto/enviar` | Texto, anexo e/ou áudio. Passa por `bloquearPalavroes` |
| GET | `/api/chat-direto/historico/:outroUsuarioId` | Página de 30 msgs. Query: `before`, `search`, `data`, `filter`, `limit`. Devolve `hasMore` |
| POST | `/api/chat-direto/upload` | Campo `arquivos` (até 5, 25 MB cada) + `destinatarioId` |
| GET | `/api/chat-direto/anexo/:id` | Download do anexo — só remetente e destinatário |
| PATCH | `/api/chat-direto/lida/:mensagemId` | Marca uma mensagem |
| PATCH | `/api/chat-direto/lidas/:outroUsuarioId` | Marca a conversa inteira (1 requisição) |
| PUT | `/api/chat-direto/mensagem/:id` | Editar (só o autor) |
| DELETE | `/api/chat-direto/mensagem/:id?tipo=para_mim\|para_todos` | Apagar |
| POST | `/api/chat-direto/reagir` | `{ mensagemId, emoji }`; `emoji: 'REMOVE'` retira |
| POST | `/api/chat-direto/encaminhar` | `{ mensagemIds[], destinatarioIds[] }` (até 20 cada) |
| GET | `/api/chat-direto/presenca/:outroUsuarioId` | `{ status, online, onlineDesde, ultimoAcesso }` |
| GET | `/api/professores/status-online` | Equipe da escola para o card e o modal de encaminhar |

`filter` aceita `anexos`, `imagens` e `audios`. `data` é `YYYY-MM-DD` e recorta
o dia inteiro.

## Eventos Socket.IO

**Servidor → cliente**

| Evento | Quando |
| --- | --- |
| `chat:mensagem` | Mensagem criada (vai para o destinatário e para as outras abas do remetente) |
| `chat:editada` | Conteúdo alterado |
| `chat:apagada` | `{ mensagemId, paraTodos }` |
| `chat:reacao` | `{ mensagemId, reacoes }` |
| `chat:lida` / `chat:lidas` | Confirmação de leitura (uma ou várias) |
| `chat:typing` / `chat:recording` | `{ remetenteId, isTyping\|isRecording }` |
| `presence:professor` | `{ userId, online, status, perfil }` para a sala `escola:<id>` |

**Cliente → servidor**

| Evento | Uso |
| --- | --- |
| `chat:typing` | `{ destinatarioId, isTyping }` |
| `chat:recording` | `{ destinatarioId, isRecording }` |
| `presence:idle` | `{ ausente }` — a aba avisa ociosidade (5 min sem interação ou aba oculta) |

`chat:typing` e `chat:recording` só são retransmitidos se o destinatário estiver
no mapa de presença da **mesma escola** do remetente — um socket não consegue
disparar "digitando" para outro tenant informando um id qualquer.

## Status de presença

`realtime/presence.js` mantém, por escola, `Map<userId, { conexoes, desde, ausente }>`:

- **🟢 online** — pelo menos uma aba ativa;
- **🟡 ausente** — **todas** as abas ociosas (aba ativa em outro monitor mantém online);
- **🔴 offline** — nenhuma conexão. O cabeçalho mostra "visto por último…".

É estado em memória e some no restart do processo — presença é efêmera por
natureza. `ultimoAcesso` fica num mapa à parte para sobreviver ao disconnect.
Coberto por `backend/src/tests/presence.test.js`.

## Anexos: por que uma rota própria

O chat usava `/api/upload/documento`, que existe para documentos de aluno:
aceita só PDF/JPG/PNG e grava `metadata.usuarioId` do remetente. Consequências
que a rota dedicada resolve:

1. Word, Excel, PowerPoint, ZIP, vídeo e o `audio/webm` da gravação de voz eram
   **rejeitados** — mensagens de áudio não funcionavam;
2. `autorizarArquivo` libera `metadata.usuarioId` só para o dono e a gestão, então
   o **destinatário tomava 403** no arquivo que acabara de receber.

`/api/chat-direto/upload` grava `metadata.type = 'chat_anexo'` com `usuarioId` e
`destinatarioId`; o `FileController` libera exatamente esses dois — a gestão não
lê anexo de conversa alheia.

### O cliente não dita os metadados do anexo

`enviarMensagem` **não confia** no objeto `anexo`/`audio` que chega no corpo. Só
o `gridfsId` é aproveitado: o servidor busca o arquivo no GridFS, confere que é
`chat_anexo` **do próprio remetente** e reconstrói `url`, `nome`, `tipo` e
`tamanho` a partir do arquivo real. Sem isso bastava mandar
`anexo: { url: 'https://phishing…' }` para o outro lado receber um cartão de
download clicável apontando para fora, ou referenciar o `gridfsId` de outra
conversa.

### Encaminhamento e autorização

Encaminhar reaproveita o mesmo arquivo no GridFS. Como o `metadata` só conhecia
o par original, o novo destinatário recebia a mensagem e tomava **403 no anexo**.
`liberarAnexoPara()` acrescenta o id dele em `metadata.compartilhadoCom`, e o
`FileController` considera esse array junto com remetente e destinatário.

## Recursos da conversa

- **Texto** com Enter para enviar e Shift+Enter para quebrar linha; campo cresce até 90px.
- **Emojis** por seletor em popover.
- **Anexos** por botão, arrastar-e-soltar ou colar (Ctrl+V). Entram numa **fila
  visível** — o usuário revisa e remove antes de confirmar. Imagens acima de
  300 KB são redimensionadas para 1600px e reencodadas em JPEG (GIF passa intacto).
- **Áudio**: grava, cancela, **para e ouve a prévia**, e só então envia. Duração e
  barra de reprodução na bolha.
- **Mensagens**: responder (a citação leva até a original), editar, apagar para
  mim/para todos, encaminhar, copiar, seleção múltipla.
- **Reações**: 👍 ❤️ 😂 😮 😢 👏 🎉 com contagem e tooltip de quem reagiu; clicar de
  novo no mesmo emoji remove.
- **Busca** por palavra, data e tipo de anexo — resolvida no servidor, alcança o
  histórico inteiro.
- **Lazy loading**: 30 por página; rolar até o topo carrega as anteriores
  preservando a posição de leitura.
- **Renderização incremental**: mensagem nova entra pelo `anexarBolha()`, que
  cria só o nó dela. Reação, edição e leitura repintam apenas a bolha afetada
  (`substituirBolha()`). Antes cada evento reescrevia o `innerHTML` inteiro e
  religava os listeners de todas as bolhas — numa conversa com 200 mensagens
  carregadas, uma mensagem nova repintava as 200.
- **Notificações**, em três camadas — o som sozinho não diz quem mandou, e com a
  aba em segundo plano não diz nada:
  1. badge vermelho no card + destaque na janela minimizada;
  2. **cartão clicável** no canto superior direito com nome e prévia; clicar
     abre a conversa daquele remetente. Um cartão por pessoa, some em 6s;
  3. **notificação do sistema** quando a aba está oculta — só se a permissão
     **já** tiver sido concedida. O chat nunca pede permissão por conta
     própria; isso é decisão do usuário no fluxo de notificações do sistema.

  O som é configurável pelo ícone 🔊 do cabeçalho
  (`localStorage.chatSomAtivo`). O evento `chat:mensagem` carrega um
  `remetenteNome` transitório (não vai para o banco) para o aviso nomear quem
  escreveu sem uma consulta extra.

## Responsividade

- **Desktop**: janelas de 360px empilhadas à direita, várias ao mesmo tempo.
- **Tablet** (769–1024px): janelas de 320px.
- **Telas curtas** (altura ≤ 700px): janela mais baixa para não cortar o rodapé.
- **Celular** (≤ 768px): tela cheia, botão **voltar**, fonte 16px no campo (evita
  o zoom automático do iOS), `env(safe-area-inset-bottom)` no rodapé e alvos de
  toque maiores. Abrir uma conversa fecha as demais — empilhar telas cheias
  esconderia conversas invisíveis uma sobre a outra.

Tema claro e escuro seguem `:root[data-theme]`, e `prefers-reduced-motion`
desliga as animações.

## Segurança

- JWT existente (cookie `escola_jwt` ou header), em todas as rotas;
- `podeConversar()` exige mesma escola; responsável só fala com a equipe escolar;
  aplicado também no upload e no encaminhamento;
- histórico filtrado pelo par de participantes — não há como ler conversa alheia;
- reagir, apagar e editar exigem participar da conversa: `reagirMensagem` e
  `apagarMensagem` buscavam só por `_id`, então qualquer conta autenticada que
  descobrisse um id reagia (com o nome aparecendo para os dois lados) ou se
  empilhava no `apagadaPara` de mensagem alheia;
- anexos restritos aos dois lados da conversa;
- `bloquearPalavroes` no envio e na edição;
- todo conteúdo vindo do banco passa por `esc()` antes de entrar no `innerHTML`;
- o nome do arquivo original nunca vira nome no GridFS (só metadado exibido);
- `anexo`/`audio` do corpo são revalidados contra o GridFS (ver acima) — o
  cliente não consegue injetar URL externa nem referenciar arquivo alheio;
- confirmação de leitura só é enviada com a janela **aberta**: janela minimizada
  não marca como lida, para o "✓✓" não mentir para o outro lado.

## Testes

| Arquivo | Cobre |
| --- | --- |
| `backend/src/tests/presence.test.js` | refCount de abas, online/ausente/offline, isolamento por escola, tempo online e último acesso |
| `backend/src/tests/chatDireto.test.js` | Envio, fronteira de escola, validação de anexo, download pelos dois lados, paginação, busca, leitura em lote, encaminhamento, editar/apagar, reações e presença |

> As suites de integração usam **um banco por worker do Jest**
> (`helpers.nomeDoBanco()`). Antes todas compartilhavam o banco `test` e o
> `limparBanco()` de uma apagava as coleções no meio da outra — era a origem de
> ~98 falhas intermitentes que não tinham nada a ver com o código de produção.

## Estender

Para abrir uma conversa de qualquer lugar do sistema:

```js
window.abrirChatCom(userId, {
  nome: 'Maria Silva',
  foto: '<url ou id da foto>',
  cargo: 'Professor',
  status: 'online'   // online | ausente | offline
});
```

Basta a página carregar `js/realtime.js`, `js/chat-direto-manager.js` e
`css/chat-flutuante.css`. Para exibir o botão **Conversar** num card próprio,
inclua um `<button class="btn-po-conversar" data-chat-user="…" data-chat-nome="…">`
— o listener delegado de `professores-online.js` cuida do clique.

## Manutenção

Ao mexer nesses arquivos, atualize o `?v=` de `dashboard.html` e
`direcao/index.html` (hoje `v=2.0`) para invalidar o cache do navegador.
