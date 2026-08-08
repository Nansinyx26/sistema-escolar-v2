# Envio de e-mail — como funciona e como diagnosticar

O 2FA de **diretor** e **secretaria** depende inteiramente deste canal. Se ele
para, esses perfis ficam trancados fora do sistema.

## Onde fica

Um arquivo só: [`backend/src/services/EnvioEmail.js`](../backend/src/services/EnvioEmail.js).

```js
const { enviarEmail, verificarEnvio } = require('../services/EnvioEmail');

const r = await enviarEmail(para, assunto, html);
// r = { ok, messageId, etapa, erro, duracaoMs, transporte }
```

`enviarEmail` **nunca lança** — devolve o resultado para quem chamou decidir o
que dizer ao usuário. Trocar de provedor mexe apenas neste arquivo.

## Como o transporte é escolhido

Pelo **formato da chave** em `EMAIL_PASS`, sem variável extra para configurar errado:

| `EMAIL_PASS` começa com | Transporte | Porta |
|---|---|---|
| `re_` | API HTTPS do Resend | 443 |
| `xkeysib-` / `xsmtpsib-` | API HTTPS do Brevo | 443 |
| qualquer outra (+ `EMAIL_HOST`) | SMTP | `EMAIL_PORT` (465 TLS / 587 STARTTLS) |

**Prefira sempre uma chave de API.** O Render bloqueia conexão SMTP de saída —
foi exatamente essa a causa da entrega quebrada. HTTPS/443 não sofre bloqueio.

Porta **25 nunca funciona** em hospedagem. Não use.

## Variáveis de ambiente

| Variável | Obrigatória | Observação |
|---|---|---|
| `EMAIL_PASS` | **sim** | Chave de API do provedor |
| `EMAIL_FROM` | **sim** | Remetente **de domínio verificado**. Sem ela nada sai. |
| `EMAIL_HOST` | só p/ SMTP | Ignorada quando `EMAIL_PASS` é chave de API |
| `EMAIL_PORT` | só p/ SMTP | 465 ou 587. Nunca 25. |
| `EMAIL_USER` | só p/ SMTP | Ignorada nas APIs HTTPS |

Todas vivem **apenas** no painel do Render (Environment). Nenhuma vai ao
repositório.

### Se for Gmail

Exige **senha de app** (com 2FA da conta Google ativado), nunca a senha normal —
e ainda assim depende de SMTP, que o Render bloqueia. Não é recomendado aqui.

## Diagnóstico

Duas rotas, ambas exigindo sessão de **admin**:

```
GET /api/admin/diag/email                    verifica + envia teste p/ o seu e-mail
GET /api/admin/diag/email?enviar=false       só verifica a configuração
GET /api/admin/diag/email?para=voce@dom.com  escolhe o destinatário do teste
GET /api/admin/diag/contas-2fa               contas que exigem 2FA e não têm e-mail válido
```

A resposta traz a **mensagem real do provedor** e um campo `sugestao` com a ação
concreta:

```json
{ "ok": false, "etapa": "envio", "transporte": "resend-api",
  "erro": "The domain is not verified",
  "sugestao": "O domínio do EMAIL_FROM não está verificado no provedor..." }
```

`etapa` diz onde parou: `configuracao` (variável faltando), `conexao`
(credencial recusada / rede) ou `envio` (o provedor recusou a mensagem).

No **boot** o servidor roda `verificarEnvio()` e registra o resultado. Uma falha
vira alerta `EMAIL_INDISPONIVEL` no log — a configuração quebrada deixou de ser
silenciosa.

## O que estava errado antes

1. **Cinco** `nodemailer.createTransport` independentes, com defaults
   divergentes. Um apontava para `smtp.mailtrap.io:2525`, que captura a
   mensagem e nunca entrega.
2. `EMAIL_FROM` não estava definida → remetente caía em `noreply@escola.com`,
   domínio não verificado → provedor recusa tudo.
3. O envio do código 2FA no login era **fire-and-forget**
   (`sendMail(...).catch(console.error)`). A resposta HTTP dizia "código
   enviado" e voltava antes do envio terminar.
4. `nodemailerPatch.js` desviava para a API HTTP **só se** `EMAIL_HOST` contivesse
   "brevo". Com Resend configurado, caía no SMTP bloqueado.
5. Nenhum `verify()` em lugar nenhum.
6. O aviso LGPD de 30 dias recebia `transporter` como parâmetro e a cadeia
   inteira o passava `undefined` — **nunca foi enviado a ninguém**.

## Trocar de provedor

1. Gere a chave no provedor novo.
2. Troque `EMAIL_PASS` e `EMAIL_FROM` no Render.
3. Se o provedor não for Resend nem Brevo, adicione a função dele em
   `EnvioEmail.js` (siga `viaResend` como modelo) e o prefixo da chave em
   `transporteEscolhido()`.
4. Valide com `GET /api/admin/diag/email`.

Nenhum outro arquivo precisa mudar.
