# Requirements Document

## Introduction

Este documento especifica os requisitos para transformar o chatbot escolar existente em um assistente inteligente com consulta a dados reais do MongoDB, controle de acesso baseado em perfil (RBAC), interpretação de linguagem natural via Gemini e manutenção de contexto conversacional. Apenas o backend será modificado; a interface `ChatbotIA.tsx` e o endpoint `POST /api/ia/chatbot` permanecem inalterados.

## Requirements

---

### Requisito 1: Identificação de Intenção por Linguagem Natural

**História do Usuário:** Como qualquer usuário autenticado, quero que o chatbot entenda minha pergunta em linguagem natural, para que eu não precise usar comandos específicos.

#### Acceptance Criteria

1. WHEN o ChatbotService receber uma mensagem, THE ChatbotService SHALL classificar a mensagem em exatamente uma das seguintes intenções: `NOTAS`, `FALTAS`, `COMUNICADOS`, `TURMA_GERAL`, `HORARIO`, `PROFESSORES`, `RESUMO_GERAL` ou `INDEFINIDA`.

2. WHEN a mensagem contiver pelo menos um dos termos `nota`, `média`, `boletim`, `tirou`, `rendimento` ou `desempenho`, THE ChatbotService SHALL classificar a intenção como `NOTAS`.

3. WHEN a mensagem contiver pelo menos um dos termos `falta`, `presença`, `frequência`, `veio`, `presente` ou `ausente`, THE ChatbotService SHALL classificar a intenção como `FALTAS`.

4. WHEN a mensagem contiver pelo menos um dos termos `comunicado`, `aviso`, `reunião` ou `mural`, THE ChatbotService SHALL classificar a intenção como `COMUNICADOS`.

5. WHEN a mensagem contiver pelo menos um dos termos `turma`, `alunos` ou `sala`, THE ChatbotService SHALL classificar a intenção como `TURMA_GERAL`.

6. WHEN a mensagem contiver pelo menos um dos termos `horário`, `aula` ou `grade`, THE ChatbotService SHALL classificar a intenção como `HORARIO`.

7. WHEN a mensagem contiver pelo menos um dos termos `professor`, `leciona` ou `ensina`, THE ChatbotService SHALL classificar a intenção como `PROFESSORES`.

8. WHEN a mensagem contiver pelo menos um dos termos `como está`, `tudo bem`, `resumo` ou `situação`, THE ChatbotService SHALL classificar a intenção como `RESUMO_GERAL`.

9. WHEN nenhum dos termos mapeados for encontrado na mensagem, THE ChatbotService SHALL classificar a intenção como `INDEFINIDA` e encaminhar a mensagem diretamente ao Gemini sem consultar o banco de dados.

10. THE ChatbotService SHALL realizar a classificação de intenção de forma case-insensitive, normalizando a mensagem para letras minúsculas antes da comparação.

---

### Requisito 2: Manutenção de Contexto Conversacional

**História do Usuário:** Como usuário, quero que o chatbot lembre sobre qual aluno ou assunto estávamos conversando, para que eu possa fazer perguntas de acompanhamento sem repetir o contexto.

#### Acceptance Criteria

1. WHEN o corpo da requisição contiver o campo `alunoId` com valor não nulo, THE ChatbotService SHALL utilizar esse valor como AlunoContexto para a consulta ao banco de dados.

2. WHEN o corpo da requisição não contiver `alunoId` e o ChatbotService identificar o nome de um aluno na mensagem atual, THE ChatbotService SHALL resolver o aluno pelo nome para obter o AlunoContexto, respeitando as permissões do perfil do usuário.

3. WHEN o corpo da requisição não contiver `alunoId` e nenhum nome de aluno for identificado, THE ChatbotService SHALL encaminhar perguntas relacionadas a NOTAS ou FALTAS solicitando ao usuário que especifique o aluno desejado.

4. THE IAController SHALL retornar o campo `alunoId` resolvido na resposta JSON, permitindo que o frontend persista o contexto entre turnos consecutivos.

---

### Requisito 3: Controle de Acesso — Perfil Responsável

