require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Class = require('../src/models/Class');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('Erro: MONGODB_URI não definida no .env');
    process.exit(1);
}

const run = async () => {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Conectado ao MongoDB.');

        const anos = [1, 2, 3, 4, 5];
        const salas = ['C', 'D'];

        let count = 0;

        for (const ano of anos) {
            for (const sala of salas) {
                const id = `${ano}${sala}`; // Ex: 1C

                // Verifica se existe por id ou _id
                const exists = await Class.findOne({ $or: [{ _id: id }, { id: id }, { nome: id }] });

                if (!exists) {
                    await Class.create({
                        _id: id,
                        id: id,
                        nome: id,
                        ano: ano,
                        sala: sala,
                        periodo: 'Tarde', // Assumindo tarde para extras
                        capacidade: 30,
                        ativo: true,
                        descricao: `Turma ${ano}${sala}`
                    });
                    console.log(`➕ Turma criada: ${id}`);
                    count++;
                } else {
                    console.log(`ℹ️ Turma já existe: ${id}`);
                }
            }
        }

        console.log(`\n✅ Concluído. ${count} novas turmas criadas.`);

    } catch (error) {
        console.error('❌ Erro:', error);
    } finally {
        await mongoose.disconnect();
    }
};

run();
