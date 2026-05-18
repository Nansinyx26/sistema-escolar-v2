const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const resetUserPassword = async () => {
    try {
        const uri = (process.env.MONGODB_URI || '').trim().replace(/^"|"$/g, '');
        const dbName = (process.env.MONGODB_DB_NAME || 'test').trim().replace(/^"|"$/g, '');
        
        await mongoose.connect(uri, { dbName });
        const db = mongoose.connection.db;

        const email = "gisleide.nobrega@prof.educamericana.sp.gov.br";
        const newPassword = "Ciep1234";

        const result = await db.collection('usuarios').updateOne(
            { email: email },
            { $set: { senha: newPassword } }
        );

        if (result.modifiedCount > 0) {
            console.log(`✅ Senha restaurada para texto puro para o usuário: ${email}`);
        } else {
            console.log(`⚠️ Usuário não encontrado ou senha já era a mesma: ${email}`);
        }

        process.exit(0);
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
};

resetUserPassword();
