require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

async function consolidateGradeHorarias() {
    try {
        console.log('🔌 Conectando ao MongoDB...');
        await mongoose.connect(MONGODB_URI);
        const db = mongoose.connection.db;

        const collections = await db.listCollections().toArray();
        const names = collections.map(c => c.name);

        if (names.includes('grade_horaria')) {
            console.log('📦 Movendo dados de "grade_horaria" para "gradehorarias"...');
            const data = await db.collection('grade_horaria').find({}).toArray();
            console.log(`📖 Lidos ${data.length} documentos.`);

            if (data.length > 0) {
                let insertedCount = 0;
                let skippedCount = 0;

                for (const doc of data) {
                    try {
                        await db.collection('gradehorarias').insertOne(doc);
                        insertedCount++;
                    } catch (err) {
                        if (err.code === 11000) skippedCount++;
                        else console.error(`  ❌ Erro: ${err.message}`);
                    }
                }
                console.log(`✅ Concluído: ${insertedCount} inseridos, ${skippedCount} duplicatas puladas.`);
            }

            console.log('🗑️ Removendo coleção "grade_horaria"...');
            await db.collection('grade_horaria').drop();
            console.log('  ✓ "grade_horaria" removida.');
        } else {
            console.log('ℹ️ Coleção "grade_horaria" não encontrada. Nada a consolidar.');
        }

    } catch (error) {
        console.error('💥 Erro:', error.message);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Desconectado.');
    }
}

consolidateGradeHorarias();
