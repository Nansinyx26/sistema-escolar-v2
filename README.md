# 🎓 Sistema de Gerenciamento Escolar v4.0 (Enterprise)

Sistema moderno e robusto de gerenciamento escolar, unindo a potência do **Node.js + MongoDB** com uma experiência de usuário premium e **Narração Inteligente via IA**.

## 🚀 Novidades da Versão 4.0

### 🎙️ Narração Inteligente (Powered by Eleven Labs)

- **Acessibilidade Premium**: O sistema agora narra comunicados oficiais com vozes ultra-realistas.
- **Seleção de Voz**: Escolha entre narradores masculinos e femininos.
- **Preferências Persistentes**: O sistema lembra sua escolha de voz em todos os acessos.

### 📱 Social Feed 3.0 (Real-time)

- **Interatividade Total**: Comentários, respostas (threads) e 8 tipos de reações emocionais.
- **Comunicação Bidirecional**: Pais, professores e diretores interagem nos comunicados da escola.
- **Notificações Instantâneas**: Receba avisos de novos comentários e reações via Socket.io.

### 🎨 Design System: Glassmorphism Premium

- **Estética Moderna**: Interface baseada em transparências, blur e gradientes vibrantes.
- **Dark Mode Nativo**: Foco no conforto visual e sofisticação.
- **KPIs Dinâmicos**: Painéis de estatística com visualização avançada de dados.

---

## ✨ Características Principais

### 🔐 Segurança & Autenticação

- **Google OAuth & JWT**: Login seguro e moderno.
- **Proxy de API**: Segurança total para chaves de serviço externas (Eleven Labs).
- **Controle de Acesso (RBAC)**: Permissões granulares para Diretor, Professor e Responsável.

### 👥 Ecossistema de Portais

1.  **Portal do Diretor**: Gestão estratégica, relatórios e moderação social.
2.  **Portal do Professor**: Diário de classe digital, gestão de turmas e comunicados.
3.  **Portal do Responsável (React)**: App dedicado para pais acompanharem a vida acadêmica dos alunos.

### 💾 Stack Tecnológica

- **Frontend**: HTML5, CSS3 (Vanilla & SCSS), JavaScript (ES6+), React/Vite.
- **Backend**: Node.js, Express.
- **Banco de Dados**: MongoDB (Atlas) com Mongoose.
- **Real-time**: Socket.io.
- **IA**: Eleven Labs API (Text-to-Speech).

---

## 📁 Estrutura do Projeto

```
sistema-escolar/
├── backend/                # Servidor Node.js + Express
│   ├── src/
│   │   ├── controllers/    # Lógica de negócio
│   │   ├── models/         # Esquemas MongoDB
│   │   ├── routes/         # Endpoints da API (incluindo /tts)
│   │   └── services/       # Integrações (Socket.io, Eleven Labs)
├── portal-responsavel/     # Aplicação React (Vite) para os pais
├── direcao/                # Painel administrativo legado modernizado
├── js/                     # Scripts globais e componentes React injetáveis
├── css/                    # Design System (Glassmorphism)
└── dashboard.html          # Portal do Professor
```

---

## 🔧 Configuração e Instalação

### Pré-requisitos

- Node.js v16+
- Conta no MongoDB Atlas
- API Key da Eleven Labs

### Instalação

1. Clone o repositório
2. Configure o arquivo `.env` na raiz:
   ```env
   MONGODB_URI=seu_mongodb_uri
   ELEVEN_LABS_API_KEY=sua_chave_aqui
   JWT_SECRET=seu_segredo_jwt
   ```
3. Instale as dependências do backend:
   ```bash
   cd backend
   npm install
   ```
4. Inicie o servidor:
   ```bash
   npm start
   ```

---

## 📋 Roadmap de Implementações

- [x] Integração Eleven Labs TTS
- [x] Sistema de Comentários e Respostas
- [x] Modernização Visual Glassmorphism
- [ ] Relatórios em PDF Automatizados
- [ ] Aplicativo Mobile Nativo (PWA)

---

**Desenvolvido com ❤️ para transformar a educação através da tecnologia.**
