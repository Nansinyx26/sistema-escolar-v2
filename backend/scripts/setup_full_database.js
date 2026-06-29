require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const MigrationService = require('../src/services/MigrationService');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('Erro: MONGODB_URI não definida no .env');
    process.exit(1);
}

const runSetup = async () => {
    try {
        console.log('🔌 Conectando ao MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Conectado.');

        const jsonFile = path.resolve(__dirname, '../../data/escola_database.json');
        console.log(`📂 Lendo arquivo de dados: ${jsonFile}`);

        if (!fs.existsSync(jsonFile)) {
            throw new Error(`Arquivo não encontrado: ${jsonFile}`);
        }

        const rawData = fs.readFileSync(jsonFile, 'utf8');
        const data = JSON.parse(rawData);

        // Remove metadados se existirem
        delete data._metadata;

        console.log('🚀 Iniciando setup/migração do banco de dados...');
        const results = await MigrationService.migrateData(data);

        console.log('📊 Resultados da importação:');
        console.table(results);

        console.log('✅ Setup concluído com sucesso! O MongoDB Atlas está pronto.');

    } catch (error) {
        console.error('❌ Erro no setup:', error);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
};

runSetup();