**História do Usuário:** Como responsável, quero consultar apenas os dados dos meus filhos vinculados à minha conta, para que minha privacidade e a de outros alunos seja preservada.

#### Acceptance Criteria

1. WHEN um usuário com perfil `responsavel` enviar uma mensagem com intenção `NOTAS` ou `FALTAS`, THE ChatbotService SHALL consultar o banco somente para alunos vinculados ao e-mail do usuário autenticado, identificados pelo campo `responsavel` ou `responsavelDados.email` do modelo `Aluno`.

2. WHEN um usuário com perfil `responsavel` estiver vinculado a mais de um aluno e não houver AlunoContexto na requisição, THE ChatbotService SHALL retornar uma mensagem listando os nomes dos filhos vinculados e solicitando que o usuário escolha qual consultar.

3. IF um usuário com perfil `responsavel` solicitar dados de um aluno não vinculado à sua conta, THEN THE ChatbotService SHALL retornar uma mensagem de acesso negado sem revelar a existência do aluno no banco.

4. WHEN um usuário com perfil `responsavel` consultar intenção `HORARIO`, THE ChatbotService SHALL retornar a grade horária somente da turma do aluno vinculado e selecionado como AlunoContexto.

5. WHEN um usuário com perfil `responsavel` consultar intenção `COMUNICADOS`, THE ChatbotService SHALL retornar somente comunicados cujo campo `destinatarios` inclua `'todos'`, `'responsaveis'` ou a turma do aluno vinculado.

6. WHEN um usuário com perfil `responsavel` consultar intenção `PROFESSORES`, THE ChatbotService SHALL retornar somente os professores das turmas dos alunos vinculados à conta do responsável.

---

### Requisito 4: Controle de Acesso — Perfil Professor

**História do Usuário:** Como professor, quero consultar dados apenas das turmas em que leciono, para ter visibilidade sobre meu próprio escopo de atuação.

#### Acceptance Criteria

1. WHEN um usuário com perfil `professor` enviar uma mensagem, THE ChatbotService SHALL buscar o documento `Professor` associado ao `idUsuario` do usuário autenticado para determinar as turmas autorizadas.

2. THE ChatbotService SHALL considerar como turmas autorizadas do professor a união de `salaPrincipal` e `salasAdicionais` do documento `Professor` correspondente.

3. WHEN um usuário com perfil `professor` consultar intenção `NOTAS`, `FALTAS` ou `TURMA_GERAL`, THE ChatbotService SHALL restringir a consulta ao banco somente a alunos pertencentes às turmas autorizadas do professor.

4. WHEN um usuário com perfil `professor` consultar intenção `HORARIO`, THE ChatbotService SHALL retornar somente os registros de `GradeHoraria` vinculados ao `professorId` do documento `Professor` do usuário autenticado.

5. IF um usuário com perfil `professor` solicitar dados de uma turma não vinculada ao seu documento `Professor`, THEN THE ChatbotService SHALL retornar uma mensagem informando que o acesso a essa turma não está autorizado.

---

### Requisito 5: Controle de Acesso — Perfil Diretor e Admin

**História do Usuário:** Como diretor ou administrador, quero acesso irrestrito a todos os dados do sistema, para tomar decisões informadas com visão global da escola.

#### Acceptance Criteria

1. WHEN um usuário com perfil `diretor` ou `admin` enviar uma mensagem, THE ChatbotService SHALL executar consultas ao banco sem filtros de turma ou aluno.

2. WHEN um usuário com perfil `diretor` ou `admin` solicitar intenção `RESUMO_GERAL`, THE ChatbotService SHALL agregar e retornar: média geral de notas da escola, percentual de frequência global e quantidade de comunicados ativos.

3. WHEN um usuário com perfil `diretor` ou `admin` solicitar intenção `TURMA_GERAL`, THE ChatbotService SHALL listar todas as turmas disponíveis no banco com seus respectivos quantitativos de alunos e médias de desempenho.

---

### Requisito 6: Controle de Acesso — Perfil Coordenador

**História do Usuário:** Como coordenador, quero consultar dados de todas as turmas e professores, para acompanhar o desempenho pedagógico da escola.

#### Acceptance Criteria

