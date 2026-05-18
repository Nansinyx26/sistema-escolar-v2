# Guia de Migração para MongoDB Atlas

## 📋 Estrutura do Banco de Dados

### Collections (Coleções):
1. **usuarios** - Autenticação e perfis
2. **professores** - Dados dos professores
3. **turmas** - Informações das turmas
4. **alunos** - Cadastro de alunos
5. **notas** - Avaliações e notas
6. **faltas** - Registro de faltas
7. **relatorios** - Relatórios diários
8. **controle_turmas** - Permissões de turmas
9. **config** - Configurações do sistema

---

## 🚀 Passos para Migrar para MongoDB Atlas

### 1. Criar Conta no MongoDB Atlas
```
1. Acesse: https://www.mongodb.com/cloud/atlas
2. Crie uma conta gratuita
3. Crie um novo Cluster (Free Tier M0)
4. Aguarde ~5 minutos para provisionar
```

### 2. Configurar Acesso
```
1. Database Access: Criar usuário
   - Username: escola_admin
   - Password: [senha segura]
   - Role: Atlas Admin

2. Network Access: Adicionar IP
   - Allow Access from Anywhere: 0.0.0.0/0
   - (Para produção: use IP específico)
```

### 3. Importar Dados

#### Opção A: MongoDB Compass (Recomendado - GUI)
```
1. Baixe MongoDB Compass: https://www.mongodb.com/try/download/compass
2. Conecte ao cluster usando a connection string
3. Crie database: "escola_db"
4. Para cada collection:
   - Click "ADD DATA" → "Import JSON or CSV"
   - Selecione o arquivo escola_database.json
   - Importe cada array separadamente
```

#### Opção B: MongoDB Shell (CLI)
```bash
# Instalar mongoimport
mongoimport --uri "mongodb+srv://usuario:senha@cluster.mongodb.net/escola_db" \
  --collection usuarios \
  --file escola_database.json \
  --jsonArray

# Repetir para cada collection
```

#### Opção C: Script Node.js (Automático)
```javascript
// Ver arquivo: migrate-to-mongodb.js
npm install mongodb
node migrate-to-mongodb.js
```

---

## 📊 Estrutura das Collections

### usuarios
```json
{
  "_id": "ObjectId ou string",
  "email": "string (único)",
  "senha": "string (hash)",
  "nome": "string",
  "perfil": "admin | diretor | professor",
  "foto": "string (base64) ou null",
  "ativo": "boolean",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

### professores
```json
{
  "_id": "ObjectId",
  "idUsuario": "string (ref: usuarios._id)",
  "nome": "string",
  "email": "string",
  "telefone": "string",
  "salaPrincipal": "string (turma)",
  "salasAdicionais": ["array de strings"],
  "materias": ["array de strings"],
  "tipoEspecial": "boolean",
  "foto": "string ou null",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

### alunos
```json
{
  "_id": "ObjectId",
  "nome": "string",
  "matricula": "string (único)",
  "turmaId": "string (ref: turmas._id)",
  "dataNascimento": "ISODate",
  "responsavel": "string",
  "telefone": "string",
  "endereco": "string",
  "foto": "string ou null",
  "pcd": "boolean",
  "pcdDescricao": "string ou null",
  "ativo": "boolean",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

### notas
```json
{
  "_id": "ObjectId",
  "alunoId": "string (ref: alunos._id)",
  "turmaId": "string (ref: turmas._id)",
  "materiaId": "string",
  "bimestre": "number (1-4)",
  "tipo": "prova | trabalho | atividade | projeto",
  "nota": "number (0-10)",
  "descricao": "string",
  "data": "ISODate",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

---

## 🔧 Índices Recomendados

### Performance Essencial:
```javascript
// usuarios
db.usuarios.createIndex({ "email": 1 }, { unique: true });
db.usuarios.createIndex({ "perfil": 1 });

// alunos
db.alunos.createIndex({ "turmaId": 1 });
db.alunos.createIndex({ "matricula": 1 }, { unique: true });
db.alunos.createIndex({ "ativo": 1 });

// notas
db.notas.createIndex({ "alunoId": 1 });
db.notas.createIndex({ "turmaId": 1, "bimestre": 1 });
db.notas.createIndex({ "materiaId": 1 });

// faltas
db.faltas.createIndex({ "alunoId": 1, "data": -1 });
db.faltas.createIndex({ "turmaId": 1, "data": -1 });
```

---

## 🔗 Connection String

### Formato:
```
mongodb+srv://usuario:senha@cluster.mongodb.net/escola_db?retryWrites=true&w=majority
```

### Exemplo de Uso (Node.js):
```javascript
const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://usuario:senha@cluster.mongodb.net/";
const client = new MongoClient(uri);

async function conectar() {
  await client.connect();
  const db = client.db('escola_db');
  
  // Buscar todos alunos
  const alunos = await db.collection('alunos').find({}).toArray();
  console.log(alunos);
}
```

---

## 🛡️ Segurança

### 1. Variáveis de Ambiente
```bash
# .env
MONGODB_URI=mongodb+srv://usuario:senha@cluster.mongodb.net/escola_db
MONGODB_DB_NAME=escola_db
```

### 2. Roles e Permissões
```javascript
// Usuário apenas leitura
{
  role: "read",
  db: "escola_db"
}

// Usuário leitura e escrita
{
  role: "readWrite",
  db: "escola_db"
}
```

---

## 📈 Queries Úteis

### Buscar alunos por turma:
```javascript
db.alunos.find({ turmaId: "1A", ativo: true })
```

### Média de um aluno:
```javascript
db.notas.aggregate([
  { $match: { alunoId: "aluno001" } },
  { $group: { _id: null, media: { $avg: "$nota" } } }
])
```

### Alunos com baixo desempenho:
```javascript
db.notas.aggregate([
  { $group: { 
      _id: "$alunoId", 
      media: { $avg: "$nota" } 
  }},
  { $match: { media: { $lt: 5 } } }
])
```

---

## 🔄 Backup e Restore

### Backup:
```bash
mongodump --uri="mongodb+srv://..." --out=backup/
```

### Restore:
```bash
mongorestore --uri="mongodb+srv://..." backup/
```

---

## 📚 Recursos

- [MongoDB Atlas Docs](https://docs.atlas.mongodb.com/)
- [MongoDB University](https://university.mongodb.com/) - Cursos gratuitos
- [MongoDB Compass](https://www.mongodb.com/products/compass) - GUI

---

## ✅ Checklist de Migração

- [ ] Criar conta no MongoDB Atlas
- [ ] Criar cluster gratuito (M0)
- [ ] Configurar usuário do banco
- [ ] Configurar acesso de rede (IP)
- [ ] Importar dados do JSON
- [ ] Criar índices
- [ ] Testar conexão
- [ ] Atualizar código do frontend
- [ ] Testar CRUD operations
- [ ] Configurar backup automático

---

**Última atualização:** 2024-12-11
