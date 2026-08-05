const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const testConn = async () => {
    try {
        const uri = (process.env.MONGODB_URI || '').trim().replace(/^"|"$/g, '');
        console.log('🔌 Testando URI:', uri.replace(/:([^@]+)@/, ':****@')); // Esconde senha
        
        await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME || 'test' });
        console.log('✅ Conexão bem sucedida!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro de Autenticação:', error.message);
        process.exit(1);
    }
};

testConn();
