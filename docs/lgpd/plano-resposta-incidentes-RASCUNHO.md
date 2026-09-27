# RASCUNHO — PENDENTE DE VALIDAÇÃO JURÍDICA

> **Não publicar.** Plano de resposta a incidentes de segurança com dados
> pessoais. A comunicação à ANPD e aos titulares segue a Res. CD/ANPD
> nº 15/2024; o prazo citado na auditoria é de **3 dias úteis**
> `[VALIDAR COM JURÍDICO]` contagem e hipóteses. **A decisão de comunicar é do
> controlador e do encarregado**, nunca da equipe técnica sozinha.

---

## 1. Papéis

| Papel | Quem | Contato |
|---|---|---|
| Encarregado (DPO) | `[ ]` | `[ ]` |
| Controlador (decide comunicar) | `[ ]` | `[ ]` |
| Responsável técnico | `[ ]` | `[ ]` |
| Direção da escola afetada | `[ ]` | `[ ]` |

## 2. O que é incidente

Qualquer acesso não autorizado, vazamento, perda, alteração ou
indisponibilidade de dado pessoal. Exemplos no contexto do sistema:

- conta de equipe usada por outra pessoa;
- responsável acessando aluno sem vínculo;
- dado de uma escola visível para outra;
- exportação ou arquivo com dado de aluno fora do lugar;
- perda do banco ou do armazenamento de arquivos.

## 3. Passos

1. **Registrar** o que se sabe: data, hora, como foi percebido, quem percebeu.
2. **Conter** sem apagar evidência:
   - encerrar sessões da conta suspeita (incrementar `tokenVersion`; o script
     `npm run sessoes:encerrar-equipe` faz isso para a equipe, em simulação por
     padrão);
   - desativar a conta;
   - bloquear a escola pelo painel do super admin, se necessário;
   - regenerar códigos de vínculo (`npm run codigos:regenerar-alunos`).
3. **Preservar evidências:** exportar o `AuditLog` do período. Ele só aceita
   inclusão e guarda 365 dias.
4. **Avaliar** com o encarregado: quais dados, quantos titulares, se há
   criança ou dado sensível, e o risco ou dano relevante.
5. **Decidir sobre a comunicação** (controlador + encarregado): à ANPD e aos
   titulares, no prazo e na forma da Res. CD/ANPD nº 15/2024.
6. **Corrigir** a causa, com Issue e teste de regressão, como qualquer correção.
7. **Registrar** o incidente e a decisão, mesmo quando não houver comunicação.

## 4. Onde olhar

| Pergunta | Fonte |
|---|---|
| Quem acessou o quê | `AuditLog` (por ação, recurso e id) |
| Tentativas de login e bloqueios | `BloqueioIp`, `RateLimitContador` |
| Sessões encerradas | `TokenRevogado` |
| Alertas do servidor | logs da aplicação (sem PII por regra) |

## 5. Modelo de registro

- Data/hora da ciência:
- Descrição:
- Dados e titulares afetados (quantidade, se há crianças, se há dado sensível):
- Medidas de contenção:
- Avaliação de risco:
- Decisão sobre comunicação e justificativa:
- Comunicações feitas (data, destinatário):
- Correção definitiva (Issue/PR):

## 6. Pendências

- `[DECISÃO]` canal de plantão e substitutos.
- `[CONFIRMAR]` existência e local do backup (tier do Atlas).
