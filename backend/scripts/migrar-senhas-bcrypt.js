/**
 * Migração: Hash bcrypt em senhas legadas
 * Executa UMA vez — ignora contas que já têm hash.
 *
 * Uso: node scripts/migrar-senhas-bcrypt.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'test';

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI não definida no .env');
    process.exit(1);
}

async function migrar() {
    await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
    console.log('✅ Conectado ao MongoDB:', DB_NAME);

    const col = mongoose.connection.collection('usuarios');
    const usuarios = await col.find({}).toArray();

    let total = 0, atualizados = 0, ignorados = 0, erros = 0;

    for (const u of usuarios) {
        total++;
        // Pula quem já tem hash bcrypt
        if (!u.senha || u.senha.startsWith('$2')) {
            ignorados++;
            continue;
        }

        try {
            const hash = await bcrypt.hash(u.senha, SALT_ROUNDS);
            await col.updateOne({ _id: u._id }, { $set: { senha: hash } });
            console.log(`  ✔ ${u.email || u._id} — senha migrada`);
            atualizados++;
        } catch (e) {
            console.error(`  ✖ ${u.email || u._id} — erro: ${e.message}`);
            erros++;
        }
    }

    console.log('\n──────────────────────────────');
    console.log(`Total de usuários : ${total}`);
    console.log(`Migrados          : ${atualizados}`);
    console.log(`Já com hash       : ${ignorados}`);
    console.log(`Erros             : ${erros}`);
    console.log('──────────────────────────────');

    await mongoose.disconnect();
    console.log('✅ Migração concluída. Conexão encerrada.');
}

migrar().catch(err => {
    console.error('❌ Falha na migração:', err);
    process.exit(1);
});
