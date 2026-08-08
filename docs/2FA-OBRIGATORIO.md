# 2FA obrigatório — ativação e recuperação de acesso

> **Leia antes de ativar na conta admin.** Exigir segundo fator de uma conta
> administrativa é a operação com o pior modo de falha do sistema: se o e-mail
> estiver quebrado e não houver códigos de backup, o próximo login falha e
> **não há ninguém dentro para desfazer**. O conserto passa a exigir acesso
> direto ao banco de produção.

## Quem precisa de segundo fator

Duas fontes, nesta ordem:

| Fonte | Onde | Efeito |
|---|---|---|
| `twoFactorEnabled` na conta | banco, por usuário | liga só naquela conta — é o mecanismo de **rollout** |
| `PERFIS_2FA_OBRIGATORIO` | variável de ambiente | liga para o **perfil inteiro** |
| `DISPENSAR_2FA_EMAIL` | variável de ambiente | **desliga**, e vence as duas anteriores |

```
PERFIS_2FA_OBRIGATORIO=diretor,secretaria,admin
```

Vazia, o padrão é `diretor,secretaria` — a política que já existia. Um deploy
sem a variável **não afrouxa nada**.

`DISPENSAR_2FA_EMAIL` é a saída de emergência: enquanto estiver preenchida, o
boot emite o alerta `SEGURANCA_2FA_DISPENSADO` e todo login sem segundo fator
entra na auditoria como `LOGIN_SEM_2FA`.

---

## Roteiro de ativação (siga na ordem)

### 1. Verifique a prontidão

```
GET /api/admin/2fa/prontidao/<SEU_USUARIO_ID>
```

Responde `ok: true` só quando as três condições valem:

- a conta tem e-mail válido cadastrado;
- o canal de e-mail está operacional **agora** (checagem viva, não o estado do boot);
- existem códigos de backup disponíveis.

Se vier `bloqueios: [...]`, resolva antes. Cada item diz exatamente o que falta.

### 2. Ative **na sua conta admin primeiro**

```
POST /api/admin/2fa/ativar/<SEU_USUARIO_ID>
```

Liga `twoFactorEnabled` **e** devolve 8 códigos de backup na mesma resposta —
a única vez em que existem legíveis. **Imprima e guarde fora do computador.**

A rota recusa (409) se a prontidão falhar. `?forcar=true` ignora a recusa, para
o caso legítimo de ativar sabendo que o e-mail está fora e contando apenas com
os códigos impressos. Deve ser escolha declarada, nunca o caminho fácil.

### 3. Valide de verdade

Saia, entre de novo, confirme que o código chega e que o login completa.
**Teste também um código de backup** — é a única forma de saber que a rede de
segurança funciona antes de precisar dela.

### 4. Só então propague

```
PERFIS_2FA_OBRIGATORIO=diretor,secretaria,admin
```

Antes disso, gere códigos de backup para as outras contas administrativas:
`Painel admin → Usuários → 🔑`.

---

## Recuperação de acesso

Em ordem, do mais simples ao mais invasivo.

### A. O código não chegou no e-mail

1. `GET /api/admin/diag/email` — diz se o canal está de pé, com a mensagem real do provedor
2. `GET /api/admin/diag/contas-2fa` — lista contas que exigem 2FA e não têm e-mail válido
3. No provedor, confira **contatos bloqueados**: quem clica em "Cancelar inscrição" para de receber

### B. Use um código de backup

Na tela de login, digite o código de 10 dígitos no mesmo campo dos 6 dígitos.
Cada um funciona **uma vez**. O sistema avisa quantos restam.

### C. Perdeu os códigos, mas há um admin com acesso

`Painel admin → Usuários → 🔑 → Gerar 8 códigos` (invalida o lote anterior).

### D. Nenhum admin consegue entrar

Este é o cenário que o roteiro existe para evitar. Exige acesso ao ambiente:

**Opção 1 — dispensar o perfil temporariamente** (sem deploy):
```
Render → Environment → DISPENSAR_2FA_EMAIL=admin
```
Salvar, aguardar o restart, entrar, corrigir o e-mail, gerar códigos novos,
**apagar a variável**.

**Opção 2 — código fixo por linha de comando** (exige `MONGODB_URI`):
```bash
cd backend
node scripts/definir-codigo-fixo-2fa.js admin@escola.com
```
Imprime um código de 6 dígitos uma única vez e grava o hash. Remova depois:
```bash
node scripts/definir-codigo-fixo-2fa.js admin@escola.com --remover
```

**Opção 3 — direto no banco**, último recurso:
```js
db.usuarios.updateOne({ email: 'admin@escola.com' }, { $set: { twoFactorEnabled: false } })
```
Só resolve se o perfil **não** estiver em `PERFIS_2FA_OBRIGATORIO`; senão, ajuste
a variável também.

---

## Auditoria

Todo evento relevante fica registrado e é consultável em `/api/audit`:

| Ação | Quando |
|---|---|
| `TWOFACTOR_ATIVADO` | ativação numa conta, com quem ativou e se foi forçada |
| `TWOFACTOR_DESATIVADO` | desativação numa conta |
| `BACKUP_CODES_GERADOS` | geração de lote, com quem gerou e para quem |
| `LOGIN_2FA_REQUIRED` | login pediu o segundo fator |
| `LOGIN_2FA_SUCESSO` | login **completou** com segundo fator |
| `LOGIN_2FA_FAILED` | código errado, com o número da tentativa |
| `LOGIN_2FA_BACKUP` | entrou com código de backup, e quantos restam |
| `LOGIN_SEM_2FA` | entrou sem segundo fator porque o perfil está dispensado |
| `CODIGO_FIXO_2FA_DEFINIDO` | código fixo definido, e se o valor foi escolhido ou sorteado |
| `RECUPERACAO_SENHA_ADMIN` | recuperação de senha disparada pelo admin |

Se um dia for preciso responder *"quem entrou, quando, e por qual caminho"*, a
resposta existe.

---

## O que NÃO fazer

**Não ative para todos de uma vez.** O rollout por conta existe porque uma
falha de configuração descoberta com um perfil inteiro trancado é muito mais
cara de desfazer.

**Não guarde os códigos de backup no mesmo lugar da senha.** Se o gerenciador
de senhas guarda os dois, um vazamento entrega os dois fatores — e o segundo
fator deixa de existir.

**Não reutilize um código que já circulou.** Um valor que apareceu em log, chat
ou e-mail deve ser considerado queimado. Gerar outro lote custa um clique.
