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

Quando a barreira nega, a resposta é **403** com:

```json
{
  "success": false,
  "codigo": "FERRAMENTA_NAO_AUTORIZADA",
  "error": "A ferramenta \"Plano de aula com IA\" precisa de autorização da direção.",
  "ferramenta": { "id": "ia.plano-aula", "nome": "Plano de aula com IA" },
  "solicitacaoPendente": false
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

## Etapas

| Etapa | Issue | Situação |
|---|---|---|
| Backend básico: coleções, catálogo, verificação, rotas da direção, auditoria | #721 | Este PR |
| Barreira nas ferramentas de IA e em Autorizações dos Pais; migração da chave da #496 | — | A fazer |
| Pedidos e notificações (professor → direção → professor) em tempo real | — | A fazer |
| Página "Autorizações de Ferramentas" da direção | — | A fazer |
| Cadeados e "Solicitar autorização" na conta do professor | — | A fazer |
