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

const args = process.argv.slice(2);
const jsonFile = args[0];

if (!jsonFile) {
    console.log('Uso: node scripts/migrate_indexeddb_to_mongodb.js <caminho-para-json>');
    process.exit(1);
}

const runMigration = async () => {
    try {
        console.log('Conectando ao MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('Conectado.');

        console.log(`Lendo arquivo: ${jsonFile}`);
        const absolutePath = path.isAbsolute(jsonFile) ? jsonFile : path.resolve(process.cwd(), jsonFile);

        if (!fs.existsSync(absolutePath)) {
            throw new Error(`Arquivo não encontrado: ${absolutePath}`);
        }

        const rawData = fs.readFileSync(absolutePath, 'utf8');
        const data = JSON.parse(rawData);

        console.log('Iniciando migração...');
        const results = await MigrationService.migrateData(data);

        console.log('Resultados:');
        console.log(JSON.stringify(results, null, 2));

        console.log('Migração concluída com sucesso.');
    } catch (error) {
        console.error('Erro na migração:', error);
    } finally {
        await mongoose.disconnect();
        process.exit();
    }
};

runMigration();
