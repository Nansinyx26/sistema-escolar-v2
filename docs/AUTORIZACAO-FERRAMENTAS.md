# Autorização de ferramentas por professor

> Épico #720. Este documento descreve o que já está no código e é atualizado a
> cada etapa.

A direção decide, **professor por professor**, quais ferramentas do catálogo ele
pode usar. A decisão fica no MongoDB, é conferida no backend a cada uso e vai ao
`AuditLog`.

## Regras

- Só o perfil `professor` é verificado. Diretor e admin sempre usam; secretaria e
  responsável seguem as regras próprias de cada rota.
- A escola é sempre a da sessão (`req.escolaId`, resolvida e conferida contra os
  vínculos por `filtrarPorEscola`). Uma autorização dada na escola A não vale na B.
- Sem escola resolvida ou com ferramenta fora do catálogo, a resposta é "não".
- A verificação lê o banco a cada requisição, sem cache: a decisão da direção vale
  na próxima ação do professor, em qualquer instância.
- O professor nunca grava a própria autorização. As rotas de decisão exigem
  diretor (ou admin com escola escolhida), e todo `professorId` recebido é
  conferido contra os professores da escola antes de qualquer escrita — um único
  professor de outra escola recusa o lote inteiro.

## Onde está

| Peça | Arquivo |
|---|---|
| Catálogo (categorias e ferramentas) | `backend/src/services/ferramentas/catalogo.js` |
| Verificação (`checkToolPermission`), quadro da direção, salvar | `backend/src/services/ferramentas/permissaoFerramenta.js` |
| Barreira da rota (`exigirFerramenta`) | `backend/src/middleware/exigirFerramenta.js` |
| API | `backend/src/routes/ferramentas.js` + `controllers/FerramentasController.js` |
| Estado atual por professor | `models/PermissaoFerramenta.js` (coleção `permissoes_ferramentas`) |
| Pedidos do professor | `models/SolicitacaoFerramenta.js` (coleção `solicitacoes_ferramentas`) |
| Testes | `backend/src/tests/ferramentasAutorizacao.regressao.test.js` |

## API (`/api/ferramentas`)

| Rota | Perfil | O que faz |
|---|---|---|
| `GET /catalogo` | equipe | Ferramentas controladas, por categoria |
| `GET /minhas` | equipe | Situação de cada ferramenta para quem está logado: `autorizado`, `pendente`, `bloqueado` (professor) ou `livre` (demais) |
| `GET /autorizacoes` | diretor | Quadro professores × ferramentas da escola, com turmas e disciplinas, status, quem concedeu, última alteração e pedido pendente |
| `PUT /autorizacoes` | diretor | "Salvar autorizações": `{ alteracoes: [{ professorId, ferramentaId, autorizado }] }` |
| `POST /:ferramentaId/solicitar` | professor | Pede a ferramenta (`{ mensagem? }`); um pendente por vez; avisa a direção |
| `GET /solicitacoes?status=` | diretor | Pedidos da escola (`pendente`, `autorizada`, `recusada` ou `todas`) |
| `POST /solicitacoes/:id/decidir` | diretor | `{ decisao: "autorizar" \| "recusar", motivo? }`; avisa o professor |

Quando a barreira nega, a resposta é **403** com:

```json
{
  "success": false,
  "codigo": "FERRAMENTA_NAO_AUTORIZADA",
  "error": "A ferramenta \"Plano de aula com IA\" precisa de autorização da direção.",
  "ferramenta": { "id": "ia.plano-aula", "nome": "Plano de aula com IA" },
  "solicitacaoPendente": false,
  "podeSolicitar": true
}
```

## Auditoria

Cada mudança gera um registro no `AuditLog`:

- `acao`: `FERRAMENTA_AUTORIZADA` ou `FERRAMENTA_REVOGADA`
- quem decidiu (`usuarioId`, `usuarioNome`, `perfil`), escola e data
- `detalhes.valorAnterior` / `detalhes.valorNovo`: `{ professorId, ferramentaId, autorizado }`
- `detalhes.descricao`: ferramenta e id do professor — sem o nome, pela regra da
  Issue #410 (texto livre de log não passa pelo sanitizador)

Salvar um par sem mudança não grava nem audita.

## Como acrescentar uma ferramenta

1. Uma entrada em `FERRAMENTAS` no catálogo, com `id` estável (ele é a chave no
   banco — trocar o `id` depois equivale a revogar todas as autorizações dela),
   `nome`, `categoria` e `descricao`.
