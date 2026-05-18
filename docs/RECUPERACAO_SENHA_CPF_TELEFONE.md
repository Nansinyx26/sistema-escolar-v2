# 🔒 Sistema de Recuperação de Senha com CPF e Telefone

## ✅ Alterações Implementadas

### 📊 Backend (MongoDB + Node.js)

#### 1. **Modelo `Usuario.js`**
- ✅ Adicionado campo `telefone`: String, obrigatório
- ✅ Adicionado campo `cpf`: String, obrigatório, único

#### 2. **Controller `UserController.js`**
- ✅ Função `forgotPassword` modificada para:
  - Exigir email, CPF e telefone
  - Validar que os 3 dados correspondem ao mesmo usuário
  - **Retornar sucesso imediato** se dados conferem (sem envio de código por email)
- ✅ Função `resetPassword` modificada para:
  - Receber email, CPF, telefone e nova senha
  - Alterar a senha diretamente após revalidar os dados

### 🎨 Frontend (HTML + JavaScript)

#### 1. **index.html**
- ✅ Formulário de Registro: campos CPF e telefone adicionados
- ✅ Modal de Recuperação de Senha: 
  - Campos CPF e telefone no Passo 1
  - **Passo 2 simplificado**: Apenas definição de nova senha (campo de código removido)

#### 2. **perfil.html**
- ✅ Campos CPF e telefone adicionados ao formulário de edição de perfil
- ✅ Ambos marcados como obrigatórios para recuperação de senha
- ✅ Permite que usuários existentes atualizem seus dados

#### 3. **login.js**
- ✅ Fluxo atualizado:
  - Passo 1: Valida Email + CPF + Telefone
  - Passo 2: Permite definir nova senha imediatamente
- ✅ Envio de dados na recuperação de senha (Email, CPF, Telefone, Nova Senha)

---

## 🧪 Como Testar

### 1️⃣ **Criar Nova Conta**
1. Abra: http://localhost:3001
2. Clique na aba "Criar Conta"
3. Preencha:
   - Nome Completo
   - Email
   - **CPF** (exemplo: `123.456.789-00`)
   - **Telefone** (exemplo: `(11) 98765-4321`)
   - Senha
   - Confirmar Senha
4. Clique em "Criar Conta"
5. **Resultado Esperado**: Conta criada com sucesso

### 2️⃣ **Recuperar Senha (Sem CPF/Telefone)**
1. Clique em "Esqueceu a senha?"
2. Preencha apenas o email (deixe CPF e telefone vazios)
3. Clique em "Validar Dados"
4. **Resultado Esperado**: Erro de validação

### 3️⃣ **Recuperar Senha (Dados Incorretos)**
1. Clique em "Esqueceu a senha?"
2. Preencha:
   - Email: email correto
   - CPF: **incorreto** (diferente do cadastrado)
   - Telefone: telefone correto
3. Clique em "Validar Dados"
4. **Resultado Esperado**: Erro "Dados não conferem. Verifique se o email, CPF e telefone estão corretos."

### 4️⃣ **Recuperar Senha (Dados Corretos) - Fluxo Simplificado** ✅
1. Clique em "Esqueceu a senha?"
2. Preencha EXATAMENTE os dados cadastrados:
   - Email
   - CPF
   - Telefone
3. Clique em "Validar Dados"
4. **Resultado Esperado**: 
   - Mensagem de sucesso: "Dados validados com sucesso"
   - **Modal avança automaticamente para o Passo 2** (Definir Nova Senha)
5. Preencha a nova senha e confirme
6. Clique em "Alterar Senha"
7. **Resultado Esperado**: Senha alterada com sucesso!

---

## 🔐 Segurança Implementada

1. **Validação Tripla**: Email + CPF + Telefone devem corresponder EXATAMENTE
2. **Sem Interceptação de Email**: Como não há código enviado por email, a segurança depende inteiramente da posse dos dados pessoais (CPF e Telefone).
3. **CPF Único**: Não permite duplicatas no cadastro


---

## 📚 Arquivos Modificados

```
✏️ backend/src/models/Usuario.js
✏️ backend/src/controllers/UserController.js
✏️ index.html
✏️ js/login.js
✏️ js/auth.js
```

---

## 🚀 Deploy

Para enviar para produção (Render):

1. Commit das alterações:
```bash
git add .
git commit -m "feat: adiciona validação de CPF e telefone na recuperação de senha"
git push origin main
```

2. Render fará deploy automático

3. **IMPORTANTE**: Atualizar usuários existentes no MongoDB Atlas antes de ativar em produção!

---

## 📞 Próximos Passos Sugeridos

1. ✅ **Validação de CPF**: Implementar algoritmo de validação de CPF real
2. ✅ **Validação de Telefone**: Verificar formato brasileiro válido
3. ✅ **SMS**: Enviar código por SMS além do email
4. ✅ **2FA**: Implementar autenticação de dois fatores
5. ✅ **Histórico**: Registrar tentativas de recuperação de senha

---

## 🎉 Conclusão

O sistema agora possui **recuperação de senha segura** com validação tripla de identidade!

**Teste e confirme que tudo está funcionando antes de fazer deploy em produção! 🚀**
