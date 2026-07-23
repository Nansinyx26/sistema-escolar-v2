/**
 * MongoDBIndexes.js — Índices Otimizados para MongoDB
 * 
 * Estratégia de indexação para melhorar performance de queries comuns
 * Reduz tempo de busca de O(n) para O(log n) ou O(1)
 * 
 * Executar em db.js ou migration script:
 *   node backend/scripts/create-indexes.js
 */

/**
 * ESTRATÉGIA DE INDEXAÇÃO
 * 
 * 1. Índices simples (fields mais consultados):
 *    - email (Usuario, Aluno, Professor)
 *    - perfil (Usuario)
 *    - ativo (Usuario)
 *
 * 2. Índices compostos (queries múltiplas campos):
 *    - (alunoId, periodo) em Nota
 *    - (turmaId, data) em Falta
 *    - (statusAtivo, dataCriacao) em Comunicado
 *
 * 3. Índices para busca de texto:
 *    - Comunicado.titulo, Comunicado.conteudo
 *    - Usuario.nome
 */

const mongoose = require('mongoose');

async function createIndexes() {
  try {
    console.log('🔧 [INDEXES] Criando índices MongoDB...');

    // ════════════════════════════════════════════════════════════════
    // USUARIO
    // ════════════════════════════════════════════════════════════════
    const Usuario = require('../models/Usuario');

    // Índice simples: email (procurado em login, registro, busca)
    await Usuario.collection.createIndex({ email: 1 });
    console.log('✅ Índice: Usuario.email');

    // Índice simples: perfil (filtro comum)
    await Usuario.collection.createIndex({ perfil: 1 });
    console.log('✅ Índice: Usuario.perfil');

    // Índice simples: ativo (filtro comum)
    await Usuario.collection.createIndex({ ativo: 1 });
    console.log('✅ Índice: Usuario.ativo');

    // Índice composto: perfil + ativo (filtro combinado)
    await Usuario.collection.createIndex({ perfil: 1, ativo: 1 });
    console.log('✅ Índice composto: Usuario.perfil + ativo');

    // Índice para busca de texto: nome
    await Usuario.collection.createIndex({ nome: 'text' });
    console.log('✅ Índice text: Usuario.nome');

    // ════════════════════════════════════════════════════════════════
    // ALUNO
    // ════════════════════════════════════════════════════════════════
    const Aluno = require('../models/Aluno');

    // Índice simples: email (responsável)
    await Aluno.collection.createIndex({ email: 1 });
    console.log('✅ Índice: Aluno.email');

    // Índice simples: turmaId (listagem por turma)
    await Aluno.collection.createIndex({ turmaId: 1 });
    console.log('✅ Índice: Aluno.turmaId');

    // Índice composto: turmaId + status (filtro combinado)
    await Aluno.collection.createIndex({ turmaId: 1, status: 1 });
    console.log('✅ Índice composto: Aluno.turmaId + status');

    // Índice: codigoSecreto (lookup no registro)
    await Aluno.collection.createIndex({ codigoSecreto: 1 });
    console.log('✅ Índice: Aluno.codigoSecreto');

    // ════════════════════════════════════════════════════════════════
    // NOTA
    // ════════════════════════════════════════════════════════════════
    const Nota = require('../models/Nota');

    // Índice composto: alunoId + bimestre (query comum)
    await Nota.collection.createIndex({ alunoId: 1, bimestre: 1 });
    console.log('✅ Índice composto: Nota.alunoId + bimestre');

    // Índice composto: turmaId + data (listagem por turma)
    await Nota.collection.createIndex({ turmaId: 1, data: -1 });
    console.log('✅ Índice composto: Nota.turmaId + data (descending)');

    // Índice composto: professorId + data (notas lançadas por professor)
    await Nota.collection.createIndex({ professorId: 1, data: -1 });
    console.log('✅ Índice composto: Nota.professorId + data');

    // ════════════════════════════════════════════════════════════════
    // FALTA
    // ════════════════════════════════════════════════════════════════
    const Falta = require('../models/Falta');

    // Índice composto: alunoId + data (frequência do aluno)
    await Falta.collection.createIndex({ alunoId: 1, data: -1 });
    console.log('✅ Índice composto: Falta.alunoId + data');

    // Índice composto: professorId + turmaId (faltas lançadas)
    await Falta.collection.createIndex({ professorId: 1, turmaId: 1 });
    console.log('✅ Índice composto: Falta.professorId + turmaId');

    // Índice composto: turmaId + data (período de busca)
    await Falta.collection.createIndex({ turmaId: 1, data: -1 });
    console.log('✅ Índice composto: Falta.turmaId + data');

    // ════════════════════════════════════════════════════════════════
    // COMUNICADO
    // ════════════════════════════════════════════════════════════════
    const Comunicado = require('../models/Comunicado');

    // Índice composto: statusAtivo + dataCriacao (listagem comum)
    await Comunicado.collection.createIndex({
      statusAtivo: 1,
      dataCriacao: -1
    });
    console.log('✅ Índice composto: Comunicado.statusAtivo + dataCriacao');

    // Índice para busca de texto: titulo + conteudo
    await Comunicado.collection.createIndex({
      titulo: 'text',
      conteudo: 'text'
    });
    console.log('✅ Índice text: Comunicado.titulo + conteudo');

    // Índice simples: tipo (filtro)
    await Comunicado.collection.createIndex({ tipo: 1 });
    console.log('✅ Índice: Comunicado.tipo');

    // ════════════════════════════════════════════════════════════════
    // GRADE HORÁRIA
    // ════════════════════════════════════════════════════════════════
    const GradeHoraria = require('../models/GradeHoraria');

    // Índice composto: professorId + turmaId (grade do professor)
    await GradeHoraria.collection.createIndex({
      professorId: 1,
      turmaId: 1
    });
    console.log('✅ Índice composto: GradeHoraria.professorId + turmaId');

    // Índice simples: turmaId (listagem de turmas)
    await GradeHoraria.collection.createIndex({ turmaId: 1 });
    console.log('✅ Índice: GradeHoraria.turmaId');

    // ════════════════════════════════════════════════════════════════
    // RECUPERAÇÃO SENHA
    // ════════════════════════════════════════════════════════════════
    const RecuperacaoSenha = require('../models/RecuperacaoSenha');

    // Índice composto: usuarioId + status (busca de código ativo)
    await RecuperacaoSenha.collection.createIndex({
      usuarioId: 1,
      status: 1
    });
    console.log('✅ Índice composto: RecuperacaoSenha.usuarioId + status');

    // Índice para limpeza automática (TTL): expiraEm
    await RecuperacaoSenha.collection.createIndex(
      { expiraEm: 1 },
      { expireAfterSeconds: 0 } // Remove documento quando expiraEm < now
    );
    console.log('✅ Índice TTL: RecuperacaoSenha.expiraEm');

    // ════════════════════════════════════════════════════════════════
    // PROFESSOR
    // ════════════════════════════════════════════════════════════════
    const Professor = require('../models/Professor');

    // Índice simples: email
    await Professor.collection.createIndex({ email: 1 });
    console.log('✅ Índice: Professor.email');

    // Índice simples: salaPrincipal (filtro por sala)
    await Professor.collection.createIndex({ salaPrincipal: 1 });
    console.log('✅ Índice: Professor.salaPrincipal');

    console.log('✅ [INDEXES] Todos os índices criados com sucesso!');
  } catch (error) {
    console.error('❌ [INDEXES] Erro ao criar índices:', error.message);
    throw error;
  }
}

/**
 * Script de execução
 */
async function run() {
  try {
    // Conectar ao MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/escola_dev');
    console.log('📦 Conectado ao MongoDB');

    // Criar índices
    await createIndexes();

    // Listar índices criados
    const Usuario = require('../models/Usuario');
    const indexes = await Usuario.collection.getIndexes();
    console.log('\n📊 Índices na coleção Usuario:');
    console.log(JSON.stringify(indexes, null, 2));

    console.log('\n✅ Processo concluído!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro fatal:', error.message);
    process.exit(1);
  }
}

// Exportar função para ser usada em migrations
module.exports = { createIndexes };

// Se executado diretamente
if (require.main === module) {
  run();
}
