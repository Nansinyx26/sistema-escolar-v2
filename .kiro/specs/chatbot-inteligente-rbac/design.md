# Documento de Design — Chatbot Inteligente com RBAC

## Visão Geral

Este documento descreve a arquitetura técnica para transformar o chatbot escolar existente em um assistente inteligente. A única modificação ocorre no backend: será criado o serviço `ChatbotService.js` e a função `chatbot()` do `IAController.js` será refatorada para delegá-la. O endpoint `POST /api/ia/chatbot`, a assinatura de request/response e todos os componentes de frontend permanecem inalterados.

---

## Arquitetura de Componentes

```
Frontend (ChatbotIA.tsx)
        │
        │  POST /api/ia/chatbot
        │  { message, alunoId? }
        ▼
IAController.chatbot()          ← validação de entrada, persistência, resposta HTTP
        │
        │  delegação
        ▼
ChatbotService.process()        ← orquestração central
   ├── classifyIntent()         ← classificação de intenção por palavras-chave
   ├── resolveAlunoContext()    ← resolução do aluno pelo nome ou ID recebido
   ├── enforceRBAC()            ← filtros de acesso por perfil
   ├── fetchData()              ← consultas ao MongoDB por intenção
   ├── buildPrompt()            ← montagem do prompt estruturado
   └── voiceService.generateInsightText()  ← geração da resposta via Gemini
        │
        ▼
IAController  →  ChatMensagem.create()   ← persistência do histórico
        │
        ▼
{ success: true, data: { response, alunoId } }
```

---

## Novos Arquivos

| Arquivo | Descrição |
|---|---|
| `backend/src/services/ChatbotService.js` | Serviço principal com toda a lógica do chatbot inteligente |

## Arquivos Modificados

| Arquivo | Modificação |
|---|---|
| `backend/src/controllers/IAController.js` | `exports.chatbot()` refatorado para delegar ao ChatbotService |

---

## ChatbotService — Design Detalhado

### 1. Classificação de Intenção (`classifyIntent`)

Recebe a mensagem normalizada em lowercase e retorna uma das 8 intenções possíveis. A comparação é feita por inclusão de substring, sem regex, por questão de simplicidade e desempenho.

```
classifyIntent(message: string): Intencao

Mapa de palavras-chave:
  NOTAS        → ['nota', 'média', 'boletim', 'tirou', 'rendimento', 'desempenho']
  FALTAS       → ['falta', 'presença', 'frequência', 'veio', 'presente', 'ausente']
  COMUNICADOS  → ['comunicado', 'aviso', 'reunião', 'mural']
  TURMA_GERAL  → ['turma', 'alunos', 'sala']
  HORARIO      → ['horário', 'aula', 'grade']
  PROFESSORES  → ['professor', 'leciona', 'ensina']
  RESUMO_GERAL → ['como está', 'tudo bem', 'resumo', 'situação']
  INDEFINIDA   → (nenhum termo encontrado)

Regra de prioridade: a primeira intenção com match na ordem acima vence.
```

### 2. Resolução de Contexto do Aluno (`resolveAlunoContext`)

```
resolveAlunoContext(alunoId, message, perfil, userId): { aluno, alunoId }

1. Se alunoId vier no body → buscar Aluno.findById(alunoId), aplicar filtro RBAC
2. Se não vier → tentar extrair nome próprio da mensagem (token com inicial maiúscula)
   → buscar Aluno por regex no campo nome, aplicar filtro RBAC
3. Se não resolver → retornar null (IAController pedirá que o usuário especifique)
```

O filtro RBAC aplicado na busca por nome segue as mesmas regras de `enforceRBAC` descritas abaixo.

### 3. Enforcement de RBAC (`enforceRBAC`)

Retorna um objeto `{ alunoFilter, turmasAutorizadas, professorDoc }` que será injetado em todas as consultas.

