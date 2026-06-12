const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../.env') });

const checkUser = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.MONGODB_DB_NAME });
        console.log('✅ Conectado ao MongoDB');

        const Turma = mongoose.model('Turma', new mongoose.Schema({}, { strict: false }), 'turmas');

        const turmas = await Turma.find({}).lean();
        console.log('--- REGISTROS NA COLLECTION TURMAS ---');
        turmas.forEach(t => {
            console.log({
                _id: t._id,
                id: t.id,
                nome: t.nome,
                periodo: t.periodo,
                professor: t.professor
            });
        });

        await mongoose.disconnect();
    } catch (e) {
        console.error(e);
    }
};

checkUser();
