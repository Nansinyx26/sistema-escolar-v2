# RASCUNHO — PENDENTE DE VALIDAÇÃO JURÍDICA

> **Não publicar.** Aviso sobre o uso de inteligência artificial no Sistema
> Escolar, escrito a partir do que o código faz hoje. Tudo entre `[ ]` depende
> de decisão ou informação que não está no código.

---

## Aviso sobre o uso de inteligência artificial

### Onde a IA é usada

O sistema tem funções que geram texto com um serviço de inteligência
artificial de terceiro:

| Função | Quem usa | O que produz |
|---|---|---|
| Assistente da escola (copiloto) | equipe escolar | respostas a perguntas sobre turmas, notas e frequência |
| Assistente do portal | responsáveis | respostas sobre o próprio filho |
| Insight pedagógico da direção | direção | resumo da situação da escola |
| Análise da turma | direção | resumo de uma turma |
| Plano de aula | professores | sugestão de plano de aula |
| Plano de estudo (PEI) | equipe escolar | sugestão de plano de estudo |
| Narração de texto | quem ativa a leitura em voz alta | áudio do texto da tela |

O serviço de IA de texto é o Google Gemini. A narração usa o ElevenLabs. Os
dois processam os dados fora do Brasil (ver a lista de fornecedores).
`[VALIDAR COM JURÍDICO]` o plano contratado de cada um e o contrato de
tratamento de dados.

### A escola decide se usa

A IA vem **desligada** em cada escola. Ela só funciona depois que a escola
decide ligá-la. Com a IA desligada, as telas continuam funcionando com
resultados calculados no próprio sistema, sem enviar nada ao serviço externo.

### O que sai e o que nunca sai

Antes de qualquer envio, o sistema troca o nome de cada aluno por um rótulo
("Aluno A", "Aluno B") e retira o número de matrícula (RA) e a data de
nascimento. O nome volta só dentro do sistema, depois da resposta.

**Nunca são enviados:** motivo de falta, dados de saúde, alergias,
deficiência, transtornos e observações escritas pela equipe ou pela família.

A importação de documentos de matrícula **não** usa IA: o arquivo é lido
dentro do sistema.

A narração recusa textos que citem aluno.

### A IA não decide

O que a IA escreve é sugestão. Nenhuma resposta da IA grava nota, frequência,
situação ou encaminhamento de aluno. Indicadores como "alunos em risco" são
estimativas de apoio, e a decisão é sempre de uma pessoa da escola.

### Quanto tempo fica guardado

As conversas com o assistente da escola ficam guardadas por 90 dias (prazo
configurável, `IA_RETENCAO_DIAS`) e depois são apagadas automaticamente. As
do assistente do portal, por 180 dias.

### Seus direitos

A conversa com o assistente é dado pessoal de quem conversou e entra no
pacote de dados que o titular pode baixar. Pedidos sobre o uso de IA seguem o
procedimento de atendimento aos titulares.

---

## Pendências

- `[VALIDAR COM JURÍDICO]` base legal do envio a provedor de IA para cada
  função, em escola pública, e necessidade de consentimento para o assistente
  do portal.
- `[VALIDAR COM JURÍDICO]` transferência internacional (LGPD, art. 33;
  Res. CD/ANPD nº 19/2024).
- `[DECISÃO DA MANTENEDORA]` plano contratado do Gemini. No nível gratuito, os
  termos do provedor permitem usar o conteúdo enviado para melhorar o serviço.
