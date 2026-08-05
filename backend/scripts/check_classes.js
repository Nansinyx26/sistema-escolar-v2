require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Class = require('../src/models/Turma');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('Erro: MONGODB_URI não definida no .env');
    process.exit(1);
}

const checkClasses = async () => {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Conectado ao MongoDB.');

        console.log('🔍 Buscando TODAS as turmas no banco...');
        // Busca todas, sem filtro de ativo
        const classes = await Class.find({}); // Remove filter { ativo: true } to see everything

        console.log(`Total de turmas encontradas: ${classes.length}`);

        const sortedClasses = classes.sort((a, b) => (a.id || a._id).localeCompare(b.id || b._id));

        console.log('---------------------------------------------------');
        console.log('| ID       | Nome     | Ano | Sala | Ativo | _id      |');
        console.log('---------------------------------------------------');
        sortedClasses.forEach(c => {
            const idDisplay = (c.id || '').padEnd(8);
            const nomeDisplay = (c.nome || '').padEnd(8);
            const anoDisplay = (c.ano || '').toString().padEnd(3);
            const salaDisplay = (c.sala || '').padEnd(4);
            const ativoDisplay = (c.ativo ? 'Sim' : 'Não').padEnd(5);

            console.log(`| ${idDisplay} | ${nomeDisplay} | ${anoDisplay} | ${salaDisplay} | ${ativoDisplay} | ${c._id} |`);
        });
        console.log('---------------------------------------------------');

    } catch (error) {
        console.error('❌ Erro:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Desconectado.');
    }
};

checkClasses();
