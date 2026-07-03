# Implementation Plan: Chatbot Inteligente com RBAC

## Overview

Transformar o chatbot escolar existente em um assistente inteligente com RBAC, criando o `ChatbotService.js` e refatorando o `IAController.chatbot()`. Apenas o backend é modificado; frontends e schemas permanecem inalterados.

## Tasks

- [x] 1. Criar ChatbotService — estrutura base e helpers de classificação
  - [x] 1.1 Criar o arquivo `backend/src/services/ChatbotService.js` com os requires dos modelos `Aluno`, `Nota`, `Falta`, `Professor`, `Comunicado`, `GradeHoraria`, `ChatMensagem`, `voiceService` e `logger`
  - [x] 1.2 Implementar `classifyIntent(message)` com mapa de palavras-chave para 8 intenções (NOTAS, FALTAS, COMUNICADOS, TURMA_GERAL, HORARIO, PROFESSORES, RESUMO_GERAL, INDEFINIDA), normalizando para lowercase antes da comparação
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_
  - [x] 1.3 Implementar `detectBimestre(message)` usando regex `/(\d+|primeiro|segundo|terceiro|quarto|um|dois|tr[eê]s|quatro)[°º]?\s*bim(estre)?/i` com mapa de tokens para número 1–4
    - _Requisitos: 8.3_
  - [x] 1.4 Implementar `detectMateria(message)` verificando correspondência com `MATERIAS_CONHECIDAS` em lowercase
    - _Requisitos: 8.4_

- [x] 2. Implementar enforceRBAC e resolveAlunoContext
  - [x] 2.1 Implementar `enforceRBAC({ perfil, userId, userEmail })` retornando `{ alunoFilter, turmasAutorizadas, professorDoc, alunosVinculados? }`: perfil `responsavel` filtra por email nos campos `responsavel` e `responsavelDados.email`; perfil `professor` busca `Professor.findOne({ idUsuario: String(userId) })` e une `salaPrincipal` + `salasAdicionais`; perfis `diretor`, `admin`, `coordenador` e `secretaria` retornam filtro vazio e `turmasAutorizadas: null`
    - _Requisitos: 3.1, 4.1, 4.2, 5.1, 6.1, 7.1_
  - [x] 2.2 Implementar `resolveAlunoContext({ alunoId, message, alunoFilter })`: (1) se `alunoId` vier no body, busca `Aluno.findOne({ _id: alunoId, ...alunoFilter })`; (2) caso contrário extrai tokens com inicial maiúscula (length > 2) e busca por nome com regex respeitando `alunoFilter`; (3) retorna `{ aluno, alunoId }` ou `{ aluno: null, alunoId: null }` se o aluno não for encontrado ou acesso negado
    - _Requisitos: 2.1, 2.2, 3.3_

- [x] 3. Implementar fetchData — consultas ao MongoDB por intenção
  - [x] 3.1 Implementar `fetchNotas({ alunoContexto, bimestre, materia })` em `ChatbotService.js`: substituir o stub atual; query base `{ alunoId: String(alunoContexto) }`, adicionar filtro `bimestre` se detectado, adicionar filtro `materiaId: new RegExp(materia, 'i')` se detectado; calcular média aritmética das notas numéricas com `parseFloat`; retornar `{ notas, media, bimestre, materia }` — se sem registros retornar objeto com array vazio e `media: null`
    - _Requisitos: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 3.2 Implementar `fetchFaltas({ alunoContexto })` em `ChatbotService.js`: substituir o stub atual; busca `Falta.find({ aluno: String(alunoContexto) }).lean()`; calcular `frequencia = (presentes/total)*100` quando total > 0, senão `null`; definir `alertaCritico: true` se frequencia < 75, `alertaObservacao: true` se entre 75 e 84,9; retornar `{ faltas, total, presentes, frequencia, alertaCritico, alertaObservacao }`
    - _Requisitos: 9.1, 9.2, 9.3, 9.4, 9.5_
  - [x] 3.3 Implementar `fetchComunicados({ perfil, turmaAluno })` em `ChatbotService.js`: substituir o stub atual; filtro de `destinatarios` por perfil — `responsavel` filtra `{ $in: ['todos', 'responsaveis', turmaAluno].filter(Boolean) }`, `professor` filtra `{ $in: ['todos', 'professores'] }`, demais perfis sem filtro de destinatários; sempre filtrar por `ativo: true`; ordenar por `dataCriacao: -1` e limitar a 5 registros; retornar array de comunicados
    - _Requisitos: 3.5, 10.1, 10.2, 10.3, 10.4_
  - [x] 3.4 Implementar `fetchGradeHoraria({ turmaId })` em `ChatbotService.js`: substituir o stub atual; busca `GradeHoraria.find({ turmaId }).sort({ diaSemana: 1, horaInicio: 1 }).lean()`; retornar array de registros — se vazio retornar array vazio
    - _Requisitos: 3.4, 4.4, 11.1, 11.2, 11.3_
  - [x] 3.5 Implementar `fetchProfessores({ turma })` em `ChatbotService.js`: substituir o stub atual; busca `Professor.find({ $or: [{ salaPrincipal: turma }, { salasAdicionais: turma }] }).select('nome materias disciplina').lean()`; retornar array de professores — se vazio retornar array vazio
    - _Requisitos: 3.6, 12.1, 12.2, 12.3_
  - [x] 3.6 Implementar `fetchTurmaGeral({ alunoFilter })` em `ChatbotService.js`: substituir o stub atual; busca `Aluno.find(alunoFilter).select('nome turma').lean()`; agrupar alunos por turma usando `reduce` e calcular `{ turma, total }` por grupo; retornar `{ alunos, porTurma }`
    - _Requisitos: 4.3, 5.3, 6.2, 7.1_
  - [x] 3.7 Implementar `fetchResumoGeral()` em `ChatbotService.js`: substituir o stub atual; usar `Promise.all` para executar em paralelo — `Nota.aggregate([{ $group: { _id: null, media: { $avg: { $toDouble: '$nota' } } } }])`, `Falta.countDocuments({ presente: false })`, `Falta.countDocuments()`, `Comunicado.countDocuments({ ativo: true })`; calcular `frequenciaGlobal = ((total - faltas) / total) * 100`; retornar `{ mediaEscola, frequenciaGlobal, totalComunicadosAtivos }`
    - _Requisitos: 5.2_

