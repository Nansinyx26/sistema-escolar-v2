require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;

    // Nova senha conhecida
    const novaSenha = 'Admin@2025';
    const hash = await bcrypt.hash(novaSenha, 12);

    const result = await db.collection('usuarios').updateOne(
        { email: 'admin@escola.com' },
        { $set: { senha: hash, loginAttempts: 0, ativo: true, lockUntil: null } }
    );

    console.log('Atualizado:', result.modifiedCount, 'documento(s)');
    const ok = await bcrypt.compare(novaSenha, hash);
    console.log(`Nova senha "${novaSenha}" funciona?`, ok);

    // Também desbloqueia a conta da Gisleide se necessário
    const gisleide = await db.collection('usuarios').updateOne(
        { email: 'gisleide.nobrega@prof.educamericana.sp.gov.br' },
        { $set: { loginAttempts: 0, lockUntil: null } }
    );
    console.log('Gisleide desbloqueada:', gisleide.modifiedCount, 'doc(s)');

    await mongoose.disconnect();
    console.log('\nFIM. Agora tente login com admin@escola.com / Admin@2025');
}

run().catch(e => { console.error(e); process.exit(1); });
