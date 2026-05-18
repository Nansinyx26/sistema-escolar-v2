# 🎓 Sistema de Gerenciamento Escolar v3.0

Sistema moderno de gerenciamento escolar que funciona **100% offline** usando IndexedDB, com arquitetura preparada para migração futura para MongoDB.

## ✨ Características Principais

### 🔐 Sistema de Autenticação
- **Login com Email e Senha**
- **Login com Google OAuth** (simulado offline, preparado para modo online)
- Emails únicos no sistema
- Sessões persistentes
- Logout seguro

### 👥 Perfis de Usuário
- **Professor**: Gerencia suas turmas e atividades
- **Diretor**: Acesso administrativo completo

### 🎨 Interface Moderna
- Design inspirado em redes sociais profissionais
- **Modo Escuro** como padrão
- Glassmorphism e gradientes vibrantes
- Animações suaves e micro-interações
- Totalmente responsivo (desktop, tablet, mobile)

### 💾 Banco de Dados
- **IndexedDB** para armazenamento offline
- Estrutura de dados compatível com **MongoDB**
- Collections: usuarios, professores, diretores, controle_salas, controle_turmas, configuracoes_escola

## 📁 Estrutura do Projeto

```
sistema-cadastro-escolar-v2/
├── login.html                 # Página de login/registro
├── escolher-perfil.html      # Escolha de perfil (Professor/Diretor)
├── cadastro-professor.html   # Cadastro do perfil de professor (em breve)
├── cadastro-diretor.html     # Cadastro do perfil de diretor (em breve)
├── dashboard.html            # Dashboard principal (em breve)
├── css/
│   ├── variables.css         # Variáveis e design tokens
│   ├── base.css             # Reset e estilos base
│   ├── components-new.css   # Componentes reutilizáveis
│   ├── login-new.css        # Estilos da tela de login
│   └── perfil.css           # Estilos da escolha de perfil
└── js/
    ├── database.js          # Gerenciador IndexedDB
    ├── auth.js              # Gerenciador de autenticação
    ├── utils.js             # Funções utilitárias
    ├── login.js             # Lógica da tela de login
    └── perfil.js            # Lógica da escolha de perfil
```

## 🚀 Como Usar

### 1. Abrir o Sistema
Abra o arquivo `login.html` no navegador.

### 2. Criar uma Conta
**Opção 1: Email e Senha**
1. Clique na tab "Criar Conta"
2. Preencha: Nome, Email, Senha
3. Clique em "Criar Conta"

**Opção 2: Google (Simulado Offline)**
1. Clique em "Cadastrar com Google"
2. No modal, informe:
   - Email do Gmail
   - Nome completo
   - URL da foto (opcional)
3. Clique em "Confirmar"

### 3. Escolher Perfil
Após o login, escolha:
- **Professor**: Para gerenciar turmas
- **Diretor**: Para administrar a escola

### 4. Completar Cadastro
Complete as informações do seu perfil conforme o tipo escolhido.

## 📋 Especificações Técnicas

### Perfil do Professor

**Campos Obrigatórios:**
- Nome
- Sala Principal (1ºA até 5ºD)
- Matérias (array)

**Campos Opcionais:**
- Foto
- Biografia
- Telefone
- Idade
- Atividades Pessoais
- Ideias para o Ano

**Regra Especial:**
- Se selecionar "Inglês" ou "Educação Física", o campo "Salas Adicionais" é liberado

**Estrutura JSON:**
```json
{
  "_id": "ObjectId",
  "idUsuario": "ObjectId",
  "tipo": "professor",
  "nome": "Maria Silva",
  "foto": "",
  "salaPrincipal": "3ºB",
  "materias": ["Português", "Matemática"],
  "salasAdicionais": [],
  "biografia": "",
  "telefone": "",
  "idade": "",
  "atividadesPessoais": "",
  "ideiasParaAno": "",
  "atualizadoEm": "2025-12-10T10:35:00"
}
```

### Perfil do Diretor

**Permissões:**
- Alterar salas
- Ver gráficos
- Ver notas
- Gerenciar professores
- Relatórios completos