- [x] 4. Implementar fetchHistorico, buildPrompt e o método process()
  - [x] 4.1 Implementar `fetchHistorico(userId)` em `ChatbotService.js`: substituir o stub atual; busca `ChatMensagem.find({ usuarioId: String(userId) }).sort({ criadoEm: -1 }).limit(5).lean()`; envolver em try/catch retornando `[]` silenciosamente em caso de erro sem propagar a exceção
    - _Requisitos: 14.1, 14.3_
  - [x] 4.2 Implementar `buildPrompt({ perfil, intencao, message, dados, historico })` em `ChatbotService.js`: substituir o stub atual; montar string com as seções — (1) instrução do sistema em PT-BR (responder sempre em PT-BR, tom empático, sem JSON bruto, sem markdown), (2) perfil do usuário, (3) intenção identificada, (4) pergunta original, (5) histórico recente formatado como `[Usuário]: ... \n[Assistente]: ...`, (6) dados consultados do banco serializados como texto legível via `JSON.stringify`
    - _Requisitos: 13.1, 13.2, 14.2_
  - [x] 4.3 Implementar `process({ message, alunoId, perfil, userId, nomeUsuario, userEmail })` em `ChatbotService.js`: substituir o stub atual orquestrando o pipeline completo: (1) normalizar message para lowercase; (2) `classifyIntent`; (3) `enforceRBAC`; (4) `resolveAlunoContext`; (5) tratar casos especiais — responsável com `alunosVinculados.length > 1` e sem AlunoContexto retorna mensagem listando os filhos, responsável com AlunoContexto de acesso negado retorna mensagem de negação, professor tentando acessar turma não autorizada retorna mensagem de acesso negado; (6) `fetchHistorico`; (7) rotear para o `fetchData` correto conforme intenção (usar switch/if-else por intenção); (8) para intenção `INDEFINIDA` pular fetchData e montar prompt contextualizado direto; (9) `buildPrompt`; (10) chamar `voiceService.generateInsightText(prompt)` em try/catch; (11) pós-processar resposta removendo markdown residual com `/[*_~`#]/g`; retornar `{ response, alunoId: resolvedAlunoId }`
    - _Requisitos: 1.9, 2.3, 3.2, 3.3, 4.5, 7.3, 13.3, 13.5_
  - [x] 4.4 Implementar o fallback de erro do Gemini dentro de `process()`: o try/catch ao redor de `voiceService.generateInsightText()` deve capturar qualquer exceção, registrar com `logger.warn` e retornar a string `'Desculpe, estou com dificuldade para processar sua pergunta agora. Tente novamente em instantes.'` sem propagar o erro
    - _Requisitos: 13.4_
  - [x] 4.5 Implementar o fluxo para intenção `INDEFINIDA` dentro de `process()`: não chamar nenhuma função `fetchData`; montar um prompt contextualizado com a instrução do sistema escolar e a mensagem do usuário, incluindo perfil e histórico, e encaminhar direto ao `voiceService.generateInsightText()`
    - _Requisitos: 1.9, 13.5_

