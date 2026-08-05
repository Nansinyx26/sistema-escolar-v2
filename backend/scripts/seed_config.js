require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Config = require('../src/models/Config');

async function seedConfig() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('🔌 Conectado ao MongoDB para seeding de Config...');

        const existing = await Config.findOne();
        if (!existing) {
            const newConfig = new Config({
                _id: 'config001',
                escolaNome: 'Escola Modelo',
                anoLetivo: 2026,
                exigirChamadaAntesDeAula: false
            });
            await newConfig.save();
            console.log('✅ Configuração inicial criada com ID config001');
        } else {
            console.log('ℹ️ Configuração já existe no banco.');
        }

    } catch (e) {
        console.error('❌ Erco no seed:', e);
    } finally {
        await mongoose.disconnect();
    }
}

seedConfig();
