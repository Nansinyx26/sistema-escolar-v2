require('dotenv').config();
const mongoose = require('mongoose');

async function removeStudent() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado\n');

    // Remove alunos com nome "ugo teste"
    const result = await mongoose.connection.db.collection('students').deleteMany({
        nome: { $regex: /ugo teste/i }
    });

    console.log('Removidos:', result.deletedCount, 'alunos');

    // Lista restantes
    const remaining = await mongoose.connection.db.collection('students').find().toArray();
    console.log('\nAlunos restantes:', remaining.length);
    remaining.forEach(a => console.log(' -', a.nome, '| turma:', a.turma || a.turmaId));

    await mongoose.disconnect();
}

removeStudent();
