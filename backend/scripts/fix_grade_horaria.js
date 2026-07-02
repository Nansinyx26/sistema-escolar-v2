require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

async function fixGradeHoraria() {
    try {
        console.log('🔌 Conectando ao MongoDB...');
        await mongoose.connect(MONGODB_URI);
        const db = mongoose.connection.db;

        console.log('📦 Movendo "gradehorarias" -> "grade_horaria"...');
        const data = await db.collection('gradehorarias').find({}).toArray();
        console.log(`📖 Lidos ${data.length} documentos.`);

        if (data.length > 0) {
            let insertedCount = 0;
            let skippedCount = 0;

            for (const doc of data) {
                try {
                    await db.collection('grade_horaria').insertOne(doc);
                    insertedCount++;
                } catch (err) {
                    if (err.code === 11000) skippedCount++;
                    else console.error(`  ❌ Erro: ${err.message}`);
                }
            }
            console.log(`✅ Concluído: ${insertedCount} inseridos, ${skippedCount} duplicatas puladas.`);
        }

        console.log('🗑️ Removendo coleção incorreta "gradehorarias"...');
        await db.collection('gradehorarias').drop();
        console.log('  ✓ "gradehorarias" removida.');

    } catch (error) {
        console.error('💥 Erro:', error.message);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Desconectado.');
    }
}

fixGradeHoraria();
