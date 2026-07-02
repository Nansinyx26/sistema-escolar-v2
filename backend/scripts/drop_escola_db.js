require('dotenv').config();
const { MongoClient } = require('mongodb');
const readline = require('readline');

const URI = process.env.MONGODB_URI;
const DB_NAME = 'test';

if (!URI) {
    console.error('❌ Variável de ambiente MONGODB_URI não encontrada. Crie um arquivo .env com MONGODB_URI=...');
    process.exit(1);
}

function confirmar(pergunta) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise((resolve) => {
        rl.question(pergunta, (resposta) => {
            rl.close();
            resolve(resposta.trim());
        });
    });
}

async function main() {
    console.log('🔌 Conectando ao MongoDB Atlas...');

    const resposta = await confirmar(
        `⚠️ Isso vai APAGAR PERMANENTEMENTE o banco "${DB_NAME}". Digite o nome do banco para confirmar: `
    );

    if (resposta !== DB_NAME) {
        console.log('🚫 Confirmação incorreta. Operação cancelada.');
        return;
    }

    const client = new MongoClient(URI);

    try {
        await client.connect();
        console.log('✅ Conectado ao cluster.');

        const dbEscola = client.db(DB_NAME);

        console.log(`🗑️ Excluindo banco de dados "${DB_NAME}"...`);
        const dropResult = await dbEscola.dropDatabase();
        console.log('✔️ Resultado da exclusão:', dropResult);

        const adminDb = client.db('test').admin();
        const dbs = await adminDb.listDatabases();
        const dbNames = dbs.databases.map(d => d.name);

        console.log('\nBancos de dados ativos no cluster:');
        console.log(dbNames);

        if (!dbNames.includes(DB_NAME)) {
            console.log(`\n🎉 SUCESSO: O banco "${DB_NAME}" foi removido completamente do cluster!`);
        } else {
            console.warn(`\n⚠️ ATENÇÃO: O banco "${DB_NAME}" ainda consta na listagem.`);
        }

    } catch (err) {
        console.error('❌ Erro ao deletar o banco de dados:', err);
    } finally {
        await client.close();
        console.log('🔌 Conexão encerrada.');
    }
}

main();
