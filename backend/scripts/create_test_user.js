require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');
const Teacher = require('../src/models/Teacher');

async function createTestUser() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Conectado ao MongoDB\n');

        // Criar usuário professor
        const user = await User.create({
            email: 'renan@escola.com',
            senha: '123456', // ATENÇÍO: Em produção use hash!
            nome: 'Renan',
            perfil: 'professor',
            ativo: true,
            criadoEm: new Date()
        });
        console.log('✅ Usuário criado:', user.email);

        // Criar perfil de professor
        const teacher = await Teacher.create({
            email: 'renan@escola.com',
            nome: 'Renan',
            salaPrincipal: '1D', // ou '1º D' dependendo do formato
            salasAdicionais: [],
            materias: ['Sala Principal'],
            role: 'professor'
        });
        console.log('✅ Professor criado:', teacher.nome);
        console.log('\n📌 Use para login:');
        console.log('   Email: renan@escola.com');
        console.log('   Senha: 123456\n');

        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Erro:', error.message);
        process.exit(1);
    }
}

createTestUser();
