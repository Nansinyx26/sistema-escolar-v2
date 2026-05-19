const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function reset() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGODB_URI not found in env');
        return;
    }
    
    try {
        await mongoose.connect(uri);
        const db = mongoose.connection.db;
        
        const email = 'pai_novo@teste.com';
        const rawPassword = '12345678';
        const hash = await bcrypt.hash(rawPassword, 12);
        
        const result = await db.collection('usuarios').updateOne(
            { email: email },
            { $set: { senha: hash } }
        );
        
        if (result.matchedCount > 0) {
            console.log(`✅ Senha do usuário ${email} redefinida com sucesso para: ${rawPassword}`);
        } else {
            console.log(`⚠️ Usuário ${email} não encontrado.`);
        }

    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.connection.close();
    }
}
reset();
