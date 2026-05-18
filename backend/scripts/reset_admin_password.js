require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Usuario = require('../src/models/Usuario');

async function resetAdmin() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('🔌 Conectado ao MongoDB');

        const email = 'admin@escola.com';
        const novaSenha = 'admin@123456';

        let admin = await Usuario.findOne({ email });

        if (admin) {
            await Usuario.updateOne({ email }, { $set: { senha: novaSenha } });
            console.log('✅ Senha do admin atualizada para:', novaSenha);
        } else {
            console.log('⚠️ Admin não encontrado. Criando...');
            admin = await Usuario.create({
                email,
                senha: novaSenha,
                nome: 'Administrador',
                perfil: 'admin',
                ativo: true
            });
            console.log('✅ Admin criado com a senha:', novaSenha);
        }

    } catch (error) {
        console.error('❌ Erro:', error);
    } finally {
        await mongoose.disconnect();
    }
}

resetAdmin();
