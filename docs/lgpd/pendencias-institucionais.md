# Pendências institucionais — o que o código não resolve

> Lista viva do que depende de decisão, contrato ou laudo, e não de programação.
> Cada linha diz **quem decide** e **o que trava** enquanto não houver decisão.
> Mantida junto com `docs/CONFORMIDADE-LEGAL.md`, que descreve o que o código faz.

## 1. Identificação e papéis

| Pendência | Quem decide | O que trava |
|---|---|---|
| Quem é o **controlador** (mantenedora, secretaria municipal, escola) | Mantenedora + jurídico | Publicação do aviso de privacidade; contratos com fornecedores |
| Nomear e divulgar o **encarregado (DPO)**, com canal próprio | Mantenedora | Aviso de privacidade; canal de atendimento ao titular |
| **Registro das operações de tratamento** (LGPD, art. 37) | Encarregado | Resposta a pedido da ANPD ou de edital |

## 2. Fornecedores e hospedagem

| Pendência | Quem decide | O que trava |
|---|---|---|
| Contrato/DPA com **Render** (aplicação, hoje em região dos EUA) | Mantenedora + jurídico | Transferência internacional documentada (art. 33) |
| Contrato/DPA e **região** do **MongoDB Atlas** | Mantenedora | O mesmo, e a resposta sobre onde os dados de criança ficam |
| **Plano contratado do Gemini** e DPA do Google | Mantenedora | Uso do assistente com qualquer dado, mesmo pseudonimizado — o plano gratuito permite ao provedor usar o conteúdo enviado |
| DPA do **ElevenLabs** (narração) e do provedor de e-mail | Mantenedora | Narração e envio de avisos |
| **Backup**: existe rotina automática? Onde fica a cópia? | Mantenedora + TI | Recuperação depois de incidente (art. 46) |

## 3. Decisões sobre o produto

| Pendência | Quem decide | Padrão hoje no código |
|---|---|---|
| Usar o **assistente de IA**, e em quais escolas | Direção/mantenedora | **Desligado** (`IA_ESCOLAS_PADRAO`, `Escola.iaHabilitada`) |
| Professor ver **detalhe de deficiência e transtornos** | Direção + equipe pedagógica | Não vê; recebe indicador de necessidade de apoio (`PROFESSOR_VE_DETALHE_DEFICIENCIA`) |
| Professor ver a **lista de pessoas autorizadas à retirada** | Direção | Não vê (`PROFESSOR_VE_RETIRADA`); onde o professor entrega a criança na saída, pode ser ligado sem o documento |
| Manter **CPF do aluno** e **plano de saúde** no cadastro | Secretaria + jurídico | Campos existem e são aceitos |
| Rodar a limpeza dos campos removidos na #408 nos cadastros antigos | Secretaria | Script pronto, em modo de simulação (`campos:limpar-sem-finalidade`) |
| **Anonimização automática** de contas inativas | Mantenedora | 12 meses sem acesso |
| **Regenerar os códigos de vínculo** dos alunos e como avisar as famílias | Direção | Script pronto, em modo de simulação |

## 4. Prazos de guarda

| Pendência | Quem decide | O que trava |
|---|---|---|
| **Tabela de temporalidade** dos documentos escolares | Secretaria de Educação + arquivo público | Política de retenção; descarte de documento enviado pela família |
| Prazo de guarda dos **documentos de autorização** | Secretaria + jurídico | Limpeza do armazenamento |
| Prazo do **registro de auditoria** (hoje 365 dias) | Encarregado | Investigação de incidente antigo |

## 5. Segurança operacional

| Pendência | Quem decide | O que trava |
|---|---|---|
| Permissão do usuário de aplicação no Atlas (sem `update`/`remove` em `audit_logs`) | TI | Imutabilidade do log no banco, não só na aplicação |
| **Plano de resposta a incidentes** aprovado, com quem comunica | Encarregado + mantenedora | Cumprimento do prazo de comunicação em caso de incidente |
| Laudo de **acessibilidade** (WCAG/eMAG) com leitor de tela | Mantenedora | Declaração exigida em edital |
| Repositório **público** no GitHub | Mantenedora + TI | Exposição do código e do histórico; decisão de fechar ou manter |

---

Atualizado junto com as Issues do plano de conformidade (#378 e seguintes).
