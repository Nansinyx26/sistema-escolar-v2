# RASCUNHO — PENDENTE DE VALIDAÇÃO JURÍDICA

> **Não publicar.** Lista dos fornecedores que tratam dados pessoais para o
> Sistema Escolar, conferida no código e na configuração do repositório. A
> coluna "Contrato / DPA" é institucional: nenhum contrato foi localizado no
> repositório. Transferência para fora do Brasil exige mecanismo do art. 33 da
> LGPD (Res. CD/ANPD nº 19/2024) `[VALIDAR COM JURÍDICO]`.

---

| Fornecedor | Serviço | Dados tratados | Onde processa | Evidência no código | Contrato / DPA |
|---|---|---|---|---|---|
| **Render** | hospedagem da aplicação | todos (em trânsito e em memória) | EUA (`region: oregon`) | `render.yaml` | `[PENDENTE]` |
| **MongoDB Atlas** | banco de dados e arquivos (GridFS) | todos | `[CONFIRMAR REGIÃO DO CLUSTER]` | `MONGODB_URI` | `[PENDENTE]` |
| **Google (Gemini)** | IA de texto | perguntas e dados de aluno **pseudonimizados**; só em escola que aderiu | EUA `[CONFIRMAR]` | `services/ia/`, `voiceService.js` | `[PENDENTE — confirmar plano contratado]` |
| **Google (login)** | login com conta Google do responsável | e-mail, nome, foto da conta | EUA `[CONFIRMAR]` | `/auth/google-login` | termos do Google `[VALIDAR]` |
| **ElevenLabs** | narração de texto | texto da tela (recusa texto que cite aluno) | EUA | `services/TTSService.js` | `[PENDENTE]` |
| **Resend** (ou **Brevo**) | envio de e-mail | e-mail do destinatário, conteúdo da mensagem (códigos, avisos) | `[CONFIRMAR]` | `services/EnvioEmail.js`, `EMAIL_HOST` | `[PENDENTE]` |
| **GitHub** | código e integração contínua | nenhum dado de produção (testes usam banco em memória) | EUA | `.github/workflows` | não se aplica a dado pessoal `[VALIDAR]` |

## Ações pendentes

1. `[MANTENEDORA]` Assinar ou aceitar o DPA de cada fornecedor e guardar cópia.
2. `[MANTENEDORA]` Confirmar a região do cluster do Atlas e declará-la no
   Render (`DATA_REGION`, `DATA_REGION_PAIS`). O sistema já responde a
   pergunta em `GET /api/conformidade/soberania`.
3. `[MANTENEDORA]` Confirmar o plano do Gemini. No nível gratuito, os termos
   permitem ao provedor usar o conteúdo enviado.
4. `[JURÍDICO]` Declarar a transferência internacional no aviso de
   privacidade.
