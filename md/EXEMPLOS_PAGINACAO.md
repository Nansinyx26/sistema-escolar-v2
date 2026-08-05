/**
 * PaginationExamples.md
 * 
 * Exemplos de como implementar paginação em controllers existentes
 * Inclui padrões para diferentes tipos de queries
 */

# 📚 Exemplos de Paginação

## 1. Exemplo Básico — Listagem Simples

### Antes (sem paginação)
```javascript
// GET /api/comunicados
exports.list = async (req, res) => {
  try {
    const comunicados = await Comunicado.find().lean();
    res.json({ success: true, data: comunicados });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
```

**Problema:** Se houver 10.000 comunicados, retorna todos de uma vez (payload gigante, lento)

### Depois (com paginação)
```javascript
const { pagination, formatPaginatedResponse } = require('../middleware/pagination');

// Na rota:
router.get('/comunicados', pagination(20, 100), ComunicadoController.list);

// No controller:
exports.list = async (req, res) => {
  try {
    // Buscar dados paginados
    const data = await Comunicado.find()
      .skip(req.pagination.skip)
      .limit(req.pagination.limit)
      .sort({ dataCriacao: -1 })
      .lean();

    // Contar total
    const total = await Comunicado.countDocuments();

    // Formatar resposta
    const response = formatPaginatedResponse(data, total, req.pagination);
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
```

**Resposta:**
```json
{
  "success": true,
  "data": [ {id, titulo, ...}, ... ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "pages": 8,
    "hasNextPage": true,
    "hasPrevPage": false,
    "nextPage": 2,
    "prevPage": null
  }
}
```

## 2. Exemplo com Filtros

### Com paginação e filtros
```javascript
exports.list = async (req, res) => {
  try {
    // Construir query com filtros
    const filters = {};
    
    if (req.query.statusAtivo !== undefined) {
      filters.statusAtivo = req.query.statusAtivo === 'true';
    }
    
    if (req.query.tipo) {
      filters.tipo = req.query.tipo;
    }
    
    if (req.query.search) {
      filters.$text = { $search: req.query.search };
    }

    // Buscar dados paginados
    const data = await Comunicado.find(filters)
      .skip(req.pagination.skip)
      .limit(req.pagination.limit)
      .sort({ dataCriacao: -1 })
      .lean();

    // Contar total com os mesmos filtros
    const total = await Comunicado.countDocuments(filters);

    res.json(formatPaginatedResponse(data, total, req.pagination));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
```

**Uso:**
```
GET /api/comunicados?page=1&limit=20&tipo=mural&statusAtivo=true&search=importante
```

## 3. Exemplo com Agregação MongoDB

Para queries complexas (joins, transformações), usar agregação:

```javascript
exports.listWithAlunoData = async (req, res) => {
  try {
    // Pipeline de agregação
    const pipeline = [
      // 1. Match (aplicar filtros)
      { 
        $match: { 
          statusAtivo: true,
          turmaId: req.query.turmaId 
        } 
      },
      
      // 2. Lookup (join com Aluno)
      { 
        $lookup: {
          from: 'alunos',
          localField: 'alunoId',
          foreignField: '_id',
          as: 'aluno'
        }
      },
      
      // 3. Unwind (descompactar array)
      { $unwind: '$aluno' },
      
      // 4. Sort
      { $sort: { dataCriacao: -1 } },
      
      // 5. Facet (para paginação + count)
      {
        $facet: {
          data: [
            { $skip: req.pagination.skip },
            { $limit: req.pagination.limit }
          ],
          count: [{ $count: 'total' }]
        }
      }
    ];

    const result = await Comunicado.aggregate(pipeline);
    const data = result[0].data;
    const total = result[0].count[0]?.total || 0;

    res.json(formatPaginatedResponse(data, total, req.pagination));
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
```

## 4. Exemplo com Cache

Integrar paginação com cache:

```javascript
const cacheService = require('../services/CacheService');

exports.listCached = async (req, res) => {
  try {
    const cacheKey = `comunicados:${req.pagination.page}:${req.pagination.limit}`;
    
    // Tentar buscar do cache
    let response = cacheService.get(cacheKey);
    
    if (!response) {
      // Cache miss: buscar do banco
      const data = await Comunicado.find()
        .skip(req.pagination.skip)
        .limit(req.pagination.limit)
        .lean();
      
      const total = await Comunicado.countDocuments();
      response = formatPaginatedResponse(data, total, req.pagination);
      
      // Armazenar no cache por 5 minutos
      cacheService.set(cacheKey, response, 300);
    }
    
    res.json(response);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
```

## 5. Checklist de Implementação

Para cada endpoint de listagem:

- [ ] Adicionar `pagination(20, 100)` middleware à rota
- [ ] Usar `req.pagination.skip` e `req.pagination.limit` na query
- [ ] Contar total com `.countDocuments()` com os mesmos filtros
- [ ] Usar `formatPaginatedResponse()` para formatar resposta
- [ ] Testar com `?page=1&limit=20`
- [ ] Testar página além do limite (deve retornar vazio)
- [ ] Testar sem query params (deve usar defaults)

## 6. Endpoints Críticos para Paginação

Priorizar estes endpoints:

```
GET /api/comunicados              (atualmente sem paginação)
GET /api/notas                    (pode retornar 100+ notas)
GET /api/faltas                   (lista de faltas por turma)
GET /api/alunos                   (lista de alunos da turma)
GET /api/usuarios                 (admin list)
GET /api/professor/:id/turmas     (turmas do professor)
GET /api/grade-horaria            (horários podem ser grandes)
GET /api/historico/eventos        (log de eventos)
```

## 7. Resposta Padrão Esperada

```json
{
  "success": true,
  "data": [
    { "id": "...", "titulo": "...", ... },
    { "id": "...", "titulo": "...", ... }
  ],
  "pagination": {
    "page": 2,
    "limit": 20,
    "total": 150,
    "pages": 8,
    "hasNextPage": true,
    "hasPrevPage": true,
    "nextPage": 3,
    "prevPage": 1
  }
}
```

---

## 🚀 Próximos Passos

1. **Implementar em 3-5 endpoints críticos** (comunicados, notas, alunos)
2. **Adicionar testes** que verificam paginação
3. **Frontend:** Usar `nextPage` e `prevPage` para botões "Próxima" / "Anterior"
4. **Cache:** Integrar com cache service para melhorar performance

