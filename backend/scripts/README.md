# 🛠️ Scripts do Backend

Esta pasta contém diversos scripts utilitários usados para manutenção, migração, diagnóstico e correção do banco de dados MongoDB do Sistema Escolar v2. 

⚠️ **Aviso Importante:** A maioria destes scripts atua diretamente na base de dados conectada pela sua variável de ambiente `MONGODB_URI`. Sempre execute backups antes de rodar scripts de migração ou limpeza.

---

## 📂 Categorias de Scripts

### 1. Migração (IndexedDB → MongoDB)
Scripts legados ou ativos usados durante a transição do banco local do navegador para a nuvem.
- `migrate-to-mongodb.js` — Script principal de migração
- `migrate-with-webp.js` — Migração convertendo fotos para WebP
- `migrate_indexeddb_to_mongodb.js` — Outro utilitário de migração
- `migrate_user_to_usuarios.js` — Migração de esquema (coleção Users para Usuarios)
- `migrate_notes.js` — Migração específica de notas
- `migrate_english_to_portuguese.js` — Tradução de chaves no DB

### 2. Diagnóstico e Inspeção
Usados para investigar o estado do banco e os dados salvos.
- `diagnostico-db.js` — Visão geral da saúde do DB
- `check_db.js` / `test_db.js` — Teste de conexão básica
- `inspect_all_json.js` / `inspect_json.js` / `inspect_details.js` — Visualiza coleções em formato JSON
- `deep_search_json.js` — Busca profunda em arquivos
- `list_collections.js` / `list_cols_clean.js` — Lista as coleções existentes
- `check_classes.js` / `check_teachers.js` / `check_student_fields.js` — Checa a integridade das entidades
- `check_renan_ids.js` — Script customizado de checagem

### 3. Ajustes de Banco e Correção de Dados (Fixes)
Scripts que corrigem inconsistências ou formatos antigos no banco.
- `fix_grade_horaria.js` — Correções na grade
- `fix_teacher.js` / `update_teacher.js` — Ajustes de esquema em professores
- `update_db_config.js` — Atualização das configurações
- `update_materias_especiais.js` — Correção de matérias
- `add_classes_c_d.js` — Adiciona as turmas C e D ao sistema
- `migrar-senhas-bcrypt.js` — Criptografa senhas antigas em texto plano
- `convert_db_to_webp.js` — Processa fotos antigas salvando espaço

### 4. Limpeza e Reset
⚠️ Use com cuidado. Modificam ou apagam registros em massa.
- `cleanup_db.js` — Limpa todas as coleções de teste
- `cleanup_teachers.js` — Remove professores inválidos
- `remove_student.js` — Deleta alunos específicos
- `reset_admin_password.js` / `reset_user_password.js` — Reseta a senha do diretor ou usuários
- `criar_admin_novo.js` — Cria uma nova conta root no banco

### 5. Testes Internos
- `test_endpoints.js` — Validação de rotas (REST)
- `test_login.js` — Simula e valida o processo de auth JWT
- `create_test_user.js` — Cria usuário genérico para dev
- `seed_config.js` / `setup_full_database.js` — Populam o banco local com dados iniciais
- `consolidate_grades.js` / `debug_avaliacoes.js` / `estimate_photos.js` — Utilitários menores

---

### 💻 Como executar
Abra o terminal na pasta `backend` e rode com Node:

```bash
# Exemplo
node scripts/diagnostico-db.js
```
