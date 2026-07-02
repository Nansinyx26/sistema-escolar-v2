const path = require('path');
const dotenv = require('dotenv');

// Carregar variáveis de ambiente do .env local se houver
dotenv.config({ path: path.join(__dirname, '../.env') });

if (!process.env.MONGODB_URI) {
    console.error('❌ Variável de ambiente MONGODB_URI não encontrada.');
    console.error('   Crie um arquivo .env na raiz do projeto com: MONGODB_URI=mongodb+srv://...');
    process.exit(1);
}

const connectDB = require('../src/utils/db');
const mongoose = require('mongoose');

async function verify() {
    console.log('🔌 Chamando a nova função connectDB...');
    try {
        await connectDB();
        console.log('✅ Conexão bem-sucedida!');

        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        const names = collections.map(c => c.name).sort();

        console.log('\nColeções no banco de dados após inicialização:');
        console.log(names);
        console.log(`\nTotal de coleções: ${names.length}`);

        // Verificar se "matriculas" foi criada como esperado (que estava faltando)
        if (names.includes('matriculas')) {
            console.log('🎉 SUCESSO: A coleção "matriculas" foi criada automaticamente durante o startup!');
        } else {
            console.log('❌ FALHA: A coleção "matriculas" não foi criada.');
        }

    } catch (err) {
        console.error('❌ Erro no teste de conexão:', err);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Conexão encerrada.');
    }
}

verify();
