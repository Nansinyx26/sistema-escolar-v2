require('dotenv').config();
const mongoose = require('mongoose');

async function fixTeacher() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado\n');

    // Atualiza o professor do teste@escola.com para sala 1D
    const result = await mongoose.connection.db.collection('teachers').updateOne(
        { idUsuario: '693c21edcb713ba736d9f074' },
        {
            $set: {
                salaPrincipal: '1D',
                email: 'teste@escola.com'
            }
        }
    );

    console.log('Atualizado:', result.modifiedCount, 'documento(s)');

    // Verifica os dados
    const teachers = await mongoose.connection.db.collection('teachers').find().toArray();
    console.log('\nProfessores após atualização:');
    teachers.forEach(t => console.log(' -', t.nome, '| Email:', t.email, '| Sala:', t.salaPrincipal));

    await mongoose.disconnect();
}

fixTeacher();