1. WHEN um usuário com perfil `coordenador` enviar uma mensagem, THE ChatbotService SHALL tratar as permissões do coordenador como equivalentes às permissões de `admin` para acesso a dados de turmas, professores e alunos.

2. WHEN um usuário com perfil `coordenador` solicitar intenção `TURMA_GERAL` ou `PROFESSORES`, THE ChatbotService SHALL retornar dados de todas as turmas e professores sem restrição.

---

### Requisito 7: Controle de Acesso — Perfil Secretaria

**História do Usuário:** Como secretaria, quero consultar dados cadastrais, matrículas, frequência e turmas, para executar tarefas administrativas sem acesso a configurações restritas.

#### Acceptance Criteria

1. WHEN um usuário com perfil `secretaria` enviar uma mensagem com intenção `FALTAS`, `TURMA_GERAL` ou `COMUNICADOS`, THE ChatbotService SHALL executar as consultas correspondentes sem restrição de turma.

2. WHEN um usuário com perfil `secretaria` solicitar intenção `NOTAS`, THE ChatbotService SHALL retornar as notas dos alunos conforme solicitado, sem restrição de turma.

3. IF um usuário com perfil `secretaria` enviar uma mensagem que implique acesso a configurações administrativas restritas, THEN THE ChatbotService SHALL retornar uma mensagem informando que essa funcionalidade não está disponível para o perfil secretaria.

---

### Requisito 8: Consulta de Notas

**História do Usuário:** Como usuário autorizado, quero perguntar sobre as notas de um aluno em linguagem natural, para obter informações de desempenho sem navegar por menus.

#### Acceptance Criteria

1. WHEN o ChatbotService identificar intenção `NOTAS` e houver AlunoContexto válido, THE ChatbotService SHALL consultar o modelo `Nota` filtrando por `alunoId` igual ao AlunoContexto.

2. WHEN a consulta de notas retornar resultados, THE ChatbotService SHALL calcular a média aritmética das notas encontradas e incluir esse valor no prompt enviado ao Gemini.

3. WHEN a mensagem mencionar um bimestre específico (ex.: `1º bimestre`, `segundo bimestre`), THE ChatbotService SHALL filtrar as notas pelo campo `bimestre` correspondente.

4. WHEN a mensagem mencionar uma matéria específica (ex.: `Matemática`, `Português`), THE ChatbotService SHALL filtrar as notas pelo campo `materiaId` correspondente, usando correspondência parcial case-insensitive.

5. IF a consulta de notas não retornar nenhum registro, THEN THE ChatbotService SHALL retornar uma mensagem informando que não foram encontradas notas para o período ou matéria solicitada, sem fabricar dados.

---

### Requisito 9: Consulta de Faltas e Frequência

**História do Usuário:** Como usuário autorizado, quero perguntar sobre as faltas de um aluno, para acompanhar a frequência escolar.

#### Acceptance Criteria

1. WHEN o ChatbotService identificar intenção `FALTAS` e houver AlunoContexto válido, THE ChatbotService SHALL consultar o modelo `Falta` filtrando por `aluno` igual ao AlunoContexto.

2. WHEN a consulta de faltas retornar resultados, THE ChatbotService SHALL calcular o percentual de frequência como `(registros com presente = true / total de registros) * 100` e incluir esse valor na resposta.

3. WHEN o percentual de frequência calculado for inferior a 75%, THE ChatbotService SHALL incluir na resposta um alerta explícito de frequência crítica.

4. WHEN o percentual de frequência estiver entre 75% e 84,9%, THE ChatbotService SHALL incluir na resposta um aviso de frequência em observação.

5. IF a consulta de faltas não retornar nenhum registro, THEN THE ChatbotService SHALL retornar uma mensagem informando que não há registros de frequência para o aluno, sem fabricar dados.

---

### Requisito 10: Consulta de Comunicados

**História do Usuário:** Como usuário autenticado, quero perguntar sobre comunicados recentes, para me manter informado sobre avisos e eventos da escola.

#### Acceptance Criteria

1. WHEN o ChatbotService identificar intenção `COMUNICADOS`, THE ChatbotService SHALL consultar o modelo `Comunicado` filtrando por `ativo = true`, respeitando os filtros de destinatários definidos pelo perfil do usuário.

