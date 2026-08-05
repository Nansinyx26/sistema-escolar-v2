require('dotenv').config();
const mongoose = require('mongoose');
const sharp = require('sharp');

// Conexão
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI não definida no .env');
    process.exit(1);
}

// Modelos genéricos para acessar as coleções
const collectionsToProcess = ['alunos', 'professores', 'diretores', 'usuarios'];

async function convertBase64ToWebP(base64String) {
    try {
        if (!base64String || typeof base64String !== 'string') return null;

        // Se já for WebP, ignora
        if (base64String.startsWith('data:image/webp')) return null;

        let buffer;
        if (base64String.includes('base64,')) {
            buffer = Buffer.from(base64String.split('base64,')[1], 'base64');
        } else {
            return null; // Não é um data URI reconhecido
        }

        const webpBuffer = await sharp(buffer)
            .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer();

        return `data:image/webp;base64,${webpBuffer.toString('base64')}`;
    } catch (error) {
        console.warn('⚠️ Falha ao converter imagem:', error.message);
        return null; // Retorna nulo se der erro, assim não sobrescreve
    }
}

async function convertAllPhotos() {
    console.log('🔌 Conectando ao MongoDB...');
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Conectado ao banco de dados.\n');

        let totalConverted = 0;
        let totalBytesSaved = 0;

        for (const collName of collectionsToProcess) {
            console.log(`Processando coleção '${collName}'...`);
            const db = mongoose.connection.db;
            const collection = db.collection(collName);

            // Encontrar todos os documentos que possuem "foto"
            const docs = await collection.find({ foto: { $exists: true, $ne: "", $ne: null } }).toArray();
            
            let countColl = 0;

            for (const doc of docs) {
                const originalLength = doc.foto.length;
                
                // Converte e redimensiona
                const webpBase64 = await convertBase64ToWebP(doc.foto);
                
                if (webpBase64) {
                    const newLength = webpBase64.length;
                    
                    // Só atualiza se for menor ou se for uma conversão de formato com sucesso
                    await collection.updateOne(
                        { _id: doc._id },
                        { $set: { foto: webpBase64 } }
                    );

                    const saved = originalLength - newLength;
                    if (saved > 0) totalBytesSaved += saved;
                    
                    countColl++;
                    process.stdout.write('.');
                }
            }

            console.log(`\n✅ ${countColl} fotos convertidas em '${collName}'.`);
            totalConverted += countColl;
        }

        console.log('\n====================================');
        console.log(`🎉 Conversão concluída!`);
        console.log(`📸 Total de fotos convertidas: ${totalConverted}`);
        console.log(`💾 Espaço aproximado economizado (em base64 bytes): ${(totalBytesSaved / 1024 / 1024).toFixed(2)} MB`);
        console.log('====================================');
    } catch (err) {
        console.error('❌ Erro durante a conversão:', err);
    } finally {
        await mongoose.disconnect();
        console.log('Desconectado.');
    }
}

convertAllPhotos();
