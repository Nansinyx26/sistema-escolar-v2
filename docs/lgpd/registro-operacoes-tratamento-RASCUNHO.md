# RASCUNHO — PENDENTE DE VALIDAÇÃO JURÍDICA

> **Não publicar.** Registro das operações de tratamento de dados pessoais
> (LGPD, art. 37), preenchido com o que o código do Sistema Escolar trata de
> fato. Cada linha aponta a coleção no banco (`backend/src/models/`). Bases
> legais seguem a coluna "escola pública" da auditoria e precisam de
> validação.

---

**Controlador:** `[MANTENEDORA / SECRETARIA MUNICIPAL DE EDUCAÇÃO]`
**Encarregado:** `[NOME, CONTATO]`
**Operadores:** ver `fornecedores-e-subprocessadores-RASCUNHO.md`
**Data desta versão:** `[ ]`

## 1. Operações

| # | Operação | Titulares | Dados | Coleções | Base legal `[VALIDAR]` | Quem acessa | Retenção no sistema |
|---|---|---|---|---|---|---|---|
| 1 | Matrícula e cadastro do aluno | alunos (crianças e adolescentes) | nome, nascimento, RA, turma, endereço, cor/raça, deficiência, alergias, transtornos, contatos | `Aluno`, `Matricula`, `Turma` | art. 7º II e III; art. 11, II, "a" (Censo) e "e" (alergia); art. 14 | gestão da escola; professor só o necessário (lista fechada por perfil) | sem prazo; aluno que sai pode ser anonimizado preservando a vida escolar |
| 2 | Vida escolar: notas e frequência | alunos | notas, faltas, motivo da falta, justificativas | `Nota`, `Falta`, `JustificativaFalta`, `Avaliacao`, `AvaliacaoHistorico` | art. 7º II e III; LDB | professor da turma, gestão, responsável do aluno | sem prazo `[TABELA DE TEMPORALIDADE]` |
| 3 | Cadastro dos responsáveis e vínculo com o aluno | responsáveis | nome, e-mail, telefone, CPF `[DECISÃO: manter?]`, parentesco, guarda, pessoas autorizadas à retirada | `Aluno` (campos de responsáveis), `SolicitacaoVinculo`, `Usuario` | art. 7º II e III (LDB art. 12, VIII; ECA art. 56) | gestão; responsável do próprio vínculo | enquanto durar o vínculo |
| 4 | Contas de acesso | equipe e responsáveis | nome, e-mail, senha (hash), segundo fator, histórico de aceites | `Usuario`, `Professor`, `Diretor`, `Secretaria`, `ConviteEquipe`, `RecuperacaoSenha`, `TokenRevogado` | art. 7º III ou V; art. 46 | o próprio titular; administração | conta inativa 12 meses: responsável sem vínculo ativo é anonimizado, equipe é desativada |
| 5 | Autorizações e documentos da família | alunos e responsáveis | autorizações (passeio, medicamento, condução), documentos enviados, versões e hash | `Autorizacao`, `DocumentoResponsavel`, arquivos no GridFS | art. 7º II e VI; art. 11, II, "e" (medicamento) | gestão; responsável que enviou; professor vê só a situação, se a direção liberar | versões preservadas `[PRAZO — VALIDAR]` |
| 6 | Comunicação escola–família | equipe e responsáveis | mensagens, anexos, áudio, comunicados | `ChatDireto`, `Comunicado`, `Notificacao`, `RealtimeNotification`, `MessageReaction`, `Comentario` | art. 7º III ou V | participantes da conversa; destinatários do comunicado | chat direto: `CHAT_RETENCAO_DIAS` (desligado por padrão) |
| 7 | Assistentes de IA | equipe e responsáveis | pergunta, resposta; dado de aluno pseudonimizado antes do envio | `IaConversa`, `ChatMensagem`, `IaAcaoPendente` | `[VALIDAR COM JURÍDICO]` | o próprio usuário | 90 dias (copiloto) e 180 dias (assistente do portal) |
| 8 | Moderação de conteúdo | quem envia mensagens | trecho recusado, ocorrência | `ModeracaoOcorrencia`, `ModeracaoJob` | art. 7º IX `[VALIDAR]`; proteção da criança | moderação da escola | por ocorrência (`expiraEm`) |
| 9 | Registro de auditoria | todos os usuários | ação, recurso, ids, IP, navegador | `AuditLog` | art. 7º II; art. 37; art. 46 | administração | 365 dias, só inclusão |
| 10 | Segurança do acesso | todos | IP, tentativas, bloqueios | `BloqueioIp`, `RateLimitContador`, `SecurityConfig` | art. 7º IX `[VALIDAR]`; art. 46 | administração | automático (`expiraEm`) |
| 11 | Pedidos do titular | quem pede | tipo, protocolo, motivo, histórico | `PedidoTitular` | art. 7º II; arts. 18 e 19 | administração; o próprio titular | `[PRAZO — VALIDAR]` |
| 12 | Conselho Tutelar e Censo | alunos | frequência, dados do Censo | geração sob demanda (sem coleção própria) | art. 7º II; ECA; LDB art. 24 | gestão | arquivo gerado não fica no sistema |
| 13 | Dados abertos | — (agregado) | indicadores com k-anonimato (k=5) | geração sob demanda | art. 7º III; LAI | público | — |
| 14 | Avaliações do sistema | usuários que avaliam | nota, texto; publicação só com adesão e iniciais | `AvaliacaoSistema`, `SiteReview` | consentimento para a publicação | administração modera | `[PRAZO]` |
| 15 | Narração de texto | quem ativa | texto da tela (recusa texto que cite aluno) | `TtsAudioCache` | `[VALIDAR]` | — | 30 dias |

## 2. Dados sensíveis tratados

Cor/raça, deficiência, transtornos, alergias e medicação (art. 11). Religião e
responsabilidade financeira foram removidas do cadastro por não terem
finalidade.

## 3. Transferência internacional

Hospedagem e fornecedores com processamento nos EUA — ver
`fornecedores-e-subprocessadores-RASCUNHO.md`. `[VALIDAR COM JURÍDICO]`
mecanismo do art. 33.

## 4. Medidas de segurança (resumo)

Senha com bcrypt, segundo fator para equipe, sessão em cookie HttpOnly com
revogação, CSRF, CORS fechado, CSP, filtro por escola e por turma em toda rota
com id de aluno, lista fechada de campos por perfil, log só de inclusão, IA
com pseudonimização, uploads conferidos pelo conteúdo.
