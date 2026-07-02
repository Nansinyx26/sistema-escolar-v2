require('dotenv').config();
const mongoose = require('mongoose');

async function updateTeacher() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado\n');

    // Atualiza o professor específico
    const result = await mongoose.connection.db.collection('teachers').updateOne(
        { _id: new mongoose.Types.ObjectId('693c1d1d6f3c6c63f685f37f') },
        {
            $set: {
                nome: 'nandev',
                salaPrincipal: '1C'
            }
        }
    );

    console.log('Atualizado:', result.modifiedCount, 'documento(s)');

    // Verifica
    const teacher = await mongoose.connection.db.collection('teachers').findOne(
        { _id: new mongoose.Types.ObjectId('693c1d1d6f3c6c63f685f37f') }
    );
    console.log('\nDados atualizados:');
    console.log('  Nome:', teacher.nome);
    console.log('  Sala:', teacher.salaPrincipal);
    console.log('  Email:', teacher.email);

    await mongoose.disconnect();
}

updateTeacher();
