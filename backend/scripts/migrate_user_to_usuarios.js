require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ Erro: MONGODB_URI não definida no .env');
    process.exit(1);
}

async function migrate() {
    try {
        console.log('🔌 Conectando ao MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Conectado.');

        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);

        let sourceCollection = '';
        if (collectionNames.includes('user')) {
            sourceCollection = 'user';
        } else if (collectionNames.includes('users')) {
            sourceCollection = 'users';
        }

        if (!sourceCollection) {
            console.log('⚠️ Nenhuma coleção "user" ou "users" encontrada para migração.');
            // Verificando se "usuarios" já tem dados
            const targetCount = await db.collection('usuarios').countDocuments();
            console.log(`📊 A coleção "usuarios" possui atualmente ${targetCount} documentos.`);
            return;
        }

        console.log(`📦 Coleção de origem encontrada: "${sourceCollection}"`);
        const data = await db.collection(sourceCollection).find({}).toArray();
        console.log(`📖 Lidos ${data.length} documentos de "${sourceCollection}".`);

        if (data.length === 0) {
            console.log('ℹ️ A coleção de origem está vazia. Nada a migrar.');
            return;
        }

        console.log('📥 Inserindo dados na coleção "usuarios"...');
        
        // Usando loop para evitar erros de duplicata interrompendo tudo se houver índices únicos
        let insertedCount = 0;
        let skippedCount = 0;

        for (const doc of data) {
            try {
                // Remove _id para permitir que o MongoDB gere um novo ou use o esquema do model
                // Ou mantém se quiser preservar IDs, mas como estamos mudando de coleção, 
                // pode haver conflito se rodar múltiplas vezes.
                // Vou tentar inserir mantendo o ID original primeiro.
                await db.collection('usuarios').insertOne(doc);
                insertedCount++;
            } catch (err) {
                if (err.code === 11000) { // Duplicate key error
                    skippedCount++;
                } else {
                    console.error(`❌ Erro ao inserir documento ${doc._id || 'sem id'}:`, err.message);
                }
            }
        }

        console.log(`✅ Migração concluída!`);
        console.log(`  - Documentos inseridos: ${insertedCount}`);
        if (skippedCount > 0) {
            console.log(`  - Documentos pulados (duplicados): ${skippedCount}`);
        }

    } catch (error) {
        console.error('💥 Erro fatal durante a migração:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Desconectado do MongoDB.');
    }
}

migrate();