```
Perfil responsavel:
  - alunoFilter: { $or: [
      { responsavel: emailUsuario },
      { 'responsavelDados.email': emailUsuario },
      { _id: { $in: idsVinculados } }      ← via Aluno.find com email
    ]}
  - turmasAutorizadas: turmas dos alunos vinculados
  - Se múltiplos filhos e sem AlunoContexto → retornar mensagem de seleção

Perfil professor:
  - Busca Professor.findOne({ idUsuario: userId })
  - turmasAutorizadas: union de [salaPrincipal, ...salasAdicionais]
  - alunoFilter: { turma: { $in: turmasAutorizadas } }
  - professorDoc: o documento encontrado (para consulta de horário)

Perfil diretor | admin | coordenador:
  - alunoFilter: {}  (sem restrição)
  - turmasAutorizadas: null  (todas)
  - professorDoc: null

Perfil secretaria:
  - alunoFilter: {}  (sem restrição)
  - turmasAutorizadas: null
  - Bloqueia apenas intenções de configuração administrativa
```

### 4. Consultas ao MongoDB por Intenção (`fetchData`)

#### NOTAS
```javascript
const query = { alunoId: String(alunoContexto) };
if (bimestre)  query.bimestre = bimestre;        // detectado na mensagem: "1º", "segundo", etc.
if (materia)   query.materiaId = new RegExp(materia, 'i');  // correspondência parcial
const notas = await Nota.find(query).lean();
const media = notas.reduce((s, n) => s + (parseFloat(n.nota) || 0), 0) / (notas.length || 1);
```

#### FALTAS
```javascript
const faltas = await Falta.find({ aluno: String(alunoContexto) }).lean();
const total = faltas.length;
const presentes = faltas.filter(f => f.presente).length;
const frequencia = total > 0 ? (presentes / total) * 100 : null;
// frequencia < 75 → alerta crítico
// 75 <= frequencia < 85 → aviso de observação
```

#### COMUNICADOS
```javascript
// Filtro de destinatários por perfil:
// responsavel → { $in: ['todos', 'responsaveis', `turma:${turmaAluno}`] }
// professor   → { $in: ['todos', 'professores'] }
// admin/diretor/coordenador/secretaria → sem filtro de destinatários
const comunicados = await Comunicado.find({
  ativo: true,
  destinatarios: filtroDestinatarios
}).sort({ dataCriacao: -1 }).limit(5).lean();
```

#### HORARIO
```javascript
// turmaId resolvida pelo perfil:
// responsavel → turma do AlunoContexto
// professor   → turmasAutorizadas (todas as suas turmas)
// admin/etc   → turmaId extraída da mensagem ou AlunoContexto
const grade = await GradeHoraria.find({ turmaId })
  .sort({ diaSemana: 1, horaInicio: 1 }).lean();
```

#### PROFESSORES
```javascript
// turma resolvida pelo perfil
const professores = await Professor.find({
  $or: [
    { salaPrincipal: turma },
    { salasAdicionais: turma }
  ]
}).select('nome materias disciplina').lean();
```

#### TURMA_GERAL
```javascript
// admin/diretor/coordenador/secretaria → agrupa todos os alunos por turma
// professor → restringe a turmasAutorizadas
const alunos = await Aluno.find(alunoFilter).select('nome turma').lean();
// agrupa por turma e calcula média de notas por turma
```

#### RESUMO_GERAL (apenas admin/diretor/coordenador)
```javascript
const [mediaEscola, totalFaltas, totalAulas, totalComunicados] = await Promise.all([
  Nota.aggregate([{ $group: { _id: null, media: { $avg: { $toDouble: '$nota' } } } }]),
  Falta.countDocuments({ presente: false }),
  Falta.countDocuments(),
  Comunicado.countDocuments({ ativo: true })
]);
const frequenciaGlobal = totalAulas > 0 ? ((totalAulas - totalFaltas) / totalAulas) * 100 : 100;
```

#### INDEFINIDA
```
→ Não consultar o banco.
→ Encaminhar mensagem diretamente ao Gemini com prompt contextualizado.
```

