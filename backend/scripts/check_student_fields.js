require('dotenv').config();
const mongoose = require('mongoose');

async function checkStudentFields() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado\n');

    const students = await mongoose.connection.db.collection('students').find().toArray();

    console.log('📚 ALUNOS NO BANCO:\n');
    students.forEach(s => {
        console.log('---');
        console.log('Nome:', s.nome);
        console.log('Turma:', s.turma || s.turmaId);
        console.log('Matrícula:', s.matricula || 'NÍO TEM');
        console.log('Nível:', s.nivel || 'NÍO TEM');
        console.log('NívelBimestre:', s.nivelBimestre ? JSON.stringify(s.nivelBimestre) : 'NÍO TEM');
        console.log('Condição:', s.condicao || s.deficiencia || 'NÍO TEM');
        console.log('RecuperaçãoBimestre:', s.recuperacaoBimestre ? JSON.stringify(s.recuperacaoBimestre) : 'NÍO TEM');
        console.log('Foto:', s.foto ? 'SIM' : 'NÍO');
        console.log('');
    });

    await mongoose.disconnect();
}

checkStudentFields();