2. `exigirFerramenta('<id>')` na rota da ferramenta, depois de `authJWT` e
   `filtrarPorEscola`. Uma chave fora do catálogo quebra a subida do servidor, de
   propósito.

A página da direção e a conta do professor leem o catálogo pela API: a ferramenta
nova aparece nas duas sem outra mudança.

O catálogo fica no código, e não no banco, porque uma ferramenta só é controlada
quando a rota dela passa pela barreira. Uma ferramenta cadastrada só pela tela
mostraria um cadeado que não tranca nada.

## Onde a barreira está

| Ferramenta | Rotas | Observação |
|---|---|---|
| `ia.assistente` | `POST /api/ia/chat`, `/confirmar`, `/chatbot`, `GET /api/ia/chatbot/alunos` | O histórico (`/conversas`, `/exportar`, `/cancelar`, `/comandos`) fica de fora: é dado da própria pessoa |
| `ia.atividades` | ações `criarAtividade` e `criarProjetoMaker` do assistente | Campo `ferramentaControlada` na ação; o modelo nem recebe a declaração, e o preview e a confirmação conferem de novo |
| `ia.plano-aula` | `POST /api/ia/plano-aula` | |
| `ia.plano-estudo` | `POST /api/ia/plano-estudo` | |
| `gestao.autorizacoes-pais` | `GET /api/turmas/autorizacoes/situacao` | Substitui a chave por escola `Escola.professorVeAutorizacoes` (#496) |

As ferramentas de IA continuam dependendo **também** da escola ligada
(`Escola.iaHabilitada`, #401/#711): o professor precisa das duas coisas.

Uma ação nova do assistente que dependa da direção declara
`ferramentaControlada: '<id do catálogo>'`; o `ToolRegistry` recusa a subida se a
chave não existir no catálogo.

### A chave da #496

O atalho da direção em `detalhes/autorizacoes-pais.html`
(`PATCH /api/escolas/:id/autorizacoes-professor`) agora libera ou retira
`gestao.autorizacoes-pais` de **todos os professores atuais** da escola, com um
registro de auditoria por professor alterado. `Escola.professorVeAutorizacoes`
não decide mais nada: a migração `1791471600000-autorizacoes-pais-por-professor`
autorizou os professores atuais das escolas que tinham a chave ligada.

## Pedidos e avisos

```
professor pede ──▶ solicitacoes_ferramentas (pendente) ──▶ aviso a cada diretor da escola
direção decide ──▶ permissoes_ferramentas + pedido encerrado ──▶ aviso ao professor
```

Os avisos reaproveitam a Central de Notificações (`RealtimeNotification`, evento
`notification:new` na sala `user:<id>`) e o push do celular
(`NotificationService.pushParaUsuario`), em
`backend/src/services/ferramentas/notificacoesFerramenta.js`:

| Quando | Para quem | Texto |
|---|---|---|
| Pedido | direção da escola | O professor João Silva solicitou autorização para utilizar a ferramenta "Assistente de IA". |
| Autorizou | professor | A direção autorizou você a utilizar a ferramenta "Assistente de IA". |
| Recusou o pedido | professor | A direção não autorizou o uso da ferramenta "Assistente de IA". |
| Retirou sem pedido | professor | A direção retirou a sua autorização para a ferramenta "Assistente de IA". |

Além do aviso, o Socket.IO emite `ferramentas:atualizadas` (`{ ferramentaId, status }`)
para o professor e `ferramentas:solicitacao` para a direção — as telas das etapas
seguintes usam esses eventos para se atualizar sem recarregar. Auditoria do fluxo:
`FERRAMENTA_SOLICITADA`, `FERRAMENTA_AUTORIZADA`, `FERRAMENTA_SOLICITACAO_RECUSADA`.

## Etapas

| Etapa | Issue | Situação |
|---|---|---|
| Backend básico: coleções, catálogo, verificação, rotas da direção, auditoria | #721 | Pronto |
| Barreira nas ferramentas de IA e em Autorizações dos Pais; migração da chave da #496 | #727 | Pronto |
| Pedidos e notificações (professor → direção → professor) em tempo real | #733 | Este PR |
| Página "Autorizações de Ferramentas" da direção | — | A fazer |
| Cadeados e "Solicitar autorização" na conta do professor | — | A fazer |