2. WHEN a consulta de comunicados retornar resultados, THE ChatbotService SHALL ordenar por `dataCriacao` decrescente e limitar o retorno aos 5 mais recentes.

3. WHEN um comunicado possuir `prioridade` igual a `'Urgente'`, THE ChatbotService SHALL destacar esse comunicado na resposta gerada pelo Gemini.

4. IF a consulta de comunicados não retornar nenhum registro, THEN THE ChatbotService SHALL retornar uma mensagem informando que não há comunicados disponíveis no momento.

---

### Requisito 11: Consulta de Grade Horária

**História do Usuário:** Como usuário autorizado, quero consultar a grade horária de uma turma, para saber os horários das aulas.

#### Acceptance Criteria

1. WHEN o ChatbotService identificar intenção `HORARIO` e houver uma turma resolvida pelo contexto do perfil, THE ChatbotService SHALL consultar o modelo `GradeHoraria` filtrando por `turmaId` correspondente à turma autorizada.

2. WHEN a consulta retornar resultados, THE ChatbotService SHALL organizar as informações por dia da semana em ordem crescente de `diaSemana` e horário crescente de `horaInicio`.

3. IF a consulta não retornar nenhum registro, THEN THE ChatbotService SHALL retornar uma mensagem informando que a grade horária desta turma não está disponível no sistema.

---

### Requisito 12: Consulta de Professores

**História do Usuário:** Como usuário autorizado, quero perguntar quais professores lecionam em uma turma, para identificar os responsáveis pelas disciplinas.

#### Acceptance Criteria

1. WHEN o ChatbotService identificar intenção `PROFESSORES` e houver uma turma resolvida pelo contexto, THE ChatbotService SHALL consultar o modelo `Professor` cujo campo `salaPrincipal` ou `salasAdicionais` inclua a turma em questão.

2. WHEN a consulta retornar resultados, THE ChatbotService SHALL incluir na resposta o nome do professor e as matérias que ele leciona (`materias` e `disciplina`).

3. IF a consulta não retornar nenhum registro, THEN THE ChatbotService SHALL retornar uma mensagem informando que não foram encontrados professores vinculados à turma.

---

### Requisito 13: Respostas Humanizadas via Gemini

**História do Usuário:** Como usuário, quero receber respostas em texto natural e amigável, para que a interação com o chatbot seja fluida e compreensível.

#### Acceptance Criteria

1. WHEN o ChatbotService obtiver dados do banco, THE ChatbotService SHALL montar um prompt estruturado em Português-BR contendo: perfil do usuário, intenção identificada, dados consultados e a mensagem original, e encaminhar ao Gemini via `voiceService.generateInsightText`.

2. THE ChatbotService SHALL instruir o Gemini a responder exclusivamente em Português-BR com tom humanizado, empático e sem retornar JSON bruto na resposta final.

3. WHEN o Gemini retornar a resposta, THE ChatbotService SHALL remover formatação markdown residual (asteriscos, underscores, backticks) antes de retornar ao cliente.

4. IF o Gemini retornar erro ou timeout, THEN THE ChatbotService SHALL retornar uma mensagem de fallback padrão em Português-BR sem expor detalhes técnicos do erro.

5. WHEN a intenção for `INDEFINIDA`, THE ChatbotService SHALL encaminhar a mensagem diretamente ao Gemini com contexto sobre o sistema escolar, sem consultar o banco de dados.

---

### Requisito 14: Histórico e Memória Conversacional

**História do Usuário:** Como usuário, quero que o chatbot considere as últimas mensagens da nossa conversa ao responder, para que as respostas levem em conta o que já foi discutido.

#### Acceptance Criteria

1. WHEN o ChatbotService processar uma mensagem, THE ChatbotService SHALL consultar os últimos 5 documentos `ChatMensagem` do `usuarioId` autenticado, ordenados por `criadoEm` decrescente, para incluir histórico no prompt do Gemini.

2. WHEN o histórico estiver disponível, THE ChatbotService SHALL incluir as últimas interações no prompt do Gemini de forma resumida, indicando claramente que são mensagens anteriores da conversa.

