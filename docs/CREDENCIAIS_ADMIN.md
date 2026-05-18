# 🔐 Credenciais de Administrador

## Conta de Administrador

Para acessar o sistema como **Administrador** com acesso completo a todas as funcionalidades, use as seguintes credenciais:

### Login
- **Email:** `admin@escola.com`
- **Senha:** `admin123`

---

## Permissões do Administrador

O administrador tem acesso total ao sistema, incluindo:

✅ **Gerenciar Usuários** - Criar, editar e remover usuários do sistema  
✅ **Gerenciar Turmas** - Criar e gerenciar todas as turmas  
✅ **Gerenciar Notas** - Visualizar e editar notas de todos os alunos  
✅ **Acessar Ferramentas** - Acesso exclusivo ao card "Ferramentas"  
✅ **Limpar Dados** - Limpar dados do sistema  
✅ **Backup e Restaurar** - Fazer backup e restaurar dados  

---

## Card "Ferramentas"

O **card Ferramentas** é **exclusivo para administradores** e fica **oculto** para:
- ❌ Diretores
- ❌ Professores

### Funcionalidades do Card Ferramentas (em desenvolvimento)
- Gerenciamento de usuários
- Configurações do sistema
- Backup e restauração de dados
- Limpeza de dados
- Logs do sistema
- Configurações avançadas

---

## Diferenças entre Perfis

| Funcionalidade | Administrador | Diretor | Professor |
|----------------|---------------|---------|-----------|
| Ver Turmas | ✅ Todas | ✅ Todas | ✅ Atribuídas |
| Ver Relatórios | ✅ Sim | ✅ Sim | ❌ Não |
| Card Ferramentas | ✅ Sim | ❌ Não | ❌ Não |
| Gerenciar Sistema | ✅ Sim | ❌ Não | ❌ Não |

---

## Como Fazer Login

1. Acesse a página inicial do sistema (`index.html`)
2. Clique na aba **"Entrar"**
3. Digite o email: `admin@escola.com`
4. Digite a senha: `admin123`
5. Clique em **"Entrar"**

Você será redirecionado para o **Dashboard** com acesso completo ao sistema, incluindo o card **"Ferramentas"**.

---

## Segurança

⚠️ **IMPORTANTE:** Esta é uma conta de demonstração. Em produção:
- Altere a senha padrão imediatamente
- Use senhas fortes e únicas
- Implemente autenticação de dois fatores (2FA)
- Use hash de senhas (bcrypt, argon2, etc.)
- Nunca compartilhe credenciais de administrador

---

## Arquivo de Configuração

As credenciais do administrador estão armazenadas em:
```
data/admin.json
```

**Estrutura do arquivo:**
```json
{
    "admin": {
        "email": "admin@escola.com",
        "senha": "admin123",
        "nome": "Administrador",
        "perfil": "admin",
        "permissoes": [
            "gerenciar_usuarios",
            "gerenciar_turmas",
            "gerenciar_notas",
            "acessar_ferramentas",
            "limpar_dados",
            "backup_restaurar"
        ]
    }
}
```

---

## Suporte

Para mais informações sobre o sistema, consulte o arquivo `README.md` principal.
