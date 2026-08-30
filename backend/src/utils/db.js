const mongoose = require('mongoose');
const logger = require('./logger');

const connectDB = async () => {
    try {
        let uri = process.env.MONGODB_URI;
        const dbName = process.env.MONGODB_DB_NAME || undefined;

        if (!uri) {
            if (process.env.NODE_ENV !== 'production') {
                logger.warn(
                    'MONGODB_URI não definida — iniciando MongoDB em memória para desenvolvimento'
                );
                const { MongoMemoryServer } = require('mongodb-memory-server');
                const mongod = await MongoMemoryServer.create();
                uri = mongod.getUri();
                process.env.MONGODB_URI = uri;
                global.__MONGOD__ = mongod;
            } else {
                throw new Error('MONGODB_URI não definida nas variáveis de ambiente.');
            }
        }

        // Log para conferência (seguro — credenciais mascaradas)
        const maskedUri = uri.replace(/:([^@]+)@/, ':****@');
        logger.info('🔌 Conectando ao banco de dados', { dbName, uri: maskedUri });

        try {
            const connectionOptions = {
                serverSelectionTimeoutMS: 5000, // Limite de 5 segundos para falha
            };

            if (dbName) {
                connectionOptions.dbName = dbName;
            }

            await mongoose.connect(uri, connectionOptions);
            logger.info('✅ MongoDB conectado com sucesso', { dbName });
            // Auto-criação de todas as coleções esperadas no startup
            await _ensureCollectionsExist();
        } catch (err) {
            if (process.env.NODE_ENV === 'development' && !global.__MONGOD__) {
                logger.warn('Falha ao conectar ao MongoDB local — iniciando MongoDB em memória', {
                    error: err.message,
                });
                const { MongoMemoryServer } = require('mongodb-memory-server');
                const mongod = await MongoMemoryServer.create();
                const memoryUri = mongod.getUri();
                await mongoose.connect(memoryUri);
                logger.info('✅ MongoDB conectado com sucesso (em memória)');
                await _seedDevData();
            } else {
                throw err;
            }
        }

        // Se estiver explicitamente em dev e conectado com sucesso, tenta seed
        if (process.env.NODE_ENV === 'development') {
            await _seedDevData();
        }

        // Listeners de eventos do Mongoose para observabilidade contínua
        mongoose.connection.on('disconnected', () => {
            logger.alert('DB_DISCONNECTED', 'Conexão com o MongoDB foi perdida', { dbName });
        });

        mongoose.connection.on('reconnected', () => {
            logger.info('✅ MongoDB reconectado automaticamente', { dbName });
        });

        mongoose.connection.on('error', (err) => {
            logger.alert('DB_ERROR', `Erro na conexão MongoDB: ${err.message}`, {
                dbName,
                error: err.message,
            });
        });
    } catch (error) {
        // LOGA E RELANÇA (Issue #126).
        //
        // Antes, este catch engolia o erro e agendava `process.exit(1)` em 1s.
        // Como a função é `async` e não relançava, `await connectDB()` RESOLVIA
        // COM SUCESSO mesmo com o banco fora — o `try/catch` de `startServer` não
        // era acionado, e o boot seguia para o cache, os códigos secretos e as
        // migrações contra uma conexão que não existe. O invariante que o
        // `index.js` declara ("iniciar o servidor somente se o banco estiver OK")
        // não era garantido pelo fluxo de controle.
        //
        // Na prática o processo morria mesmo, porque o `setTimeout` de 1s vencia a
        // corrida com os passos seguintes (que travam nos 5s do
        // `serverSelectionTimeoutMS`). Ou seja: o comportamento certo era resultado
        // de uma coincidência de tempos. Qualquer passo novo entre a conexão e o
        // `listen` que respondesse em menos de 1s passaria a rodar num estado que o
        // código afirma ser impossível.
        //
        // O atraso de 1s que existia aqui por causa do log no Render não se perde:
        // ele mudou de lugar, para o `catch` de `startServer` em index.js — o
        // ponto que é dono da decisão de encerrar.
        logger.alert('DB_FATAL', `Erro fatal de conexão: ${error.message}`, {
            error: error.message,
            stack: error.stack,
        });
        throw error;
    }
};

/**
 * Seed data for development
 */
