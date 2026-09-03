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

E o suporte da rede (`admin`): ✅ com professor, diretor e secretaria; **❌ com o
responsável**.

A matriz é **simétrica** — declarar A→B autoriza B→A — e é uma **lista branca**:
par que não estiver nela é negado. Um perfil novo no enum de `Usuario` nasce sem
conversar com ninguém até alguém decidir o contrário, de propósito.

`admin` (suporte da rede) fica fora da tabela: conversa com qualquer perfil e
atravessa escolas — **menos com o responsável**. Uma porta só significa uma
porta: um canal de suporte alcançável pela família seria exatamente o segundo
canal que esta matriz existe para não ter. O atalho do admin em
`paresPermitidos` vem depois dessa guarda, e é isso que faz
`admin ↔ responsavel` cair como par não declarado. Para a equipe nada muda: o
suporte continua alcançável por quem já falou com ele.

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

`podeConversar` é o ponto único, e **ler conta como conversar**. Passam por ele:

| Rota | O que a regra impede |
| ---- | -------------------- |
| `POST /chat-direto/enviar` | mensagem nova |
| `POST /chat-direto/upload` | anexo novo |
| `POST /chat-direto/encaminhar` | repassar para um par fechado |
| `POST /chat-direto/reagir` | interagir num fio fechado |
| `GET /chat-direto/historico/:id` | **ler a conversa anterior** |
| `GET /chat-direto/presenca/:id` | saber se a pessoa está online |

`GET /chat-direto/contatos` responde a mesma regra pelo outro lado — "quem?" em
vez de "este aqui, pode?" — porque conferir par a par custaria uma consulta por
candidato. As duas são amarradas pelo teste de coerência em
`backend/src/tests/chatDiretoContatos.test.js`: para cada conta da escola, estar
na lista tem de significar que o envio passa, e vice-versa.

`GET /chat-direto/nao-lidas` (o selo do menu) agrupa por remetente e descarta os
perfis inalcançáveis. Sem isso a família veria "3 mensagens", clicaria, e cairia
numa tela sem contato nenhum para abrir — um número que nunca zera. O recorte
ali é só por **perfil**, não pelo vínculo fino: são poucos remetentes distintos,
mas cada um custaria de uma a três consultas num endpoint chamado a cada minuto.

### A conversa anterior não é alcançável

Fechar só o envio deixaria a política pela metade. As conversas que a família
teve com professor, direção e suporte **existem no banco**, e antes bastava um
GET no histórico para lê-las inteiras — o canal ficaria fechado no papel e
legível na prática. Por isso o histórico exige a mesma autorização do envio, nos
**dois sentidos**: o professor também não reabre a conversa antiga com a família.

As mensagens **não são apagadas** — elas deixam de ser alcançáveis por quem não
pode mais conversar. Apagar registro escolar é decisão da instituição, não efeito
colateral de uma mudança de permissão. Quem precisa do próprio registro continua
com a exportação de dados pessoais (`MeusDadosController`, LGPD).

`editarMensagem` não precisou de barreira: a janela de 15 minutos já o fecha
sozinha, porque para editar dentro dela a mensagem teria de ter sido enviada
dentro dela — e o envio não passa mais. `apagarMensagem` continua aberto de
propósito: retirar o próprio conteúdo não é conversar, e bloquear prenderia a
pessoa a um texto que ela quer remover.

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
| `chatDireto.canalDaFamilia.test.js` | a política por HTTP: os dois sentidos fechados (professor, direção e suporte), a secretaria certa, o responsável sem filho, o cadastro legado, a reavaliação por mensagem, o histórico anterior, a reação e o selo |
| `chatDiretoContatos.test.js` | a lista de contatos e a coerência dela com o envio |
| `vinculoTurmas.test.js` | as perguntas de vínculo no banco, sem HTTP |
