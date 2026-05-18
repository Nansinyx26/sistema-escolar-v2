/**
 * Script de Migração para MongoDB Atlas com Conversão WebP
 * 
 * USO:
 * 1. Coloque o arquivo exportado em ./data/escola_database.json (na raiz do backend)
 * 2. npm install sharp mongodb dotenv
 * 3. node scripts/migrate-with-webp.js
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config();

// Configuração
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'escola_db';
const JSON_FILE = './data/escola_database.json';

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI não definida no arquivo .env');
    process.exit(1);
}

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
            this.db = this.client.db(DB_NAME); // Usa o DB da URI ou força o nome
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
            const filePath = path.resolve(__dirname, '..', JSON_FILE);
            if (!fs.existsSync(filePath)) {
                console.error(`❌ Arquivo não encontrado: ${filePath}`);
                return null;
            }
            // Aumenta limite de buffer se necessário, mas readFileSync carrega tudo na RAM
            const data = fs.readFileSync(filePath, 'utf8');
            const json = JSON.parse(data);
            console.log('✅ JSON carregado com sucesso!');
            return json;
        } catch (error) {
            console.error('❌ Erro ao carregar JSON:', error.message);
            return null;
        }
    }

    /**
     * Converte string Base64 (JPEG/PNG) para WebP Base64
     */
    async convertToWebP(base64String, context = '') {
        try {
            if (!base64String || typeof base64String !== 'string') return null;

            // Se já for WebP, retorna como está (ou reprocessa se quiser garantir qualidade)
            if (base64String.startsWith('data:image/webp')) return base64String;

            // Remove prefixo data URI
            let buffer;
            if (base64String.includes('base64,')) {
                buffer = Buffer.from(base64String.split('base64,')[1], 'base64');
            } else {
                buffer = Buffer.from(base64String, 'base64'); // Tenta direto
            }

            // Converte com sharp
            const webpBuffer = await sharp(buffer)
                .webp({ quality: 80 })
                .toBuffer();

            return `data:image/webp;base64,${webpBuffer.toString('base64')}`;
        } catch (error) {
            console.warn(`  ⚠️ Falha ao converter imagem (${context}): ${error.message}`);
            return base64String; // Retorna original em caso de falha
        }
    }

    async processarDados(collectionName, docs) {
        const processedDocs = [];
        console.log(`  Processando ${docs.length} documentos de '${collectionName}'...`);

        for (const doc of docs) {
            // Clona documento
            const newDoc = { ...doc };

            // Remove _id se for string numérica legada ou deixa pro Mongo gerar novos se quiser
            // Mas para manter relações, idealmente mantemos o _id se for string única gerada pelo frontend (UUID/ObjectId-like)
            // Se for numero (1, 2, 3), melhor deixar o mongo gerar _id e usar 'id' para referência legada.

            // Converter Foto se existir
            if (newDoc.foto) {
                const idRef = newDoc.nome || newDoc.id || newDoc._id;
                newDoc.foto = await this.convertToWebP(newDoc.foto, `${collectionName} - ${idRef}`);
            }

            processedDocs.push(newDoc);
        }
        return processedDocs;
    }

    async importarCollection(nome, dados) {
        if (!dados || dados.length === 0) return;

        try {
            const dadosProcessados = await this.processarDados(nome, dados);

            if (dadosProcessados.length > 0) {
                // Opção: Limpar antes de inserir?
                // await this.db.collection(nome).deleteMany({});

                // Usar bulkWrite ou insertMany
                // InsertMany pode falhar com duplicatas se não limpar antes.
                // Vamos usar insertMany com ordered: false para tentar inserir todos que não conflitem
                try {
                    const result = await this.db.collection(nome).insertMany(dadosProcessados, { ordered: false });
                    console.log(`  ✓ ${nome}: ${result.insertedCount} inseridos.`);
                } catch (e) {
                    console.log(`  ℹ️ ${nome}: ${e.message} (provavelmente duplicatas ignoradas)`);
                }
            }
        } catch (error) {
            console.error(`  ❌ ${nome}: ${error.message}`);
        }
    }

    async migrar() {
        console.log('\n📦 INICIANDO MIGRAÇÍO COM CONVERSÍO WEBP');
        console.log('='.repeat(50));

        const conectado = await this.conectar();
        if (!conectado) return;

        const data = await this.carregarJSON();
        if (!data) {
            await this.client.close();
            return;
        }

        const collections = Object.keys(data).filter(k => k !== 'config'); // Config tratado separado se quiser

        for (const collectionName of collections) {
            await this.importarCollection(collectionName, data[collectionName]);
        }

        // Importar config se houver
        if (data.config) {
            // Config costuma ser objeto único ou array
            const configData = Array.isArray(data.config) ? data.config : [data.config];
            await this.importarCollection('config', configData);
        }

        console.log('\n✅ Migração concluída!');
        await this.client.close();
    }
}

// Executar
const migration = new MongoDBMigration();
migration.migrar();
