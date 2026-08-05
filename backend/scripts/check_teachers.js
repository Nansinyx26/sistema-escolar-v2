require('dotenv').config();
const mongoose = require('mongoose');

async function checkTeachers() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado\n');

    const teachers = await mongoose.connection.db.collection('teachers').find().toArray();
    console.log('📦 Professores cadastrados:', teachers.length);

    teachers.forEach(t => {
        console.log('\n---');
        console.log('Nome:', t.nome);
        console.log('Email:', t.email || 'N/A');
        console.log('Sala Principal:', t.salaPrincipal);
        console.log('Salas Adicionais:', t.salasAdicionais);
        console.log('Tipo Especial:', t.tipoEspecial);
        console.log('Foto:', t.foto ? 'SIM (base64)' : 'NÍO');
    });

    await mongoose.disconnect();
}

checkTeachers();
