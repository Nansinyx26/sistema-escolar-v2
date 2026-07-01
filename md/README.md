# 🎓 Sistema Escolar v5.0

Sistema completo de gestão escolar com portais para Diretor, Professor e Responsável, chatbot inteligente com RBAC, narração por IA e comunicação em tempo real.

---

## 🚀 O que há de novo na v5.0

### 🤖 Chatbot Inteligente com RBAC
- Consulta dados reais do banco (notas, faltas, comunicados, horários, professores)
- Controle de acesso por perfil: cada usuário vê apenas o que tem permissão
- Botões de seleção interativos quando há múltiplos alunos com o mesmo nome
- Fallback automático: usa Gemini quando disponível, responde diretamente do banco quando a quota é excedida
- Suporte a linguagem natural em Português-BR

### 💬 Comentários Aprimorados
- Fonte maior para melhor legibilidade
- Suporte a respostas em thread, edição e exclusão
- Gravação de áudio nos comentários via microfone

### 😄 Reações com Emoji
- Picker com 6 categorias de emojis nos comunicados do mural
- Sincronização em tempo real via Socket.IO
- Chips clicáveis com contagem e tooltip de usuários

### 🔔 Resumo Diário às 16h
- Notificação automática para todos os usuários às 16h (BRT)
- Resume os comunicados publicados no dia
- Aparece no sino de notificações de todos os perfis

---

## ✨ Funcionalidades Principais

### 🔐 Segurança e Autenticação
- Login com Google OAuth e JWT (cookie HttpOnly)
- RBAC granular: Diretor, Admin, Coordenador, Secretaria, Professor, Responsável
- CSRF protection e rate limiting
- Rotação automática de código secreto à meia-noite

### 👥 Portais

| Portal | Tecnologia | Perfis |
|---|---|---|
| Diretor / Admin | HTML5 + Vanilla JS | diretor, admin, coordenador, secretaria |
| Professor | HTML5 + Vanilla JS | professor |
| Responsável | React + TypeScript (Vite) | responsavel |

### 📢 Comunicados e Mural
- Criação com imagens, vídeos, áudios e documentos em anexo
- Filtros por destinatário (turma, perfil, todos)
- Reações com emoji e comentários em tempo real
- Narração por voz via ElevenLabs

### 📊 IA Pedagógica
- Análise de desempenho por aluno (notas + frequência)
- Mapa de calor por disciplina e turma
- Insights globais para o dashboard BI
- Predição de nota final

### 🎙️ Narração por IA
- Text-to-Speech via ElevenLabs (vozes: Adam, Brian, Eric, George)
- Seleção de voz persistente no localStorage
- Narração de comunicados, comentários e respostas do chatbot

---

## 🛠️ Stack Tecnológica

**Backend**
- Node.js + Express
- MongoDB Atlas + Mongoose + GridFS
- Socket.IO (tempo real)
- node-cron (jobs agendados)
- JWT + bcrypt
- Nodemailer, web-push

**Frontend — Portal do Responsável**
- React 18 + TypeScript
- Vite
- Socket.IO client

**Frontend — Portal Diretor/Professor**
- HTML5 + CSS3 + Vanilla JS
- GSAP + Three.js (animações)
- Bootstrap Icons + Tabler Icons

**Serviços Externos**
- ElevenLabs (TTS)
- Google OAuth
- Google Gemini 2.0 Flash (chatbot IA, opcional)

---

## 📁 Estrutura do Projeto

```
sistema-escolar/
├── backend/
│   ├── src/
│   │   ├── controllers/        # Lógica de negócio
│   │   ├── jobs/               # Jobs agendados (DailyDigestJob)
│   │   ├── middleware/         # Auth, CSRF, rate limit
│   │   ├── models/             # Schemas Mongoose
│   │   ├── routes/             # Endpoints da API
│   │   ├── services/           # ChatbotService, voiceService, TTSService
│   │   └── utils/              # Logger, DB, helpers
├── portal-responsavel/         # App React (Vite) para responsáveis
│   └── src/
│       ├── components/         # AnnouncementCard, ChatbotIA, ReactionArea...
│       ├── services/           # apiService, socket
│       └── hooks/              # useTTS
├── js/                         # Scripts do portal diretor/professor
├── css/ scss/                  # Design system
├── html/                       # Páginas HTML
└── direcao/                    # Painel de direção
```

---

## ⚙️ Configuração

### Pré-requisitos
- Node.js v18+
- MongoDB Atlas (ou local)

### Variáveis de Ambiente — `backend/.env`

```env
MONGODB_URI=mongodb+srv://...
MONGODB_DB_NAME=test
PORT=3001
JWT_SECRET=seu_segredo_jwt
FRONTEND_URL=http://localhost:5173

# ElevenLabs TTS
ELEVENLABS_API_KEY=sk_...

# Google Gemini (opcional — chatbot usa fallback sem ele)
GOOGLE_TTS_API_KEY=AIza...
```

### Instalação

```bash
# Backend
cd backend
npm install
npm start

# Portal do Responsável (dev)
cd portal-responsavel
npm install
npm run dev
```

---

## 🤖 Chatbot — Guia de Uso

O chatbot entende linguagem natural. Exemplos de perguntas por perfil:

**Diretor / Admin**
- `Notas do João Silva` — busca notas, pede confirmação se houver homônimos
- `Professores` — lista todos os professores com suas turmas
- `Resumo geral` — média da escola, frequência global, comunicados ativos
- `Comunicados` — últimos 5 avisos ativos

**Professor**
- `Faltas da turma` — frequência dos alunos das suas turmas
- `Horário` — grade horária das suas turmas

**Responsável**
- `Notas do meu filho` — notas do aluno vinculado à conta
- `Frequência` — presenças e alertas de frequência crítica
- `Comunicados` — avisos direcionados aos responsáveis

---

## 📋 Roadmap

- [x] Chatbot inteligente com RBAC e dados reais
- [x] Botões de seleção para alunos homônimos
- [x] Fallback Gemini → resposta direta do banco
- [x] Reações com emoji no mural
- [x] Letra maior nos comentários
- [x] Notificação diária às 16h
- [x] Sistema de comentários com áudio
- [x] Mapa de calor pedagógico
- [x] Análise preditiva de notas
- [ ] App Mobile PWA
- [ ] Relatórios PDF automatizados por e-mail

---

**Desenvolvido com ❤️ para transformar a educação através da tecnologia.**
