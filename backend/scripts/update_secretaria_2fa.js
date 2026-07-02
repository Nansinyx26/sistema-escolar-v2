/**
 * Script para atualizar campos 2FA do usuário secretaria@escola.com
 * Uso: node scripts/update_secretaria_2fa.js
 * Requer: MONGODB_URI e MONGODB_DB_NAME no .env
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB_NAME || 'test';

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI não definida no .env');
    process.exit(1);
}

async function run() {
    try {
        await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
        console.log('✅ Conectado ao MongoDB Atlas');

        const db = mongoose.connection.db;

        // Tentar em diferentes collections onde o usuário pode estar
        const collections = ['usuarios', 'users', 'secretarias'];
        let found = false;

        for (const colName of collections) {
            const col = db.collection(colName);
            const user = await col.findOne({ email: 'secretaria@escola.com' });

            if (user) {
                console.log(`📍 Encontrado em collection: "${colName}"`);
                console.log('   Dados atuais:', JSON.stringify({
                    email: user.email,
                    emailVerificado: user.emailVerificado,
                    twoFactorEnabled: user.twoFactorEnabled,
                    twoFactorFixedCode: user.twoFactorFixedCode,
                    twoFactorPendingExpiry: user.twoFactorPendingExpiry,
                    twoFactorPendingToken: user.twoFactorPendingToken
                }, null, 2));

                const result = await col.updateOne(
                    { email: 'secretaria@escola.com' },
                    {
                        $set: {
                            emailVerificado: true,
                            twoFactorEnabled: true,
                            twoFactorFixedCode: "440044",
                            twoFactorPendingExpiry: null,
                            twoFactorPendingToken: null
                        }
                    }
                );

                console.log(`\n✅ Atualizado! matchedCount: ${result.matchedCount}, modifiedCount: ${result.modifiedCount}`);

                // Verificar
                const updated = await col.findOne({ email: 'secretaria@escola.com' });
                console.log('\n📋 Dados após atualização:', JSON.stringify({
                    email: updated.email,
                    emailVerificado: updated.emailVerificado,
                    twoFactorEnabled: updated.twoFactorEnabled,
                    twoFactorFixedCode: updated.twoFactorFixedCode,
                    twoFactorPendingExpiry: updated.twoFactorPendingExpiry,
                    twoFactorPendingToken: updated.twoFactorPendingToken
                }, null, 2));

                found = true;
                break;
            }
        }

        if (!found) {
            // Listar todas as collections e procurar em todas
            const allCols = await db.listCollections().toArray();
            console.log('🔍 Procurando em todas as collections...');
            for (const c of allCols) {
                const col = db.collection(c.name);
                const user = await col.findOne({ email: 'secretaria@escola.com' });
                if (user) {
                    console.log(`📍 Encontrado em: "${c.name}"`);
                    
                    const result = await col.updateOne(
                        { email: 'secretaria@escola.com' },
                        {
                            $set: {
                                emailVerificado: true,
                                twoFactorEnabled: true,
                                twoFactorFixedCode: "440044",
                                twoFactorPendingExpiry: null,
                                twoFactorPendingToken: null
                            }
                        }
                    );
                    console.log(`✅ Atualizado! modifiedCount: ${result.modifiedCount}`);
                    found = true;
                    break;
                }
            }
        }

        if (!found) {
            console.error('❌ Usuário secretaria@escola.com não encontrado em nenhuma collection.');
        }

    } catch (err) {
        console.error('❌ Erro:', err.message);
    } finally {
        await mongoose.disconnect();
        console.log('\n🔌 Desconectado.');
    }
}

run();
