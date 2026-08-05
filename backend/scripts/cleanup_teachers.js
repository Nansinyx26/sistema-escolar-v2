require('dotenv').config();
const mongoose = require('mongoose');

async function cleanupTeachers() {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Conectado\n');

    const collection = mongoose.connection.db.collection('teachers');

    // Remove todos exceto o primeiro
    const all = await collection.find().toArray();
    console.log('Antes:', all.length, 'professores');

    // Mantém apenas o primeiro de cada email único
    const seen = new Set();
    const toDelete = [];

    for (const t of all) {
        const key = t.email || t.nome + '_' + t.salaPrincipal;
        if (seen.has(key)) {
            toDelete.push(t._id);
        } else {
            seen.add(key);
        }
    }

    if (toDelete.length > 0) {
        await collection.deleteMany({ _id: { $in: toDelete } });
        console.log('Removidos:', toDelete.length, 'duplicados');
    }

    const remaining = await collection.find().toArray();
    console.log('Depois:', remaining.length, 'professores');
    remaining.forEach(t => console.log(' -', t.nome, '|', t.salaPrincipal));

    await mongoose.disconnect();
}

cleanupTeachers();