3. IF a consulta ao histórico falhar, THEN THE ChatbotService SHALL prosseguir normalmente sem histórico, sem interromper o fluxo principal.

---

### Requisito 15: Persistência do Histórico

**História do Usuário:** Como administrador do sistema, quero que cada interação do chatbot seja registrada no banco, para fins de auditoria e análise de uso.

#### Acceptance Criteria

1. WHEN o ChatbotService gerar uma resposta com sucesso, THE IAController SHALL criar um documento no modelo `ChatMensagem` contendo: `usuarioId`, `usuarioPerfil`, `usuarioNome`, `alunoId` (quando disponível), `pergunta` e `resposta`.

2. IF a criação do documento `ChatMensagem` falhar, THEN THE IAController SHALL registrar um aviso no log e retornar a resposta ao usuário normalmente, sem interromper a experiência.

3. THE ChatbotService SHALL respeitar o TTL de 180 dias já configurado no índice do modelo `ChatMensagem`, sem modificar o schema do modelo.

---

### Requisito 16: Validação de Entrada e Tratamento de Erros

**História do Usuário:** Como usuário, quero receber mensagens de erro claras e amigáveis quando algo der errado, para entender o que aconteceu sem ver mensagens técnicas.

#### Acceptance Criteria

1. WHEN o IAController receber uma requisição com campo `message` ausente ou vazio após trimming, THE IAController SHALL retornar HTTP 400 com mensagem `"Mensagem vazia."`.

2. WHEN o IAController receber uma requisição de um usuário sem perfil definido, THE IAController SHALL tratar o perfil como `'indefinido'` e retornar HTTP 403 com mensagem informando que o perfil não está autorizado.

3. IF ocorrer erro de conexão com o MongoDB durante a execução do ChatbotService, THEN THE IAController SHALL capturar a exceção, registrar no log e retornar HTTP 500 com mensagem amigável em Português-BR, sem expor stack trace.

4. WHEN a mensagem do usuário exceder 1000 caracteres, THE IAController SHALL truncar a mensagem para 1000 caracteres antes de encaminhar ao ChatbotService.

---

### Requisito 17: Compatibilidade com os Frontends Existentes

**História do Usuário:** Como desenvolvedor, quero que o chatbot inteligente seja compatível com os frontends existentes, para não precisar modificar nenhum componente de interface.

#### Acceptance Criteria

1. THE IAController SHALL manter o endpoint `POST /api/ia/chatbot` com a mesma assinatura de request (`message`, `alunoId` opcionais no body) e a mesma estrutura de response (`{ success: true, data: { response, alunoId } }`).

2. THE ChatbotService SHALL aceitar requisições originadas tanto do portal do responsável (React/TypeScript) quanto do portal do professor/diretor (Vanilla JS), sem distinção de cliente.

3. THE IAController SHALL manter compatibilidade com o campo `usuarioPerfil` do modelo `ChatMensagem`, mapeando perfis não previstos no enum (`coordenador`, `secretaria`) para `'admin'` ao persistir o histórico.

---

## Glossário

- **ChatbotService**: Novo serviço (`backend/src/services/ChatbotService.js`) que centraliza toda a lógica do chatbot inteligente.
- **IAController**: Controller existente (`backend/src/controllers/IAController.js`) cuja função `chatbot()` será atualizada para delegar ao ChatbotService.
- **Intenção**: Categoria semântica identificada a partir da mensagem do usuário (ex.: NOTAS, FALTAS, COMUNICADOS).
- **Perfil**: Papel do usuário autenticado — `responsavel`, `professor`, `diretor`, `admin`, `coordenador` ou `secretaria`.
- **AlunoContexto**: Identificador do aluno sendo discutido na conversa, transmitido via campo `alunoId` no corpo da requisição.
- **Gemini**: Serviço externo de geração de texto (`voiceService.generateInsightText`) já configurado no projeto.
- **RBAC**: Controle de acesso baseado em perfis (Role-Based Access Control).
- **ChatMensagem**: Modelo MongoDB que persiste cada par pergunta/resposta com TTL de 180 dias.
