require('dotenv').config();
const mongoose = require('mongoose');
const { saveToGridFS } = require('../src/utils/gridfs');

async function migrate() {
    console.log('🔌 Conectando ao MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado ao banco de dados.');

    const collections = ['alunos', 'professores', 'diretores', 'usuarios'];
    let totalMigrated = 0;

    for (const collName of collections) {
        console.log(`Verificando coleção '${collName}'...`);
        const collection = mongoose.connection.db.collection(collName);
        const docs = await collection.find({ foto: { $exists: true, $ne: '', $ne: null } }).toArray();

        for (const doc of docs) {
            // Se for URL ou GridFS ID, pula
            if (!doc.foto.startsWith('data:')) {
                continue;
            }

            console.log(`  Processando foto base64 do documento: ${doc.nome || doc.email || doc._id}`);
            try {
                // Extrai buffer e mime type
                const mimeMatch = doc.foto.match(/^data:([^;]+);base64,/);
                const contentType = mimeMatch ? mimeMatch[1] : 'image/webp';
                const base64Data = doc.foto.replace(/^data:[^;]+;base64,/, '');
                const buffer = Buffer.from(base64Data, 'base64');

                // Salva no GridFS
                const filename = `photo_${doc._id}_${Date.now()}.webp`;
                const fileId = await saveToGridFS(buffer, filename, contentType);

                // Atualiza o documento no banco
                const fotoPath = `gridfs:${fileId}`;
                await collection.updateOne({ _id: doc._id }, { $set: { foto: fotoPath } });
                console.log(`    ✓ Migrado com sucesso! Novo valor: ${fotoPath}`);
                totalMigrated++;
            } catch (err) {
                console.error(`    ❌ Erro ao migrar foto do documento ${doc._id}:`, err.message);
            }
        }
    }

    console.log(`\n====================================`);
    console.log(`🎉 Migração de fotos concluída!`);
    console.log(`📸 Total de fotos migradas para GridFS: ${totalMigrated}`);
    console.log(`====================================`);

    await mongoose.disconnect();
}

migrate().catch(console.error);
