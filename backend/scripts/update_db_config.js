require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Config = require('../src/models/Config');

async function updateConfig() {
    try {
        console.log('🔌 Conectando ao MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Conectado!');

        // Carrega o config.json local
        const configPath = path.resolve(__dirname, '../../data/config.json');
        const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));

        console.log('📂 Lendo configurações do JSON...');

        // Tenta encontrar a config001
        let config = await Config.findById('config001');

        if (!config) {
            config = new Config({ _id: 'config001', ...configData });
            await config.save();
            console.log('✅ Nova configuração criada com sucesso!');
        } else {
            // Atualiza campos
            Object.assign(config, configData);
            await config.save();
            console.log('✅ Configuração existente atualizada com sucesso!');
        }

        console.log('📊 Resumo dos Níveis de Alfabetização no DB:');
        if (config.alfabetizacaoNiveis) {
            config.alfabetizacaoNiveis.forEach(n => console.log(`  - ${n.nome} (${n.cor})`));
        }

    } catch (e) {
        console.error('❌ Erro na atualização:', e);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Desconectado.');
    }
}

updateConfig();
