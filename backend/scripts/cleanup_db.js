const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Carrega env
dotenv.config({ path: path.join(__dirname, '../.env') });

const cleanup = async () => {
    try {
        const uri = (process.env.MONGODB_URI || '').trim().replace(/^"|"$/g, '');
        const dbName = (process.env.MONGODB_DB_NAME || 'test').trim().replace(/^"|"$/g, '');
        
        if (!uri) throw new Error('MONGODB_URI não encontrada');

        await mongoose.connect(uri, { dbName });
        const db = mongoose.connection.db;

        console.log('🧹 Iniciando limpeza do banco de dados...');

        // 1. Remover coleções de segurança/LGPD
        const collections = await db.listCollections().toArray();
        const toDrop = ['auditlogs', 'solicitacaoprivacidades'];
        
        for (const collName of toDrop) {
            if (collections.find(c => c.name === collName)) {
                await db.dropCollection(collName);
                console.log(`✅ Coleção deletada: ${collName}`);
            }
        }

        // 2. Limpar campos de consentimento em 'alunos'
        const alunosResult = await db.collection('alunos').updateMany(
            {},
            { 
                $unset: { 
                    consentimentoResponsavel: "", 
                    consentimentoPCD: "" 
                } 
            }
        );
        console.log(`✅ Campos LGPD removidos de ${alunosResult.modifiedCount} alunos.`);

        // 3. Resetar usuários (Opcional, mas recomendado pois as senhas atuais são bcrypt)
        // Se o usuário quiser manter os usuários, eles terão que resetar a senha manualmente.
        // Vou apenas limpar os campos resetCode/resetExpires se existirem.
        const usersResult = await db.collection('usuarios').updateMany(
            {},
            {
                $unset: {
                    resetCode: "",
                    resetExpires: "",
                    lastLogin: ""
                }
            }
        );
        console.log(`✅ Campos de segurança removidos de ${usersResult.modifiedCount} usuários.`);

        console.log('✨ Limpeza concluída com sucesso!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Erro na limpeza:', error.message);
        process.exit(1);
    }
};

cleanup();
