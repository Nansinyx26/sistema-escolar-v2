# Chat interno — quem conversa com quem

> Fonte de verdade em código: `MATRIZ_CONVERSA` e `vinculoDeEscolaOk`, em
> `backend/src/controllers/ChatDiretoController.js`. Este documento explica o
> **porquê**; a matriz em código é quem **decide**. Se os dois divergirem, o
> código está certo e este arquivo está velho.

## A regra

| De ↓ / Para → | professor | diretor | secretaria | responsável |
| ------------- | :-------: | :-----: | :--------: | :---------: |
| **professor**   | ✅ | ✅ | ✅ | ❌ |
| **diretor**     | ✅ | ✅ | ✅ | ❌ |
| **secretaria**  | ✅ | ✅ | ✅ | ✅ *(com vínculo)* |
| **responsável** | ❌ | ❌ | ✅ *(com vínculo)* | ❌ |

A matriz é **simétrica** — declarar A→B autoriza B→A — e é uma **lista branca**:
par que não estiver nela é negado. Um perfil novo no enum de `Usuario` nasce sem
conversar com ninguém até alguém decidir o contrário, de propósito.

`admin` fica fora da tabela: conversa com qualquer perfil e atravessa escolas,
porque é o papel de suporte da rede. Ele **não** é um canal escolar — não aparece
na lista de contatos de quem nunca falou com ele, então a família não ganha por
aí a via para a escola que a matriz fecha.

## A secretaria é a porta única da família (Issue #204)

O responsável não alcança professor nem direção pelo chat. O canal dele é a
**secretaria** — e não uma secretaria qualquer: a da escola em que o filho está
matriculado.

O motivo é institucional, não técnico. Combinar horário com o professor,
questionar nota, pedir reunião com a direção: tudo passa a ter registro único, na
secretaria, em vez de virar conversa paralela que a escola não vê e não consegue
responder por escrito depois. Professor e direção continuam conversando entre si
e com a secretaria normalmente; o que fechou foi a ponta que ligava a família
diretamente a eles.

### "da escola do filho" não é a escola da sessão

Um responsável **não tem vínculo de equipe**. `middleware/filtrarPorEscola.js`
resolve a escola da sessão dele pelo ramo *"escola ativa única da rede"* — que
não é, e não tem como ser, a matrícula do filho. Numa rede com mais de uma
unidade, quem tem filho na escola A pode estar com a escola B na sessão.

Por isso o par responsável↔secretaria tem uma checagem própria além da matriz
(`vinculoDeEscolaOk`), em duas barreiras:

1. o responsável precisa ter **ao menos um filho cadastrado** — falha FECHADA:
   sem filho não há canal escolar nenhum a abrir;
2. a **escola desse filho** precisa ser uma das que a secretaria atende
   (`Secretaria.escolaId` + `Secretaria.vinculos[].escolaId`).

A segunda barreira só é aplicada quando os **dois** lados declaram escola.
Cadastro anterior ao multi-escola (aluno ou secretaria sem `escolaId`) não tem
como ser recortado por escola, e recortar assim mesmo bloquearia a rede inteira
enquanto a migração não roda; nesse caso vale o recorte que já aconteceu antes,
pelo `escolaId` da sessão dos dois lados.

A regra é reavaliada **a cada mensagem**, não só na abertura da conversa: aluno
transferido no meio do ano fecha o canal na mensagem seguinte.

## Onde a regra é aplicada

`podeConversar` é o ponto único, e todas as portas do chat passam por ele:
`POST /chat-direto/enviar`, `/chat-direto/upload`, `/chat-direto/encaminhar` e
`GET /chat-direto/presenca/:id`.

`GET /chat-direto/contatos` responde a mesma regra pelo outro lado — "quem?" em
vez de "este aqui, pode?" — porque conferir par a par custaria uma consulta por
candidato. As duas são amarradas pelo teste de coerência em
`backend/src/tests/chatDiretoContatos.test.js`: para cada conta da escola, estar
na lista tem de significar que o envio passa, e vice-versa.

O **histórico** (`GET /chat-direto/historico/:id`) não foi fechado. Conversa
professor↔responsável criada antes desta política continua legível pelos dois
participantes — é registro escolar, e apagá-lo do alcance de quem o produziu
seria destruir prova sem ninguém pedir. O contato some da lista e nenhuma
mensagem nova entra.

## O que mudou em relação ao recorte por turma (Issue #68)

Antes, `professor ↔ responsavel` existia e era recortado por **turma em comum**:
o professor do 1º ano não falava com o responsável de um aluno do 9º. Esse
recorte não saiu por estar errado — saiu porque o par que ele protegia deixou de
existir.

`backend/src/services/vinculoTurmas.js` continua respondendo a pergunta
(`turmasDoProfessor`, `turmasDosFilhos`, `compartilhamTurma`), com testes em
`backend/src/tests/vinculoTurmas.test.js`. Se a política for revista, é ele que
volta a ser chamado.

## Testes

| Arquivo | O que cobre |
| ------- | ----------- |
| `chatDireto.canalDaFamilia.test.js` | a política por HTTP: os dois sentidos fechados, a secretaria certa, o responsável sem filho, o cadastro legado, a reavaliação por mensagem |
| `chatDiretoContatos.test.js` | a lista de contatos e a coerência dela com o envio |
| `vinculoTurmas.test.js` | as perguntas de vínculo no banco, sem HTTP |
