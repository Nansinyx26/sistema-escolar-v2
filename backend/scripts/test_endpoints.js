const http = require('http');

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}/api`;

const testEndpoints = async () => {
    console.log(`Testando API em ${BASE_URL}...`);

    const endpoints = [
        { path: '/alunos', method: 'GET' },
        { path: '/professores', method: 'GET' },
        { path: '/turmas', method: 'GET' },
        { path: '/diretores', method: 'GET' },
        { path: '/filtros-inexistentes', method: 'GET', expect: 404 } // teste
    ];

    for (const ep of endpoints) {
        try {
            const url = `${BASE_URL}${ep.path}`;
            console.log(`REQ: ${ep.method} ${url}`);

            const res = await fetch(url, { method: ep.method });
            const status = res.status;

            if (ep.expect && status !== ep.expect) {
                console.error(`❌ Falha em ${ep.path}: Esperado ${ep.expect}, Recebido ${status}`);
                continue;
            }

            if (!ep.expect && !res.ok) {
                console.error(`❌ Falha em ${ep.path}: Status ${status}`);
                const txt = await res.text();
                // console.error('Response:', txt);
                continue;
            }

            console.log(`✅ Sucesso em ${ep.path} [${status}]`);
            // Se for GET list, verificar se body é json válido
            if (ep.method === 'GET' && res.ok) {
                const json = await res.json();
                if (json.success) console.log(`   -> Dados recebidos: ${Array.isArray(json.data) ? json.data.length + ' itens' : 'Objeto'}`);
            }

        } catch (error) {
            console.error(`❌ Erro de conexão em ${ep.path}:`, error.message);
        }
    }

    console.log('Testes finalizados.');
};

// Verifica se fetch existe (Node 18+)
if (!global.fetch) {
    console.error('Este script requer Node.js 18+ com suporte nativo a fetch.');
    process.exit(1);
}

testEndpoints();
