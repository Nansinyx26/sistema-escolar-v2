const mongoose = require('mongoose');
const logger = require('./logger');

const connectDB = async () => {
  try {
    let uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB_NAME || 'test';
    
    if (!uri) {
        if (process.env.NODE_ENV !== 'production') {
            logger.warn('MONGODB_URI não definida — iniciando MongoDB em memória para desenvolvimento');
            const { MongoMemoryServer } = require('mongodb-memory-server');
            const mongod = await MongoMemoryServer.create();
            uri = mongod.getUri();
            process.env.MONGODB_URI = uri;
            global.__MONGOD__ = mongod;
        } else {
            throw new Error('MONGODB_URI não definida nas variáveis de ambiente.');
        }
    }

    // Log para conferência (seguro — credenciais mascaradas)
    const maskedUri = uri.replace(/:([^@]+)@/, ':****@');
    logger.info('🔌 Conectando ao banco de dados', { dbName, uri: maskedUri });

    try {
        await mongoose.connect(uri, {
          dbName: dbName,
          serverSelectionTimeoutMS: 5000 // Limite de 5 segundos para falha
        });
        logger.info('✅ MongoDB conectado com sucesso', { dbName });
    } catch (err) {
        if (process.env.NODE_ENV !== 'production' && !global.__MONGOD__) {
            logger.warn('Falha ao conectar ao MongoDB local — iniciando MongoDB em memória', { error: err.message });
            const { MongoMemoryServer } = require('mongodb-memory-server');
            const mongod = await MongoMemoryServer.create();
            const memoryUri = mongod.getUri();
            process.env.MONGODB_URI = memoryUri;
            global.__MONGOD__ = mongod;
            await mongoose.connect(memoryUri);
            logger.info('✅ MongoDB conectado com sucesso (em memória)');
        } else {
            throw err;
        }
    }

    // Listeners de eventos do Mongoose para observabilidade contínua
    mongoose.connection.on('disconnected', () => {
        logger.alert('DB_DISCONNECTED', 'Conexão com o MongoDB foi perdida', { dbName });
    });

    mongoose.connection.on('reconnected', () => {
        logger.info('✅ MongoDB reconectado automaticamente', { dbName });
    });

    mongoose.connection.on('error', (err) => {
        logger.alert('DB_ERROR', `Erro na conexão MongoDB: ${err.message}`, { dbName, error: err.message });
    });

  } catch (error) {
    logger.alert('DB_FATAL', `Erro fatal de conexão: ${error.message}`, { error: error.message, stack: error.stack });
    // Não encerra o processo imediatamente para permitir ver o log no Render
    setTimeout(() => process.exit(1), 1000);
  }
};

module.exports = connectDB;
