# Guia de Transferência de Turma (1ºB para 1ºC)

Este documento descreve os passos necessários para transferir alunos, professores e horários da turma **1ºB** para a turma **1ºC**.

## 1. Transferência de Alunos

### Via Interface (Manual - RECOMENDADO)
1. Acesse o **Dashboard do Diretor**.
2. Clique no card **"Total de Alunos"** (ou use o menu lateral).
3. Na lista de alunos, localize o estudante e clique no ícone de **Lápis (Editar)**.
4. Na janela que abrir, altere a **Turma** de `1ºB` para `1ºC`.
5. Clique em **Salvar Alterações**.

### Via Banco de Dados (Script MongoDB)
Se você tiver acesso ao console do MongoDB (ou via script no backend), execute:

```javascript
// Atualiza todos os alunos ativos do 1ºB para o 1ºC
db.alunos.updateMany(
  { turmaId: "1B", ativo: true },
  { $set: { turmaId: "1C", turma: "1ºC" } }
);
```

---

## 2. Transferência de Professores (Atribuição)

### Via Interface
1. Vá em **Gerenciar Salas** (ou Controle de Professores).
2. Localize a sala **1ºB**.
3. Clique no ícone de **Remover Atribuição** (ícone de pessoa com sinal de menos) para o professor regente.
4. Vá até a sala **1ºC**.
5. Clique em **Adicionar Professor** (ou edite o perfil do professor regente).
6. Altere a **Sala Principal** para `1ºC`.

### Via Banco de Dados
```javascript
// Altera o professor regente do 1ºB para o 1ºC
db.professores.updateOne(
  { salaPrincipal: "1B" },
  { $set: { salaPrincipal: "1C" } }
);
```

---

## 3. Transferência de Grade Horária

**Atenção:** Os horários de especialistas (Artes, Ed. Física, etc.) são vinculados à ID da turma. Ao mudar os alunos para o 1ºC, você precisa garantir que a grade do 1ºC esteja correta.

1. Acesse o **Editor de Horários (Tabela Geral)**.
2. Verifique se a coluna do **1ºC** possui os mesmos especialistas que o **1ºB** possuía (ou os novos horários desejados).
3. Clique em **Sincronizar Banco** após fazer as alterações no Excel ou na tabela manual.

---

## 4. Verificação Final
- Acesse `meu-horario.html?sala=1C` para verificar se os alunos e horários aparecem corretamente.
- Verifique se o nome do professor no topo da página do **1ºC** é o professor correto.

> [!IMPORTANT]
> Lembre-se de avisar aos professores que o link de acesso deles pode mudar se o sistema basear a visualização na `salaPrincipal`.
