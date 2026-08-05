require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ Erro: MONGODB_URI não definida no .env');
    process.exit(1);
}

const mapping = {
    'students': 'alunos',
    'attendances': 'faltas',
    'classes': 'turmas',
    'directors': 'diretores',
    'reports': 'relatorios',
    'schedules': 'gradehorarias',
    'specialclasses': 'specialclasses' // Mantido conforme model
};

async function migrateAll() {
    try {
        console.log('🔌 Conectando ao MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Conectado.');

        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const existingNames = collections.map(c => c.name);

        for (const [english, portuguese] of Object.entries(mapping)) {
            if (!existingNames.includes(english)) {
                console.log(`ℹ️ Coleção "${english}" não encontrada. Pulando.`);
                continue;
            }

            console.log(`\n📦 Migrando "${english}" -> "${portuguese}"...`);
            const data = await db.collection(english).find({}).toArray();
            console.log(`📖 Lidos ${data.length} documentos.`);

            if (data.length === 0) {
                console.log(`ℹ️ Nenhuma dado em "${english}". Excluindo coleção vazia...`);
                await db.collection(english).drop();
                continue;
            }

            // Inserir dados na coleção de destino
            let insertedCount = 0;
            let skippedCount = 0;

            for (const doc of data) {
                try {
                    await db.collection(portuguese).insertOne(doc);
                    insertedCount++;
                } catch (err) {
                    if (err.code === 11000) {
                        skippedCount++;
                    } else {
                        console.error(`  ❌ Erro no documento ${doc._id}: ${err.message}`);
                    }
                }
            }

            console.log(`✅ Concluído: ${insertedCount} inseridos, ${skippedCount} duplicatas puladas.`);

            // Excluir coleção de origem se pelo menos tentamos a migração
            console.log(`🗑️ Removendo coleção original "${english}"...`);
            await db.collection(english).drop();
            console.log(`  ✓ "${english}" removida.`);
        }

        console.log('\n✨ MIGRACÍO EM MASSA CONCLUÍDA ✨');

    } catch (error) {
        console.error('💥 Erro fatal:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Desconectado.');
    }
}

migrateAll();