**Estrutura JSON:**
```json
{
  "_id": "ObjectId",
  "idUsuario": "ObjectId",
  "tipo": "diretor",
  "nome": "Carlos Oliveira",
  "foto": "",
  "biografia": "",
  "telefone": "",
  "idade": "",
  "permissoes": [
    "alterar_salas",
    "ver_graficos",
    "ver_notas",
    "gerenciar_professores",
    "relatorios"
  ]
}
```

### Estrutura de Usuário

**Login com Email:**
```json
{
  "_id": "ObjectId",
  "email": "usuario@email.com",
  "senha": "hash_senha",
  "nome": "João Silva",
  "perfil": "professor",
  "loginGoogle": false,
  "fotoGoogle": "",
  "ativo": true,
  "criadoEm": "2025-12-10T10:30:00",
  "ultimoLogin": "2025-12-10T15:10:00"
}
```

**Login com Google (Offline):**
```json
{
  "_id": "ObjectId",
  "email": "usuario@gmail.com",
  "senha": null,
  "nome": "João Silva",
  "perfil": "professor",
  "loginGoogle": true,
  "fotoGoogle": "https://...",
  "ativo": true,
  "criadoEm": "2025-12-10T10:30:00",
  "ultimoLogin": "2025-12-10T15:10:00"
}
```

## 🔄 Controle de Acesso

### Professor
- Pode acessar apenas suas turmas autorizadas:
  - Sala Principal
  - Salas Adicionais (se tiver Inglês ou Ed. Física)
- Não pode ver turmas de outros professores

### Diretor
- Acesso total a todas as turmas
- Pode modificar salas de qualquer professor
- Alterações do diretor têm prioridade sobre escolhas do professor

**Estrutura de Controle:**
```json
{
  "_id": "ObjectId",
  "idProfessor": "ObjectId",
  "salaPrincipal": "2ºD",
  "salasAdicionais": ["1ºA", "3ºB"],
  "definidoPor": "diretor",
  "atualizadoEm": "2025-12-10T11:00:00"
}
```

## 🌐 Migração para Online (Futuro)

O sistema está preparado para migração para MongoDB:

1. **Estrutura de Dados**: Idêntica entre IndexedDB e MongoDB
2. **IDs**: Formato compatível com ObjectId do MongoDB
3. **Sincronização**:
   - Ler dados do IndexedDB
   - Enviar via API REST
   - Salvar no MongoDB
   - Usar MongoDB como principal
   - IndexedDB como cache offline

## 🎨 Design System

### Cores Principais
- **Primary**: `#4c9aff` (Azul)
- **Secondary**: `#7c3aed` (Roxo)
- **Accent**: `#f59e0b` (Laranja)
- **Success**: `#10b981` (Verde)
- **Error**: `#ef4444` (Vermelho)

### Fontes
- **Principal**: Inter
- **Monospace**: Fira Code

### Componentes
- Botões (primary, secondary, outline, google)
- Cards (com glassmorphism)
- Inputs (com validação visual)
- Modais
- Toasts
- Badges
- Avatares
- Skeleton loaders

## 📱 Responsividade

- **Desktop**: Layout completo com sidebar
- **Tablet**: Layout adaptado
- **Mobile**: Menu inferior, cards empilhados

## 🔧 Tecnologias

- **HTML5**: Estrutura semântica
- **CSS3**: Variáveis, Grid, Flexbox, Animações
- **JavaScript (Vanilla & Node.js)**: Frontend e Backend
- **IndexedDB**: Banco de dados offline
- **MongoDB/Mongoose**: Banco de dados online
- **Express**: API REST
- **Bootstrap Icons**: Ícones
- **Markdown**: Documentação do projeto

## 📝 Notas de Desenvolvimento

- Todos os dados são salvos em formato JSON padrão MongoDB
- Sistema funciona 100% offline
- Validações no frontend e backend (futuro)
- Sessões usando sessionStorage
- Preferências usando localStorage

## 🚧 Próximos Passos

- [ ] Página de cadastro do professor
- [ ] Página de cadastro do diretor
- [ ] Dashboard principal
- [ ] Sistema de turmas
- [ ] Cadastro de alunos
- [ ] Sistema de notas
- [ ] Relatórios
- [ ] Gráficos e estatísticas
- [ ] Backend com Node.js + Express
- [ ] Integração com MongoDB
- [ ] API REST
- [ ] Google OAuth real

## 📄 Licença

Este é um projeto educacional.

---

**Desenvolvido com ❤️ para educação**
