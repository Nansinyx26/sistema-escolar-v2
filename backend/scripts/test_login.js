const fetch = require('node-fetch');

async function testLogin() {
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

    try {
        // Testa buscar usuários
        console.log('🔍 Testando GET /api/usuarios...');
        const res1 = await fetch('http://localhost:3001/api/usuarios');
        const users = await res1.json();
        console.log('✅ Resposta:', JSON.stringify(users, null, 2));

        // Testa buscar usuário por email
        console.log('\n🔍 Testando GET /api/usuarios?email=renan@escola.com...');
        const res2 = await fetch('http://localhost:3001/api/usuarios?email=renan@escola.com');
        const userByEmail = await res2.json();
        console.log('✅ Resposta:', JSON.stringify(userByEmail, null, 2));

    } catch (error) {
        console.error('❌ Erro:', error.message);
    }
}

testLogin();
