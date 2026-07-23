# Backend - Sistema Cadastro Escolar v2

Backend desenvolvido em Node.js com Express e MongoDB (Mongoose) para prover persistência de dados na nuvem (MongoDB Atlas).

## 📁 Estrutura

- `src/controllers`: Lógica das rotas (Alunos, Professores, etc.)
- `src/models`: Modelos do Mongoose (Schemas)
- `src/routes`: Definição de rotas da API
- `src/services`: Regras de negócio e serviços (ex: Migração)
- `scripts`: Scripts utilitários (Migração CLI, Testes)

## 🚀 Como Iniciar

### 1. Pré-requisitos
- Node.js (v18 ou superior)
- Conta no MongoDB Atlas (para obter a URI)

### 2. Instalação
Entre na pasta `backend`:
```bash
cd backend
npm install
```

### 3. Configuração
Copie o arquivo de exemplo `.env.example` para `.env`:
- Windows: `copy .env.example .env`
- Linux/Mac: `cp .env.example .env`

Edite o arquivo `.env` e preencha a `MONGODB_URI` com sua string de conexão do Atlas.

### 4. Rodar o Servidor
- Modo desenvolvimento (com auto-reload):
  ```bash
  npm run dev
  ```
- Modo produção:
  ```bash
  npm start
  ```
O servidor rodará na porta definida (padrão 3001).

## 🔄 Migração de Dados (IndexedDB -> MongoDB)

Existem duas formas de migrar os dados do frontend local para o Atlas.

### Opção A: Via Script (Recomendado)
1. No Frontend, exporte seus dados para um arquivo JSON (ex: `escola_database.json`).
2. Copie este arquivo para algum lugar acessível.
3. Rode o comando:
   ```bash
   npm run migrate -- <caminho/para/escola_database.json>
   ```
   Exemplo: `npm run migrate -- ../data/escola_database.json`

### Opção B: Via API
1. Exporte os dados do front como JSON.
2. Faça uma requisição POST para `/api/migrate` enviando o JSON no corpo.
   - Header necessário: `x-migration-key: <valor_do_env>`

## 📡 Endpoints Principais

Prefix URL: `http://localhost:3001/api`

### Alunos
- `GET /alunos`: Lista alunos (paginado). Params: `?page=1&turma=1A&q=Maria`
- `GET /alunos/:id`: Detalhes do aluno.
- `POST /alunos`: Cria aluno.
- `PUT /alunos/:id`: Atualiza aluno.
- `DELETE /alunos/:id`: Remove aluno.

### Professores
- `GET /professores`
- `POST /professores`

### Turmas
- `GET /turmas`
- `POST /turmas`

### Upload de Fotos
- `POST /upload/photo`: Enviar form-data com campo `foto`. Retorna ID.
- `GET /upload/photo/:id`: Retorna a imagem.

## ⚠️ Notas Importantes
1. **CORS**: O `.env` define `ALLOWED_ORIGINS=*` para facilitar o desenvolvimento. Em produção, altere para o domínio do seu frontend.
2. **Compatibilidade**: Os modelos usam `strict: false`, permitindo que o frontend envie campos novos sem quebrar a API.
3. **Fotos**: O sistema aceita tanto DataURL (string base64 salva diretamente no modelo) quanto upload via GridFS (retornando ID).

## 🧪 Testes
Para verificar se a API está respondendo:
```bash
npm run test:api
```
Certifique-se que o servidor está rodando antes de testar.