async function _seedDevData() {
    const User = require('../models/Usuario');
    const Turma = require('../models/Turma');
    const Aluno = require('../models/Aluno');
    const Nota = require('../models/Nota');
    const Avaliacao = require('../models/AvaliacaoSistema');
    const Comunicado = require('../models/Comunicado');

    const profCount = await User.countDocuments({ perfil: 'professor' });
    if (profCount === 0) {
        logger.info('🌱 [SEED] Criando Professor...');
        const bcrypt = require('bcryptjs');
        const hash = await bcrypt.hash('123456', 10);
        await User.create({
            nome: 'Professor Teste',
            email: 'professor@teste.com',
            senha: hash,
            perfil: 'professor',
            telefone: '11999999999',
            ativo: true,
            emailVerificado: true,
            id: 'PROF_TESTE',
        });
        logger.info('✅ [SEED] Professor OK');
    }

    const turmaCount = await Turma.countDocuments();
    if (turmaCount === 0) {
        logger.info('🌱 [SEED] Gerando dados pedagógicos de teste...');

        const turmasCreated = await Turma.create([
            { id: '1A', nome: '1º Ano A', ano: 1, periodo: 'Manhã' },
            { id: '2A', nome: '2º Ano A', ano: 2, periodo: 'Manhã' },
            { id: '3A', nome: '3º Ano A', ano: 3, periodo: 'Manhã' },
            { id: '4B', nome: '4º Ano B', ano: 4, periodo: 'Manhã' },
            { id: '5B', nome: '5º Ano B', ano: 5, periodo: 'Manhã' },
        ]);

        const alunosData = [
            { id: 'ALU001', nome: 'Ana Silva', turma: '1A', status: 'Ativo' },
            { id: 'ALU002', nome: 'Bruno Costa', turma: '2A', status: 'Ativo' },
            { id: 'ALU003', nome: 'Carla Oliveira', turma: '3A', status: 'Ativo' },
            { id: 'ALU004', nome: 'Diego Souza', turma: '5B', status: 'Risco' },
        ];
        await Aluno.create(alunosData);

        const materias = ['Matemática', 'Português', 'História', 'Ciências'];
        const notasData = [];

        // Gerar notas aleatórias para as turmas e matérias
        turmasCreated.forEach((t) => {
            materias.forEach((m) => {
                const mediaBase = 6 + Math.random() * 3; // Média entre 6 e 9
                notasData.push({
                    alunoId: 'ALU_SEED', // Fallback
                    turmaId: t.id,
                    materiaId: m,
                    nota: parseFloat(mediaBase.toFixed(1)),
                    bimestre: 1,
                    tipo: 'Média',
                    data: new Date(),
                });
            });
        });

        await Nota.create(notasData);
        logger.info('✅ [SEED] Turmas, Alunos e Notas criados com sucesso.');
    }
}

/**
 * Garante que todas as coleções esperadas pelos modelos Mongoose sejam criadas no boot
 */
async function _ensureCollectionsExist() {
    const fs = require('fs');
    const path = require('path');

    logger.info('🔧 Verificando/Criando coleções do sistema no banco...');

    // 1. Carregar todos os arquivos de models para garantir registro
    const modelsDir = path.join(__dirname, '../models');
    if (fs.existsSync(modelsDir)) {
        fs.readdirSync(modelsDir).forEach((file) => {
            if (file.endsWith('.js')) {
                try {
                    require(path.join(modelsDir, file));
                } catch (e) {
                    // Falha aqui NÃO pode ser silenciosa: o model some do registro do
                    // Mongoose e o sintoma aparece muito depois, como "Schema hasn't
                    // been registered" numa rota sem relação com o erro real.
                    logger.error(`Falha ao carregar model ${file} — coleção não será registrada`, {
                        err: e,
                        model: file,
                        action: 'db.carregarModels',
                    });
                }
            }
        });
    }

    // 2. Chamar createCollection() para cada modelo para forçar a criação com índices no banco
    const models = Object.values(mongoose.models);
    let createdCount = 0;
    for (const model of models) {
        try {
            await model.createCollection();
            createdCount++;
        } catch (err) {
            logger.warn(`⚠️ Não foi possível criar coleção para o modelo ${model.modelName}:`, {
                error: err.message,
            });
        }
    }
    logger.info(`✅ Verificação concluída. ${createdCount} coleções garantidas no banco.`);
}

module.exports = connectDB;
