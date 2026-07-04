/**
 * Migração multi-escola: carimba escolaId da Escola Jaguari em todos os
 * documentos legados (criados antes do suporte multi-escola) e cria o
 * array `vinculos` nos perfis de equipe (professores/diretores/secretarias).
 *
 * - Idempotente: só toca em documentos SEM escolaId (ou com o placeholder
 *   'default') e em perfis sem vinculos.
 * - Loga a contagem de documentos atualizados por collection.
 *
 * Uso: node scripts/migrarParaMultiEscola.js
 *      (rode scripts/seedEscolas.js antes, ou este script cria a Jaguari)
 */
require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI não definida no .env — abortando.');
    process.exit(1);
}

const Escola = require('../src/models/Escola');

const ESCOLA_JAGUARI = 'CIEP Profª Maria Nilde Mascellani';

// Collections de dados que recebem escolaId
const COLLECTIONS_DADOS = [
    'turmas', 'alunos', 'notas', 'faltas', 'comunicados', 'notificacoes',
    'matriculas', 'gradehorarias', 'atribuicaoprofessors', 'frequenciaprofessors'
];

// Perfis de equipe que recebem vinculos [{ escolaId, cargo }]
const PERFIS_EQUIPE = [
    { collection: 'professores', cargo: 'professor' },
    { collection: 'diretores', cargo: 'diretor' },
    { collection: 'secretarias', cargo: 'secretaria' },
];

async function main() {
    await mongoose.connect(MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME || undefined });
    console.log('✅ Conectado ao MongoDB\n');
    const db = mongoose.connection.db;

    // 1. Localiza (ou cria) o documento da Escola Jaguari
    let jaguari = await Escola.findOne({ nome: ESCOLA_JAGUARI });
    if (!jaguari) {
        jaguari = await Escola.create({
            nome: ESCOLA_JAGUARI,
            tipo: 'CIEP',
            bairro: 'Residencial Jaguari',
            municipio: 'Americana',
            ativo: true
        });
        console.log(`✨ Escola Jaguari criada (id: ${jaguari._id})`);
    } else {
        console.log(`🏫 Escola Jaguari localizada (id: ${jaguari._id})`);
    }
    const escolaId = String(jaguari._id);

    // 2. Carimba escolaId em todos os documentos legados
    console.log('\n── Dados ────────────────────────────────');
    const existentes = new Set((await db.listCollections().toArray()).map(c => c.name));
    for (const nome of COLLECTIONS_DADOS) {
        if (!existentes.has(nome)) {
            console.log(`   ${nome}: collection não existe — pulada`);
            continue;
        }
        const r = await db.collection(nome).updateMany(
            { $or: [{ escolaId: { $exists: false } }, { escolaId: null }, { escolaId: 'default' }] },
            { $set: { escolaId } }
        );
        console.log(`   ${nome}: ${r.modifiedCount} documento(s) atualizados`);
    }

    // 3. Cria vinculos nos perfis de equipe a partir do cargo atual
    console.log('\n── Vínculos de equipe ───────────────────');
    for (const { collection, cargo } of PERFIS_EQUIPE) {
        if (!existentes.has(collection)) {
            console.log(`   ${collection}: collection não existe — pulada`);
            continue;
        }
        const r = await db.collection(collection).updateMany(
            { $or: [{ vinculos: { $exists: false } }, { vinculos: { $size: 0 } }] },
            { $set: { vinculos: [{ escolaId, cargo }], escolaId } }
        );
        console.log(`   ${collection}: ${r.modifiedCount} perfil(is) vinculados à Jaguari como "${cargo}"`);
    }

    console.log('\n✅ Migração concluída. Todos os dados legados pertencem agora à Escola Jaguari.');
    await mongoose.disconnect();
}

main().catch(err => {
    console.error('❌ Erro na migração:', err);
    process.exit(1);
});