### 5. Histórico Conversacional

```javascript
const historico = await ChatMensagem
  .find({ usuarioId: String(userId) })
  .sort({ criadoEm: -1 })
  .limit(5)
  .lean();
// Incluir no prompt de forma resumida:
// "Histórico recente:\n[Usuário]: ...\n[Assistente]: ..."
// Falha silenciosa: se der erro, prosseguir sem histórico
```

### 6. Construção do Prompt (`buildPrompt`)

```
Sistema: Você é um assistente escolar prestativo. Responda SEMPRE em Português-BR,
com tom empático e humanizado. NÃO retorne JSON bruto. NÃO use markdown.

Perfil do usuário: {perfil}
Intenção identificada: {intencao}
Pergunta original: {message}

[Histórico recente]
{historico formatado}

[Dados consultados do banco]
{dados serializados como texto legível}

Gere uma resposta natural, direta e amigável baseada nesses dados.
```

### 7. Pós-processamento da Resposta Gemini

```javascript
// Remover markdown residual que o Gemini possa retornar
response = response.replace(/[*_~`#]/g, '').trim();
```

### 8. Fallback de Erro do Gemini

```javascript
// Se voiceService.generateInsightText() lançar exceção:
return 'Desculpe, estou com dificuldade para processar sua pergunta agora. Tente novamente em instantes.';
```

---

## IAController — Refatoração de `chatbot()`

```javascript
exports.chatbot = async (req, res) => {
  try {
    // 1. Validação de entrada
    let { message, alunoId } = req.body;
    const perfil = (req.user?.perfil || '').toLowerCase();
    const userId  = req.user?.id || req.user?._id;
    const nomeUsuario = req.user?.nome || 'Usuário';

    if (!message || !message.trim())
      return res.status(400).json({ success: false, error: 'Mensagem vazia.' });

    if (!perfil)
      return res.status(403).json({ success: false, error: 'Perfil de usuário não autorizado.' });

    // 2. Truncar mensagem excessivamente longa
    if (message.length > 1000) {
      logger.warn(`[Chatbot] Mensagem truncada de ${message.length} para 1000 chars`);
      message = message.substring(0, 1000);
    }

    // 3. Delegar ao ChatbotService
    const { response, alunoId: resolvedAlunoId } =
      await ChatbotService.process({ message, alunoId, perfil, userId, nomeUsuario, userEmail: req.user?.email });

    // 4. Persistir histórico (falha silenciosa)
    const perfilParaSalvar = ['admin','diretor','professor','responsavel'].includes(perfil)
      ? perfil : 'admin';   // coordenador e secretaria mapeados para 'admin'
    await ChatMensagem.create({
      usuarioId:     String(userId),
      usuarioPerfil: perfilParaSalvar,
      usuarioNome:   nomeUsuario,
      alunoId:       resolvedAlunoId || null,
      pergunta:      message,
      resposta:      response
    }).catch(e => logger.warn(`[Chatbot] Erro ao salvar histórico: ${e.message}`));

    // 5. Resposta
    return res.json({ success: true, data: { response, alunoId: resolvedAlunoId } });

  } catch (error) {
    logger.error(`[Chatbot] Erro: ${error.message}`);
    return res.status(500).json({ success: false, error: 'Não foi possível processar sua pergunta. Tente novamente.' });
  }
};
```

---

## ChatbotService — Interface Pública

```javascript
/**
 * ChatbotService.process(params)
 *
 * @param {Object}  params
 * @param {string}  params.message       Mensagem do usuário (já truncada)
 * @param {string}  [params.alunoId]     ID do aluno do turno anterior (contexto)
 * @param {string}  params.perfil        Perfil autenticado em lowercase
 * @param {string}  params.userId        ID do usuário autenticado
 * @param {string}  params.nomeUsuario   Nome do usuário autenticado
 * @param {string}  [params.userEmail]   Email do usuário (necessário para perfil responsavel)
 *
 * @returns {Promise<{ response: string, alunoId: string|null }>}
 */
