/**
 * Seed script: cria uma secretaria de teste no banco de dados
 * Uso: node seed-secretaria.js
 */
require('dotenv').config(); // carrega variáveis do .env (uso local); no Render, as env vars já vêm do painel
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('❌ MONGO_URI não definida. Configure a variável de ambiente antes de rodar o seed.');
    process.exit(1);
}

async function seed() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ Conectado ao MongoDB');

        const db = mongoose.connection.db;

        // 1. Check if secretaria user already exists
        const existingUser = await db.collection('usuarios').findOne({ email: 'secretaria@escola.com' });
        if (existingUser) {
            console.log('ℹ️  Usuário secretaria@escola.com já existe (ID:', existingUser._id, ')');
        } else {
            // Create secretaria user
            const bcrypt = require('bcryptjs');
            const salt = await bcrypt.genSalt(10);
            // Senha via env ou gerada aleatoriamente (exibida uma única vez) —
            // nunca hardcoded, para não vazar em repositório público
            const senhaSeed = process.env.SEED_SECRETARIA_SENHA
                || ('Sec@' + require('crypto').randomBytes(6).toString('hex'));
            if (!process.env.SEED_SECRETARIA_SENHA) {
                console.log('🔑 Senha gerada para secretaria@escola.com (anote, não será exibida de novo):', senhaSeed);
            }
            const senhaHash = await bcrypt.hash(senhaSeed, salt);

            const userId = new mongoose.Types.ObjectId().toString();
            await db.collection('usuarios').insertOne({
                _id: userId,
                nome: 'Maria Secretaria',
                email: 'secretaria@escola.com',
                senha: senhaHash,
                perfil: 'secretaria',
                telefone: '(11) 99999-0001',
                escola: 'EMEF Jaguari',
                ativo: true,
                primeiroAcesso: false,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            console.log('✅ Usuário secretaria criado (ID:', userId, ')');
            console.log('   Email: secretaria@escola.com');
            console.log('   Senha: SENHA_DE_TESTE_REMOVIDA');

            // 2. Create Secretaria profile document
            const secId = new mongoose.Types.ObjectId().toString();
            await db.collection('secretarias').insertOne({
                _id: secId,
                usuarioId: userId,
                nome: 'Maria Secretaria',
                email: 'secretaria@escola.com',
                telefone: '(11) 99999-0001',
                escola: 'EMEF Jaguari',
                setor: 'Secretaria Geral',
                cargo: 'Secretária Escolar',
                dataAdmissao: new Date(),
                permissoes: [
                    'gerenciar_matriculas',
                    'emitir_documentos',
                    'gerenciar_comunicados',
                    'visualizar_frequencia',
                    'gerenciar_justificativas',
                    'gerenciar_calendario',
                    'gerar_relatorios',
                    'cadastrar_responsaveis'
                ],
                ativo: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            console.log('✅ Perfil de secretaria criado na collection "secretarias"');
        }

        // 3. Ensure indexes exist on new collections
        const collections = await db.listCollections().toArray();
        const colNames = collections.map(c => c.name);

        if (!colNames.includes('documentos_emitidos')) {
            await db.createCollection('documentos_emitidos');
            console.log('✅ Collection "documentos_emitidos" criada');
        }
        if (!colNames.includes('justificativas_faltas')) {
            await db.createCollection('justificativas_faltas');
            console.log('✅ Collection "justificativas_faltas" criada');
        }
        if (!colNames.includes('calendario_escolar')) {
            await db.createCollection('calendario_escolar');
            console.log('✅ Collection "calendario_escolar" criada');
        }

        console.log('\n🎉 Seed finalizado com sucesso!');
        console.log('   Login: secretaria@escola.com / SENHA_DE_TESTE_REMOVIDA');
    } catch (err) {
        console.error('❌ Erro:', err.message);
    } finally {
        await mongoose.disconnect();
        process.exit(0);
    }
}

seed();