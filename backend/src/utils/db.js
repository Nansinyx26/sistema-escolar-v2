const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // Pega a URI direto do ambiente, sem tratamentos complexos primeiro
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.MONGODB_DB_NAME || 'test';
    
    if (!uri) {
        throw new Error('MONGODB_URI não definida nas variáveis de ambiente.');
    }

    // Log para conferência (seguro)
    const maskedUri = uri.replace(/:([^@]+)@/, ':****@');
    console.log(`🔌 Conectando ao banco: ${dbName}`);
    console.log(`🔗 URI: ${maskedUri}`);

    await mongoose.connect(uri, {
      dbName: dbName
    });
    
    console.log('✅ MongoDB Conectado com sucesso!');
  } catch (error) {
    console.error(`❌ Erro de Conexão: ${error.message}`);
    // Não encerra o processo imediatamente para permitir ver o log no Render
    setTimeout(() => process.exit(1), 1000);
  }
};

module.exports = connectDB;
