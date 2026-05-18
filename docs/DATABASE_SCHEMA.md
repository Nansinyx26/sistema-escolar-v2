# 🗂️ Estrutura Vetorial Completa - Dados do Sistema

## 📊 IndexedDB Schema (Versão 5)

```javascript
DATABASE: escolaDB
VERSION: 5

OBJECT STORES:
├── usuarios
├── professores
├── turmas
├── alunos
├── notas
├── faltas
├── relatorios
├── controle_turmas
└── config
```

---

## 1️⃣ USUARIOS

### Estrutura:
```javascript
{
  id: number (auto-increment),          // PK
  _id: string,                           // Compatível MongoDB
  email: string (único),                 // Login
  senha: string (hash bcrypt),           // Senha criptografada
  nome: string,                          // Nome completo
  perfil: enum["admin", "diretor", "professor"],
  foto: string | null,                   // Base64 ou URL
  ativo: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

### IDs e Chaves:
```javascript
Primary Key: id (auto-increment)
Unique Index: email
Index: perfil
```

### Exemplo Vetorial:
```javascript
[
  {
    id: 1,
    _id: "admin001",
    email: "admin@escola.com",
    senha: "$2a$10$...",
    nome: "Administrador",
    perfil: "admin",
    foto: null,
    ativo: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  },
  {
    id: 2,
    _id: "dir001",
    email: "diretor@escola.com",
    senha: "$2a$10$...",
    nome: "Maria Diretora",
    perfil: "diretor",
    foto: "data:image/jpeg;base64,...",
    ativo: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  },
  {
    id: 3,
    _id: "prof001",
    email: "professor@escola.com",
    senha: "$2a$10$...",
    nome: "João Professor",
    perfil: "professor",
    foto: null,
    ativo: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  }
]
```

---

## 2️⃣ PROFESSORES

### Estrutura:
```javascript
{
  id: number (auto-increment),          // PK
  _id: string,                           // Compatível MongoDB
  idUsuario: string,                     // FK → usuarios._id
  nome: string,
  email: string,
  telefone: string,
  salaPrincipal: string,                 // "1A" | "VARIADOS"
  salasAdicionais: string[],             // ["2A", "3B"]
  materias: string[],                    // ["Português", "Matemática"]
  tipoEspecial: boolean,                 // true para Inglês, Ed.Física, Artes
  foto: string | null,
  createdAt: Date,
  updatedAt: Date
}
```

### IDs e Chaves:
```javascript
Primary Key: id (auto-increment)
Index: idUsuario
Index: salaPrincipal
```

### Exemplo Vetorial:
```javascript
[
  {
    id: 1,
    _id: "prof_reg_001",
    idUsuario: "prof001",
    nome: "João Professor",
    email: "professor@escola.com",
    telefone: "(11) 98765-4321",
    salaPrincipal: "1A",
    salasAdicionais: [],
    materias: ["Português", "Matemática", "História", "Geografia", "Ciências"],
    tipoEspecial: false,
    foto: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  },
  {
    id: 2,
    _id: "prof_esp_001",
    idUsuario: "prof002",
    nome: "Ana Inglês",
    email: "ana.ingles@escola.com",
    telefone: "(11) 98765-1111",
    salaPrincipal: "VARIADOS",
    salasAdicionais: ["1A", "1B", "2A", "2B", "3A", "3B"],
    materias: ["Inglês"],
    tipoEspecial: true,
    foto: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  }
]
```

---

## 3️⃣ TURMAS

### Estrutura:
```javascript
{
  id: string,                            // PK: "1A", "2B", etc
  ano: number,                           // 1-5
  sala: string,                          // "A", "B"
  periodo: string,                       // "Manhã" | "Tarde"
  capacidade: number,                    // 30
  ativo: boolean
}
```

### IDs e Chaves:
```javascript
Primary Key: id (string, ex: "1A")
Index: ano
```

### Exemplo Vetorial:
```javascript
[
  { id: "1A", ano: 1, sala: "A", periodo: "Manhã", capacidade: 30, ativo: true },
  { id: "1B", ano: 1, sala: "B", periodo: "Manhã", capacidade: 30, ativo: true },
  { id: "2A", ano: 2, sala: "A", periodo: "Manhã", capacidade: 30, ativo: true },
  { id: "2B", ano: 2, sala: "B", periodo: "Manhã", capacidade: 30, ativo: true },
  { id: "3A", ano: 3, sala: "A", periodo: "Manhã", capacidade: 30, ativo: true },
  { id: "3B", ano: 3, sala: "B", periodo: "Manhã", capacidade: 30, ativo: true },
  { id: "4A", ano: 4, sala: "A", periodo: "Manhã", capacidade: 30, ativo: true },
  { id: "4B", ano: 4, sala: "B", periodo: "Manhã", capacidade: 30, ativo: true },
  { id: "5A", ano: 5, sala: "A", periodo: "Manhã", capacidade: 30, ativo: true },
  { id: "5B", ano: 5, sala: "B", periodo: "Manhã", capacidade: 30, ativo: true }
]
```

---

## 4️⃣ ALUNOS
### Estrutura:
```javascript
{
  id: number (auto-increment),          // PK
  _id: string,                           // Compatível MongoDB
  nome: string,
  dataNascimento: Date | string,
  responsavel: string,
  telefone: string,
  endereco: string,
  foto: string | null,                   // Base64
  pcd: boolean,
  pcdDescricao: string | null,
  ativo: boolean,
  createdAt: Date,
  updatedAt: Date
  // OBS: turmaId foi movido para a entidade MATRICULAS para permitir histórico
}
```

### IDs e Chaves:
```javascript
Primary Key: id (auto-increment)
Index: ativo
```

### Exemplo Vetorial:
```javascript
[
  {
    id: 1,
    _id: "aluno001",
    nome: "João Silva Santos",
    dataNascimento: "2018-03-15",
    responsavel: "Maria Silva Santos",
    telefone: "(11) 99999-0001",
    endereco: "Rua das Flores, 123",
    foto: "data:image/jpeg;base64,...",
    pcd: false,
    pcdDescricao: null,
    ativo: true,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  }
]
```

---

## 4.5 🆕 MATRÍCULAS (Vínculo Histórico)

### Estrutura:
```javascript
{
  id: number (auto-increment),          // PK
  _id: string,                           // Compatível MongoDB
  alunoId: number | string,              // FK → alunos
  turmaId: string,                       // FK → turmas
  anoLetivo: number,                     // 2024, 2025
  matriculaNumero: string (único),       // Ex: "2024001" (Antigo campo matricula do aluno)
  status: string,                        // "cursando", "aprovado", "reprovado", "transferido"
  numeroChamada: number,
  dataMatricula: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### IDs e Chaves:
```javascript
Primary Key: id
Index: alunoId
Index: turmaId
Compound Index: [alunoId, anoLetivo]  // Um aluno só pode ter uma matrícula ativa por ano (regra geral)
Unique Index: matriculaNumero
```

### Exemplo Vetorial:
```javascript
[
  {
    id: 101,
    _id: "matr001",
    alunoId: 1,         // João Silva Santos
    turmaId: "1A",      // 1º Ano A
    anoLetivo: 2024,
    matriculaNumero: "2024001",
    status: "cursando",
    numeroChamada: 15,
    dataMatricula: "2024-01-15",
    createdAt: "2024-01-15T00:00:00Z"
  }
]
```

---

## 5️⃣ NOTAS

### Estrutura:
```javascript
{
  id: number (auto-increment),          // PK
  _id: string,                           // Compatível MongoDB
  alunoId: number,                       // FK → alunos.id
  turmaId: string,                       // FK → turmas.id
  materiaId: string,                     // "portugues", "matematica", etc
  bimestre: number,                      // 1-4
  tipo: string,                          // "prova" | "trabalho" | "atividade" | "projeto"
  nota: number,                          // 0-10
  descricao: string,
  data: Date | string,
  createdAt: Date,
  updatedAt: Date
}
```

### IDs e Chaves:
```javascript
Primary Key: id (auto-increment)
Index: alunoId
Index: turmaId
Index: materiaId
Compound Index: [turmaId, bimestre]
```

### Exemplo Vetorial:
```javascript
[
  {
    id: 1,
    _id: "nota001",
    alunoId: 1,
    turmaId: "1A",
    materiaId: "portugues",
    bimestre: 1,
    tipo: "prova",
    nota: 8.5,
    descricao: "Prova de Português - 1º Bimestre",
    data: "2024-03-20",
    createdAt: "2024-03-20T00:00:00Z",
    updatedAt: "2024-03-20T00:00:00Z"
  },
  {
    id: 2,
    _id: "nota002",
    alunoId: 1,
    turmaId: "1A",
    materiaId: "matematica",
    bimestre: 1,
    tipo: "prova",
    nota: 9.0,
    descricao: "Prova de Matemática - 1º Bimestre",
    data: "2024-03-22",
    createdAt: "2024-03-22T00:00:00Z",
    updatedAt: "2024-03-22T00:00:00Z"
  },
  {
    id: 3,
    _id: "nota003",
    alunoId: 2,
    turmaId: "1A",
    materiaId: "portugues",
    bimestre: 1,
    tipo: "trabalho",
    nota: 7.5,
    descricao: "Trabalho de Leitura",
    data: "2024-03-25",
    createdAt: "2024-03-25T00:00:00Z",
    updatedAt: "2024-03-25T00:00:00Z"
  }
]
```

---

## 6️⃣ FALTAS

### Estrutura:
```javascript
{
  id: number (auto-increment),          // PK
  _id: string,                           // Compatível MongoDB
  alunoId: number,                       // FK → alunos.id
  turmaId: string,                       // FK → turmas.id
  materia: string,                       // "Sala Principal" | "Inglês" | etc
  data: Date | string,                   // "2024-12-11"
  justificada: boolean,
  motivo: string | null,
  createdAt: Date
}
```

### IDs e Chaves:
```javascript
Primary Key: id (auto-increment)
Compound Index: [alunoId, data]
Compound Index: [turmaId, data]
```

### Exemplo Vetorial:
```javascript
[
  {
    id: 1,
    _id: "falta001",
    alunoId: 3,
    turmaId: "1A",
    materia: "Sala Principal",
    data: "2024-03-15",
    justificada: false,
    motivo: null,
    createdAt: "2024-03-15T18:00:00Z"
  },
  {
    id: 2,
    _id: "falta002",
    alunoId: 2,
    turmaId: "1A",
    materia: "Inglês",
    data: "2024-03-18",
    justificada: true,
    motivo: "Consulta médica",
    createdAt: "2024-03-18T18:00:00Z"
  }
]
```

---

## 7️⃣ RELATORIOS

### Estrutura:
```javascript
{
  id: number (auto-increment),          // PK
  _id: string,                           // Compatível MongoDB
  turmaId: string,                       // FK → turmas.id
  materia: string,                       // "Sala Principal" | matéria específica
  data: Date | string,                   // "2024-03-15"
  texto: string,                         // Conteúdo do relatório
  createdBy: string,                     // ID do professor
  createdAt: Date,
  updatedAt: Date
}
```

### IDs e Chaves:
```javascript
Primary Key: id (auto-increment)
Compound Index: [turmaId, data]
```

### Exemplo Vetorial:
```javascript
[
  {
    id: 1,
    _id: "rel001",
    turmaId: "1A",
    materia: "Sala Principal",
    data: "2024-03-15",
    texto: "Aula produtiva sobre alfabetização. Alunos participativos.",
    createdBy: "prof001",
    createdAt: "2024-03-15T20:00:00Z",
    updatedAt: "2024-03-15T20:00:00Z"
  },
  {
    id: 2,
    _id: "rel002",
    turmaId: "1A",
    materia: "Sala Principal",
    data: "2024-03-16",
    texto: "Revisão de conteúdo. Alguns alunos apresentaram dúvidas.",
    createdBy: "prof001",
    createdAt: "2024-03-16T20:00:00Z",
    updatedAt: "2024-03-16T20:00:00Z"
  }
]
```

---

## 8️⃣ CONTROLE_TURMAS

### Estrutura:
```javascript
{
  id: number (auto-increment),          // PK
  _id: string,                           // Compatível MongoDB
  idUsuario: string,                     // FK → usuarios._id
  turmasPermitidas: string[],            // ["1A", "2B"]
  createdAt: Date,
  updatedAt: Date
}
```

### IDs e Chaves:
```javascript
Primary Key: id (auto-increment)
Unique Index: idUsuario
```

### Exemplo Vetorial:
```javascript
[
  {
    id: 1,
    _id: "controle001",
    idUsuario: "prof001",
    turmasPermitidas: ["1A"],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  },
  {
    id: 2,
    _id: "controle002",
    idUsuario: "prof002",
    turmasPermitidas: ["1A", "1B", "2A", "2B", "3A", "3B"],
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z"
  }
]
```

---

## 9️⃣ CONFIG

### Estrutura:
```javascript
{
  id: 1 (fixo),                          // PK
  escolaNome: string,
  anoLetivo: number,
  materias: Array<{
    id: string,                          // "portugues", "matematica"
    nome: string,                        // "Português"
    icone: string,                       // "📚"
    cor: string                          // "#4f46e5"
  }>,
  tiposAvaliacao: Array<{
    id: string,                          // "prova", "trabalho"
    nome: string,                        // "Prova"
    peso: number                         // 1.0
  }>,
  bimestres: Array<{
    numero: number,                      // 1-4
    inicio: string,                      // "2024-02-01"
    fim: string                          // "2024-04-30"
  }>,
  mediaAprovacao: number,                // 6.0
  frequenciaMinima: number,              // 75
  updatedAt: Date
}
```

### Exemplo (Documento Único):
```javascript
{
  id: 1,
  escolaNome: "Escola Municipal Exemplo",
  anoLetivo: 2024,
  materias: [
    { id: "portugues", nome: "Português", icone: "📚", cor: "#4f46e5" },
    { id: "matematica", nome: "Matemática", icone: "🔢", cor: "#22c55e" },
    { id: "ciencias", nome: "Ciências", icone: "🔬", cor: "#f59e0b" },
    { id: "historia", nome: "História", icone: "📜", cor: "#ef4444" },
    { id: "geografia", nome: "Geografia", icone: "🌍", cor: "#3b82f6" },
    { id: "ingles", nome: "Inglês", icone: "🇬🇧", cor: "#8b5cf6" },
    { id: "edfisica", nome: "Educação Física", icone: "⚽", cor: "#10b981" },
    { id: "artes", nome: "Artes", icone: "🎨", cor: "#f43f5e" },
    { id: "sebrae", nome: "SEBRAE", icone: "💡", cor: "#facc15" },
    { id: "leitura", nome: "Oficina de Leitura", icone: "📖", cor: "#38bdf8" }
  ],
  tiposAvaliacao: [
    { id: "prova", nome: "Prova", peso: 1.0 },
    { id: "trabalho", nome: "Trabalho", peso: 0.8 },
    { id: "atividade", nome: "Atividade", peso: 0.6 },
    { id: "projeto", nome: "Projeto", peso: 1.0 }
  ],
  bimestres: [
    { numero: 1, inicio: "2024-02-01", fim: "2024-04-30" },
    { numero: 2, inicio: "2024-05-01", fim: "2024-07-31" },
    { numero: 3, inicio: "2024-08-01", fim: "2024-10-31" },
    { numero: 4, inicio: "2024-11-01", fim: "2024-12-20" }
  ],
  mediaAprovacao: 6.0,
  frequenciaMinima: 75,
  updatedAt: "2024-01-01T00:00:00Z"
}
```

---

## 🔑 Resumo de IDs e Relacionamentos

```
RELACIONAMENTOS (FK):

professores.idUsuario       → usuarios._id
alunos.turmaId              → turmas.id
notas.alunoId               → alunos.id
notas.turmaId               → turmas.id
faltas.alunoId              → alunos.id
faltas.turmaId              → turmas.id
relatorios.turmaId          → turmas.id
relatorios.createdBy        → usuarios._id
controle_turmas.idUsuario   → usuarios._id
```

---

## 📊 Total de Collections/Stores

```
9 Object Stores no IndexedDB
9 Collections no MongoDB

Total estimado de documentos (exemplo):
├── usuarios: 10-50
├── professores: 10-50
├── turmas: 10 (fixo: 1A-5B)
├── alunos: 100-300
├── notas: 1000-5000
├── faltas: 500-2000
├── relatorios: 300-1500
├── controle_turmas: 10-50
└── config: 1 (único)
```

---

**Última atualização:** 2024-12-11
