/**
 * Script de Migração Automática para MongoDB Atlas
 * Sistema de Cadastro Escolar v2.0
 * 
 * USO:
 * 1. npm install mongodb dotenv
 * 2. Crie arquivo .env com: MONGODB_URI=sua_connection_string
 * 3. node migrate-to-mongodb.js
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Configuração
const MONGODB_URI = process.env.MONGODB_URI || 'MONGODB_URI_REMOVIDA_USE_ENV';
const DB_NAME = 'test';
const JSON_FILE = './data/escola_database.json';

class MongoDBMigration {
    constructor() {
        this.client = null;
        this.db = null;
    }

    async conectar() {
        console.log('🔌 Conectando ao MongoDB Atlas...');
        try {
            this.client = new MongoClient(MONGODB_URI);
            await this.client.connect();
            this.db = this.client.db(DB_NAME);
            console.log('✅ Conectado com sucesso!');
            return true;
        } catch (error) {
            console.error('❌ Erro ao conectar:', error.message);
            return false;
        }
    }

    async carregarJSON() {
        console.log('\n📂 Carregando arquivo JSON...');
        try {
            const filePath = path.resolve(__dirname, JSON_FILE);
            const data = fs.readFileSync(filePath, 'utf8');
            const json = JSON.parse(data);
            console.log('✅ JSON carregado com sucesso!');
            return json;
        } catch (error) {
            console.error('❌ Erro ao carregar JSON:', error.message);
            return null;
        }
    }

    async criarIndices() {
        console.log('\n🔧 Criando índices...');

        try {
            // Índices para usuarios
            await this.db.collection('usuarios').createIndex({ email: 1 }, { unique: true });
            await this.db.collection('usuarios').createIndex({ perfil: 1 });
            console.log('  ✓ Índices de usuarios criados');

            // Índices para alunos
            await this.db.collection('alunos').createIndex({ turmaId: 1 });
            await this.db.collection('alunos').createIndex({ matricula: 1 }, { unique: true });
            await this.db.collection('alunos').createIndex({ ativo: 1 });
            console.log('  ✓ Índices de alunos criados');

            // Índices para notas
            await this.db.collection('notas').createIndex({ alunoId: 1 });
            await this.db.collection('notas').createIndex({ turmaId: 1, bimestre: 1 });
            await this.db.collection('notas').createIndex({ materiaId: 1 });
            console.log('  ✓ Índices de notas criados');

            // Índices para faltas
            await this.db.collection('faltas').createIndex({ alunoId: 1, data: -1 });
            await this.db.collection('faltas').createIndex({ turmaId: 1, data: -1 });
            console.log('  ✓ Índices de faltas criados');

            // Índices para relatorios
            await this.db.collection('relatorios').createIndex({ turmaId: 1, data: -1 });
            console.log('  ✓ Índices de relatorios criados');

            console.log('✅ Todos índices criados!');
        } catch (error) {
            console.error('❌ Erro ao criar índices:', error.message);
        }
    }

    async limparCollections(collections) {
        console.log('\n🗑️  Limpando collections existentes...');
        for (const collectionName of collections) {
            try {
                await this.db.collection(collectionName).deleteMany({});
                console.log(`  ✓ ${collectionName} limpo`);
            } catch (error) {
                console.warn(`  ⚠️  ${collectionName}: ${error.message}`);
            }
        }
    }

    async importarCollection(nome, dados) {
        if (!dados || dados.length === 0) {
            console.log(`  ⊘ ${nome}: sem dados`);
            return;
        }

        try {
            const result = await this.db.collection(nome).insertMany(dados);
            console.log(`  ✓ ${nome}: ${result.insertedCount} documentos inseridos`);
        } catch (error) {
            console.error(`  ❌ ${nome}: ${error.message}`);
        }
    }

    async importarConfig(config) {
        if (!config) {
            console.log('  ⊘ config: sem dados');
            return;
        }

        try {
            await this.db.collection('config').insertOne(config);
            console.log('  ✓ config: 1 documento inserido');
        } catch (error) {
            console.error(`  ❌ config: ${error.message}`);
        }
    }

    async migrar() {
        console.log('\n📦 INICIANDO MIGRAÇÍO PARA MONGODB ATLAS');
        console.log('='.repeat(50));

        // 1. Conectar
        const conectado = await this.conectar();
        if (!conectado) {
            console.log('\n❌ Migração cancelada');
            return;
        }

        // 2. Carregar JSON
        const data = await this.carregarJSON();
        if (!data) {
            console.log('\n❌ Migração cancelada');
            await this.desconectar();
            return;
        }

        // 3. Listar collections disponíveis
        const collections = Object.keys(data).filter(key =>
            !key.startsWith('_') && key !== 'config'
        );
        console.log('\n📋 Collections encontradas:', collections.join(', '));

        // 4. Confirmar limpeza (opcional)
        console.log('\n⚠️  ATENÇÍO: Isso irá SUBSTITUIR todos os dados existentes!');
        // Para uso interativo, adicione confirmação aqui

        await this.limparCollections(collections);

        // 5. Importar dados
        console.log('\n📥 Importando dados...');
        for (const collectionName of collections) {
            await this.importarCollection(collectionName, data[collectionName]);
        }

        // 6. Importar config (documento único)
        if (data.config) {
            await this.importarConfig(data.config);
        }

        // 7. Criar índices
        await this.criarIndices();

        // 8. Verificar
        await this.verificarImportacao(collections);

        await this.desconectar();

        console.log('\n✅ MIGRAÇÍO CONCLUÍDA COM SUCESSO!');
        console.log('='.repeat(50));
    }

    async verificarImportacao(collections) {
        console.log('\n🔍 Verificando importação...');
        let total = 0;

        for (const collectionName of collections) {
            const count = await this.db.collection(collectionName).countDocuments();
            console.log(`  ${collectionName}: ${count} documentos`);
            total += count;
        }

        // Verificar config
        const configCount = await this.db.collection('config').countDocuments();
        console.log(`  config: ${configCount} documento(s)`);

        console.log(`\n📊 Total: ${total + configCount} documentos importados`);
    }

    async desconectar() {
        if (this.client) {
            await this.client.close();
            console.log('\n🔌 Desconectado do MongoDB');
        }
    }
}

// Executar migração
if (require.main === module) {
    const migration = new MongoDBMigration();
    migration.migrar().catch(error => {
        console.error('\n💥 Erro fatal:', error);
        process.exit(1);
    });
}

module.exports = MongoDBMigration;
