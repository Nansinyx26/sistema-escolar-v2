require('dotenv').config();
const mongoose = require('mongoose');

async function checkDatabase() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Conectado ao MongoDB');

        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log('\n📦 Coleções no banco:');

        for (const col of collections) {
            const count = await mongoose.connection.db.collection(col.name).countDocuments();
            console.log(`  - ${col.name}: ${count} documentos`);

            if (col.name === 'users' && count > 0) {
                const users = await mongoose.connection.db.collection('users').find().limit(5).toArray();
                console.log('    Emails:', users.map(u => u.email).join(', '));
            }
        }

        await mongoose.disconnect();
        console.log('\n✅ Verificação concluída');
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
}

checkDatabase();