- [x] 5. Refatorar IAController.chatbot()
  - [x] 5.1 Adicionar `const ChatbotService = require('../services/ChatbotService')` no topo de `backend/src/controllers/IAController.js`, logo após os requires existentes, sem remover nenhuma importação atual
    - _Requisitos: 17.1_
  - [x] 5.2 Substituir o corpo completo de `exports.chatbot` pela nova lógica de validação de entrada: verificar `message` ausente ou vazio após `.trim()` → HTTP 400 `{ success: false, error: 'Mensagem vazia.' }`; verificar `perfil` ausente ou vazio → HTTP 403 `{ success: false, error: 'Perfil de usuário não autorizado.' }`; truncar `message` para 1000 caracteres se exceder, registrando `logger.warn` com os tamanhos original e truncado
    - _Requisitos: 16.1, 16.2, 16.4_
  - [x] 5.3 Adicionar a delegação ao `ChatbotService.process({ message, alunoId, perfil, userId, nomeUsuario, userEmail: req.user?.email })` e capturar `{ response, alunoId: resolvedAlunoId }` no retorno; garantir que `userId` leia `req.user?.id || req.user?._id` e `nomeUsuario` leia `req.user?.nome || 'Usuário'`
    - _Requisitos: 17.1, 17.2_
  - [x] 5.4 Adicionar persistência com `ChatMensagem.create({ usuarioId, usuarioPerfil, usuarioNome, alunoId: resolvedAlunoId || null, pergunta: message, resposta: response })` usando `.catch(e => logger.warn(...))` para falha silenciosa; mapear `coordenador` e `secretaria` para `'admin'` no campo `usuarioPerfil` antes de criar o documento
    - _Requisitos: 15.1, 15.2, 17.3_
  - [x] 5.5 Retornar `res.json({ success: true, data: { response, alunoId: resolvedAlunoId } })` e adicionar bloco `catch` externo com `logger.error` retornando HTTP 500 `{ success: false, error: 'Não foi possível processar sua pergunta. Tente novamente.' }` sem expor stack trace
    - _Requisitos: 16.3, 17.1_

- [x] 6. Checkpoint final — Verificação de integração e compatibilidade
  - [x] 6.1 Verificar que o endpoint `POST /api/ia/chatbot` mantém a assinatura de request (`message`, `alunoId` opcionais no body) e a estrutura de response `{ success: true, data: { response, alunoId } }` — nenhuma alteração de rota ou middleware deve ter sido introduzida
    - _Requisitos: 17.1, 17.2_
  - [x] 6.2 Verificar que `ChatbotService.js` não modificou schemas Mongoose existentes, não importa componentes de frontend e não introduziu novas dependências npm além das já declaradas em `backend/package.json`
    - _Requisitos: 17.1_
  - [x] 6.3 Verificar que todos os perfis RBAC (`responsavel`, `professor`, `diretor`, `admin`, `coordenador`, `secretaria`) possuem tratamento explícito em `enforceRBAC` e que uma requisição sem perfil definido resulta em HTTP 403 no `IAController`
    - _Requisitos: 3.1, 4.1, 5.1, 6.1, 7.1, 16.2_
  - [x] 6.4 Verificar que o mapeamento de `coordenador` e `secretaria` para `'admin'` no campo `usuarioPerfil` do `ChatMensagem` está presente na persistência do histórico; confirmar que nenhum outro valor fora do enum `['admin', 'diretor', 'professor', 'responsavel']` é gravado
    - _Requisitos: 17.3_
  - Garantir que todos os testes passam. Se surgirem dúvidas, perguntar ao usuário.

## Notes

- Nenhuma nova dependência npm é necessária
- O schema `ChatMensagem.usuarioPerfil` aceita apenas `['admin', 'diretor', 'professor', 'responsavel']` — `coordenador` e `secretaria` devem ser mapeados para `'admin'` na persistência (Requisito 17.3)
- `alunosVinculados` é retornado por `enforceRBAC` apenas para perfil `responsavel`, para permitir a lógica de seleção de filho na tarefa 4.3
- O pós-processamento de markdown (tarefa 4.3) usa regex `/[*_~\`#]/g` sobre a resposta do Gemini antes de retornar ao cliente
- As funções de fetch (tarefa 3) recebem parâmetros já resolvidos por `enforceRBAC` e `resolveAlunoContext` — nunca re-verificam RBAC internamente
- A tarefa 6 é de verificação e não requer escrita de código novo; serve como checklist final antes de considerar a feature completa
- O `ChatbotService.js` já existe com os stubs das funções `fetchNotas`, `fetchFaltas`, `fetchComunicados`, `fetchGradeHoraria`, `fetchProfessores`, `fetchTurmaGeral`, `fetchResumoGeral`, `fetchHistorico`, `buildPrompt` e `process` — as tarefas 3 e 4 consistem em substituir esses stubs pela implementação real

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7"] },
    { "id": 1, "tasks": ["4.1", "4.2"] },
    { "id": 2, "tasks": ["4.3", "4.4", "4.5"] },
    { "id": 3, "tasks": ["5.1"] },
    { "id": 4, "tasks": ["5.2", "5.3"] },
    { "id": 5, "tasks": ["5.4", "5.5"] },
    { "id": 6, "tasks": ["6.1", "6.2", "6.3", "6.4"] }
  ]
}
```
