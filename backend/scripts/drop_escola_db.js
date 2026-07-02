const { MongoClient } = require('mongodb');

const URI = 'mongodb+srv://nandev:iQcJX5e1iObrExqg@sistemaescolar.s98lpdu.mongodb.net/test?appName=SistemaEscolar';

async function main() {
    console.log('🔌 Conectando ao MongoDB Atlas para remoção da base escola_db...');
    const client = new MongoClient(URI);
    try {
        await client.connect();
        console.log('✅ Conectado ao cluster.');

        // Selecionar o banco escola_db
        const dbEscola = client.db('escola_db');
        
        console.log('🗑️ Excluindo banco de dados "escola_db"...');
        const dropResult = await dbEscola.dropDatabase();
        console.log('✔️ Resultado da exclusão:', dropResult);

        // Listar bancos de dados para verificar exclusão
        const adminDb = client.db('test').admin();
        const dbs = await adminDb.listDatabases();
        const dbNames = dbs.databases.map(d => d.name);
        
        console.log('\nBancos de dados ativos no cluster:');
        console.log(dbNames);
        
        if (!dbNames.includes('escola_db')) {
            console.log('\n🎉 SUCESSO: O banco "escola_db" foi removido completamente do cluster!');
        } else {
            console.warn('\n⚠️ ATENÇÃO: O banco "escola_db" ainda consta na listagem.');
        }

    } catch (err) {
        console.error('❌ Erro ao deletar o banco de dados:', err);
    } finally {
        await client.close();
        console.log('🔌 Conexão encerrada.');
    }
}

main();
