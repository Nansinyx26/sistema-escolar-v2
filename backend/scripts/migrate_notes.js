require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

async function migrateNotes() {
    try {
        console.log('🔌 Conectando ao MongoDB...');
        await mongoose.connect(MONGODB_URI);
        const db = mongoose.connection.db;

        console.log('📦 Migrando "notes" -> "notas"...');
        const data = await db.collection('notes').find({}).toArray();
        console.log(`📖 Lidos ${data.length} documentos.`);

        if (data.length > 0) {
            let insertedCount = 0;
            let skippedCount = 0;

            for (const doc of data) {
                try {
                    await db.collection('notas').insertOne(doc);
                    insertedCount++;
                } catch (err) {
                    if (err.code === 11000) skippedCount++;
                    else console.error(`  ❌ Erro: ${err.message}`);
                }
            }
            console.log(`✅ Concluído: ${insertedCount} inseridos, ${skippedCount} duplicatas puladas.`);
        }

        console.log('🗑️ Removendo coleção original "notes"...');
        await db.collection('notes').drop();
        console.log('  ✓ "notes" removida.');

    } catch (error) {
        console.error('💥 Erro:', error.message);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Desconectado.');
    }
}

migrateNotes();
