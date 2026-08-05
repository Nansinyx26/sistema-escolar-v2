/**
 * migrate_voice_preferences.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Migração: adiciona campos de preferência de voz / TTS / acessibilidade
 * em todos os documentos de Usuario que ainda não os possuem.
 *
 * Campos adicionados (com defaults):
 *   voiceGender         → 'female'
 *   voiceSpeed          → 1.0
 *   ttsProvider         → 'auto'
 *   preferenciaNarracao → 'texto_audio'  (se ausente)
 *   accessibilityFontSize    → '100%'
 *   accessibilityContrast    → false
 *   accessibilityReadingMode → false
 *
 * Uso:
 *   cd backend
 *   node scripts/migrate_voice_preferences.js
 *
 * Seguro para rodar múltiplas vezes — usa $setOnInsert equivalente via $set
 * com operador condicional: só atualiza campos que não existem ($exists: false).
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const path   = require('path');
const dotenv = require('dotenv');

// Carrega variáveis de ambiente
dotenv.config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB  = process.env.MONGODB_DB_NAME || 'test';

if (!MONGODB_URI || MONGODB_URI.includes('<usuario>')) {
    console.error('❌ MONGODB_URI não configurada no backend/.env');
    console.error('   Edite o arquivo backend/.env e preencha MONGODB_URI com sua connection string real.');
    process.exit(1);
}

async function main() {
    console.log('🔗 Conectando ao MongoDB Atlas...');

    await mongoose.connect(MONGODB_URI, { dbName: MONGODB_DB });
    console.log(`✅ Conectado — banco: ${MONGODB_DB}`);

    const db = mongoose.connection.db;
    const col = db.collection('usuarios');

    // ── 1. Conta quantos usuários existem no total ───────────────────────────
    const total = await col.countDocuments();
    console.log(`\n📊 Total de usuários: ${total}`);

    // ── 2. Migração em lote: adiciona cada campo apenas se ausente ───────────
    const migrations = [
        {
            field: 'voiceGender',
            filter: { voiceGender: { $exists: false } },
            update: { $set: { voiceGender: 'female' } },
            desc:   "Gênero da voz padrão → 'female'"
        },
        {
            field: 'voiceSpeed',
            filter: { voiceSpeed: { $exists: false } },
            update: { $set: { voiceSpeed: 1.0 } },
            desc:   "Velocidade de voz padrão → 1.0"
        },
        {
            field: 'ttsProvider',
            filter: { ttsProvider: { $exists: false } },
            update: { $set: { ttsProvider: 'auto' } },
            desc:   "Provedor TTS padrão → 'auto'"
        },
        {
            field: 'preferenciaNarracao',
            filter: { preferenciaNarracao: { $exists: false } },
            update: { $set: { preferenciaNarracao: 'texto_audio' } },
            desc:   "Preferência de narração padrão → 'texto_audio'"
        },
        {
            field: 'accessibilityFontSize',
            filter: { accessibilityFontSize: { $exists: false } },
            update: { $set: { accessibilityFontSize: '100%' } },
            desc:   "Tamanho de fonte padrão → '100%'"
        },
        {
            field: 'accessibilityContrast',
            filter: { accessibilityContrast: { $exists: false } },
            update: { $set: { accessibilityContrast: false } },
            desc:   "Modo alto contraste padrão → false"
        },
        {
            field: 'accessibilityReadingMode',
            filter: { accessibilityReadingMode: { $exists: false } },
            update: { $set: { accessibilityReadingMode: false } },
            desc:   "Modo leitura padrão → false"
        }
    ];

    console.log('\n🔧 Executando migrações...\n');

    let totalModificados = 0;

    for (const m of migrations) {
        const sem = await col.countDocuments(m.filter);
        if (sem === 0) {
            console.log(`  ✅ '${m.field}' — todos os ${total} usuários já têm este campo. Pulando.`);
            continue;
        }

        const result = await col.updateMany(m.filter, m.update);
        console.log(`  🔄 '${m.field}' — ${result.modifiedCount} de ${sem} usuário(s) atualizados — ${m.desc}`);
        totalModificados += result.modifiedCount;
    }

    // ── 3. Cria índice TTL no TtsAudioCache (se ainda não existir) ───────────
    console.log('\n🗂️  Verificando índice TTL na coleção TtsAudioCache...');
    const cacheCol = db.collection('ttsaudiocaches');
    const cacheExists = await cacheCol.countDocuments().catch(() => -1);

    if (cacheExists >= 0) {
        try {
            await cacheCol.createIndex(
                { expiraEm: 1 },
                { expireAfterSeconds: 0, name: 'ttl_expiraEm', background: true }
            );
            console.log('  ✅ Índice TTL criado/confirmado em TtsAudioCache.expiraEm');
        } catch (e) {
            if (e.code === 85 || e.code === 86) {
                // Índice já existe com configuração compatível
                console.log('  ✅ Índice TTL já existe em TtsAudioCache.expiraEm');
            } else {
                console.warn('  ⚠️  Aviso ao criar índice TTL:', e.message);
            }
        }

        // Preenche expiraEm nos caches antigos que não têm o campo
        const semExpiry = await cacheCol.countDocuments({ expiraEm: { $exists: false } });
        if (semExpiry > 0) {
            const trintaDias = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            const r = await cacheCol.updateMany(
                { expiraEm: { $exists: false } },
                { $set: { expiraEm: trintaDias } }
            );
            console.log(`  🔄 TtsAudioCache — ${r.modifiedCount} entradas sem TTL atualizadas (expiram em 30 dias)`);
        } else {
            console.log('  ✅ TtsAudioCache — todos os registros já têm campo expiraEm');
        }
    } else {
        console.log('  ℹ️  Coleção TtsAudioCache ainda não existe (será criada automaticamente no primeiro uso)');
    }

    // ── 4. Índices de performance no Usuario ─────────────────────────────────
    console.log('\n🗂️  Criando/confirmando índices de performance em usuarios...');

    const indices = [
        { spec: { ttsProvider: 1 },    opts: { name: 'idx_ttsProvider',    background: true, sparse: true } },
        { spec: { voiceGender: 1 },    opts: { name: 'idx_voiceGender',    background: true, sparse: true } },
        { spec: { perfil: 1, ativo: 1 }, opts: { name: 'idx_perfil_ativo', background: true } },
        { spec: { ultimoLogin: 1, ativo: 1 }, opts: { name: 'idx_ultimoLogin_ativo', background: true } }
    ];

    for (const idx of indices) {
        try {
            await col.createIndex(idx.spec, idx.opts);
            console.log(`  ✅ Índice '${idx.opts.name}' criado/confirmado`);
        } catch (e) {
            if (e.code === 85 || e.code === 86) {
                console.log(`  ✅ Índice '${idx.opts.name}' já existe`);
            } else {
                console.warn(`  ⚠️  Aviso ao criar índice '${idx.opts.name}':`, e.message);
            }
        }
    }

    // ── 5. Resumo ─────────────────────────────────────────────────────────────
    console.log('\n─────────────────────────────────────────────────────────');
    console.log(`✅ Migração concluída!`);
    console.log(`   Total de usuários:   ${total}`);
    console.log(`   Documentos alterados: ${totalModificados}`);
    console.log('─────────────────────────────────────────────────────────\n');

    await mongoose.disconnect();
    process.exit(0);
}

main().catch(err => {
    console.error('\n❌ Erro durante a migração:', err.message);
    console.error(err.stack);
    mongoose.disconnect().finally(() => process.exit(1));
});
