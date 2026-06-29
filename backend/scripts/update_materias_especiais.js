require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Config = require('../src/models/Config');

async function updateDatabase() {
    try {
        if (!process.env.MONGODB_URI) {
            console.error('❌ MONGODB_URI não encontrada no arquivo .env');
            return;
        }

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('🔌 Conectado ao MongoDB...');

        // Busca o documento de configuração único
        let config = await Config.findOne() || await Config.findById('config001');

        if (!config) {
            console.error('❌ Documento de configuração não encontrado no banco de dados.');
            return;
        }

        const novasMaterias = [
            { id: "sebrae", nome: "SEBRAE", icone: "💡", cor: "#facc15" },
            { id: "leitura", nome: "Oficina de Leitura", icone: "📖", cor: "#38bdf8" }
        ];

        let mudou = false;
        if (!config.materias) config.materias = [];

        novasMaterias.forEach(nova => {
            const existe = config.materias.find(m => m.id === nova.id || m.nome === nova.nome);
            if (!existe) {
                config.materias.push(nova);
                console.log(`✅ Adicionando matéria ao registro: ${nova.nome}`);
                mudou = true;
            }
        });

        if (mudou) {
            config.updatedAt = new Date();
            await config.save();
            console.log('🚀 Configurações do servidor atualizadas com sucesso!');
        } else {
            console.log('ℹ️ O banco de dados já está atualizado com as novas matérias.');
        }

    } catch (e) {
        console.error('💥 Erro ao atualizar banco de dados:', e.message);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Desconectado do MongoDB.');
    }
}

updateDatabase();