```

---

## Fluxo de Execução — Diagrama Sequencial

```
IAController.chatbot()
    │── valida message (400 se vazio)
    │── valida perfil (403 se ausente)
    │── trunca message se > 1000 chars
    │
    └── ChatbotService.process()
            │── normaliza message → lowercase
            │── classifyIntent()    → intencao
            │── resolveAlunoContext() → { aluno, alunoId }
            │── enforceRBAC()       → { alunoFilter, turmasAutorizadas, professorDoc }
            │
            │── [INDEFINIDA] → buildPromptIndefinido() → Gemini → response
            │
            │── [Outras intenções]
            │       │── fetchHistorico()        → últimos 5 ChatMensagem
            │       │── fetchData(intencao)     → dados do MongoDB
            │       │── buildPrompt()           → prompt estruturado
            │       └── voiceService.generateInsightText() → response
            │           └── [erro Gemini] → mensagem de fallback
            │
            └── return { response, alunoId }

IAController
    │── ChatMensagem.create()  (falha silenciosa)
    └── res.json({ success: true, data: { response, alunoId } })
```

---

## Tratamento de Casos Especiais

### Responsável com múltiplos filhos e sem contexto
```
[intenção NOTAS ou FALTAS, perfil responsavel, sem alunoId]
→ ChatbotService retorna:
  response: "Encontrei mais de um aluno vinculado à sua conta: João Silva, Maria Silva.
             Sobre qual deles você gostaria de saber?"
  alunoId: null
```

### Professor sem turma autorizada para a consulta
```
[perfil professor, turma solicitada ∉ turmasAutorizadas]
→ response: "Você não tem permissão para acessar dados desta turma."
```

### Responsável tentando acessar aluno de terceiro
```
[perfil responsavel, alunoId fornecido não vinculado ao usuário]
→ response: "Não encontrei informações para este aluno na sua conta."
  (sem revelar se o aluno existe no banco)
```

### Secretaria tentando acesso administrativo
```
[perfil secretaria, intenção implica configuração admin]
→ response: "Esta funcionalidade não está disponível para o perfil secretaria."
```

---

## Detecção de Bimestre e Matéria na Mensagem

### Bimestre
```javascript
// Detectar padrões: "1º bimestre", "segundo bimestre", "2o bim", "3° bimestre"
const bimestreMap = {
  '1': 1, 'um': 1, 'primeiro': 1,
  '2': 2, 'dois': 2, 'segundo': 2,
  '3': 3, 'três': 3, 'terceiro': 3,
  '4': 4, 'quatro': 4, 'quarto': 4
};
// Regex: /(\d+|primeiro|segundo|terceiro|quarto|um|dois|tr[eê]s|quatro)[°º]?\s*bim(estre)?/i
```

### Matéria
```javascript
// Lista de matérias conhecidas para correspondência parcial:
const MATERIAS_CONHECIDAS = [
  'matemática', 'português', 'história', 'geografia', 'ciências',
  'física', 'química', 'biologia', 'inglês', 'artes', 'educação física'
];
// Verificar se alguma matéria conhecida aparece na mensagem (lowercase)
```

---

## Compatibilidade com Frontends

Nenhuma alteração é necessária nos frontends. O campo `alunoId` retornado na resposta deve ser persistido pelo frontend como estado local e reenviado no próximo turno para manter o contexto. O `ChatbotIA.tsx` já recebe `res.alunoId` mas não o persiste entre turnos — isso é responsabilidade do frontend existente e está fora do escopo deste documento.

---

## Dependências

Nenhuma nova biblioteca npm é necessária. O serviço utiliza exclusivamente:
- Modelos Mongoose já existentes (`Aluno`, `Nota`, `Falta`, `Professor`, `Comunicado`, `GradeHoraria`, `ChatMensagem`)
- `voiceService.generateInsightText()` já configurado
- `logger` já configurado (`backend/src/utils/logger`)
