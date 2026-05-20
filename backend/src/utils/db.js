const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    let uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB_NAME || 'test';
    
    if (!uri) {
        if (process.env.NODE_ENV !== 'production') {
            console.log('⚠️ MONGODB_URI não definida. Iniciando MongoDB em memória para desenvolvimento...');
            const { MongoMemoryServer } = require('mongodb-memory-server');
            const mongod = await MongoMemoryServer.create();
            uri = mongod.getUri();
            process.env.MONGODB_URI = uri;
            global.__MONGOD__ = mongod;
        } else {
            throw new Error('MONGODB_URI não definida nas variáveis de ambiente.');
        }
    }

    // Log para conferência (seguro)
    const maskedUri = uri.replace(/:([^@]+)@/, ':****@');
    console.log(`🔌 Conectando ao banco: ${dbName}`);
    console.log(`🔗 URI: ${maskedUri}`);

    try {
        await mongoose.connect(uri, {
          dbName: dbName,
          serverSelectionTimeoutMS: 5000 // Limite de 5 segundos para falha
        });
        console.log('✅ MongoDB Conectado com sucesso!');
    } catch (err) {
        if (process.env.NODE_ENV !== 'production' && !global.__MONGOD__) {
            console.log('⚠️ Falha ao conectar ao MongoDB local. Iniciando MongoDB em memória...');
            const { MongoMemoryServer } = require('mongodb-memory-server');
            const mongod = await MongoMemoryServer.create();
            const memoryUri = mongod.getUri();
            process.env.MONGODB_URI = memoryUri;
            global.__MONGOD__ = mongod;
            await mongoose.connect(memoryUri);
            console.log('✅ MongoDB Conectado com sucesso (em memória)!');
        } else {
            throw err;
        }
    }
  } catch (error) {
    console.error(`❌ Erro de Conexão: ${error.message}`);
    // Não encerra o processo imediatamente para permitir ver o log no Render
    setTimeout(() => process.exit(1), 1000);
  }
};

module.exports = connectDB;
