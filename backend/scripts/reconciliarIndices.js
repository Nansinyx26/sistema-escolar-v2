/**
 * reconciliarIndices.js
 *
 * Compara os índices declarados nos schemas Mongoose com os índices
 * que REALMENTE existem nas coleções do MongoDB Atlas.
 *
 * Modo dry-run (padrão): apenas imprime o que faria.
 * Modo apply (--apply):  executa as remoções de verdade.
 *
 * Uso:
 *   node scripts/reconciliarIndices.js           # dry-run, só mostra
 *   node scripts/reconciliarIndices.js --apply   # remove índices órfãos
 *
 * ATENÇÃO: rode SEMPRE o dry-run antes do --apply em produção.
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

// ──────────────────────────────────────────────────────────────────
// Carregar todos os models (registra os schemas no mongoose.models)
// ──────────────────────────────────────────────────────────────────
const path = require('path');
const modelsDir = path.join(__dirname, '../src/models');
const fs = require('fs');

const modelFiles = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js'));
for (const file of modelFiles) {
    try {
        require(path.join(modelsDir, file));
    } catch (e) {
        console.warn(`⚠️  Falha ao carregar ${file}: ${e.message}`);
    }
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

/**
 * Normaliza a assinatura de chaves de um índice para comparação.
 * { escolaId: 1, cpf: 1 } → "escolaId_1__cpf_1"
 */
function assinatura(indexSpec) {
    return Object.entries(indexSpec)
        .map(([k, v]) => `${k}_${v}`)
        .join('__');
}

/**
 * Extrai as assinaturas de índice declaradas no schema Mongoose.
 * Inclui índices de campo inline (unique:true, index:true) e schema.index().
 */
function assinaturasDoSchema(model) {
    const schema = model.schema;
    const sigs = new Set();

    // Índices declarados via schema.index(...)
    for (const [spec] of schema.indexes()) {
        sigs.add(assinatura(spec));
    }

    // Índices inline (unique:true / index:true nos campos)
    schema.eachPath((pathname, schemaType) => {
        if (pathname === '_id') return; // MongoDB cria _id automaticamente
        const opts = schemaType.options || {};
        if (opts.unique || opts.index) {
            sigs.add(assinatura({ [pathname]: 1 }));
        }
    });

    return sigs;
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────
async function main() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('❌ MONGODB_URI não definida. Preencha backend/.env');
        process.exit(1);
    }

    await mongoose.connect(uri, {
        dbName: process.env.MONGODB_DB_NAME || undefined,
        serverSelectionTimeoutMS: 10_000,
    });
    console.log('✅ Conectado ao MongoDB\n');

    if (APPLY) {
        console.log('🔴 MODO APPLY — índices órfãos serão REMOVIDOS do banco.\n');
    } else {
        console.log('🟡 MODO DRY-RUN — nenhuma alteração será feita. Use --apply para executar.\n');
    }

    const models = Object.values(mongoose.models);
    let totalOrfaos = 0;

    for (const model of models) {
        const nomeModel = model.modelName;
        const collection = model.collection;

        let indexesNoBanco;
        try {
            indexesNoBanco = await collection.indexes();
        } catch (e) {
            console.warn(`⚠️  Não foi possível ler índices de "${nomeModel}": ${e.message}`);
            continue;
        }

        const sigsSchema = assinaturasDoSchema(model);

        // Índices que existem no banco mas não estão no schema
        const orfaos = indexesNoBanco.filter(idx => {
            if (idx.name === '_id_') return false; // NUNCA remover _id
            return !sigsSchema.has(assinatura(idx.key));
        });

        // Estado atual
        console.log(`═══════════════════════════════════════════════`);
        console.log(`Model  : ${nomeModel}`);
        console.log(`Coleção: ${collection.collectionName}`);
        console.log(`Índices no banco   : ${indexesNoBanco.length}`);
        console.log(`Índices no schema  : ${sigsSchema.size + 1 /* +1 para _id */}`);

        if (orfaos.length === 0) {
            console.log('✅ Nenhum índice órfão.\n');
            continue;
        }

        totalOrfaos += orfaos.length;
        console.log(`\n🔍 Índices ÓRFÃOS (existem no banco, não estão no schema):`);
        for (const idx of orfaos) {
            console.log(`  - name: "${idx.name}"  key: ${JSON.stringify(idx.key)}  options: ${JSON.stringify(
                Object.fromEntries(
                    Object.entries(idx).filter(([k]) => !['v', 'key', 'name', 'ns'].includes(k))
                )
            )}`);

            if (APPLY) {
                try {
                    await collection.dropIndex(idx.name);
                    console.log(`  🗑️  Removido: "${idx.name}"`);
                } catch (e) {
                    console.error(`  ❌ Falha ao remover "${idx.name}": ${e.message}`);
                }
            } else {
                console.log(`  → [DRY-RUN] Removeria: "${idx.name}"`);
            }
        }
        console.log('');
    }

    console.log('═══════════════════════════════════════════════');
    if (totalOrfaos === 0) {
        console.log('✅ Banco em sincronia com os schemas. Nenhum índice órfão encontrado.');
    } else if (APPLY) {
        console.log(`✅ ${totalOrfaos} índice(s) órfão(s) removido(s).`);
    } else {
        console.log(`⚠️  ${totalOrfaos} índice(s) órfão(s) encontrado(s).`);
        console.log('   Execute com --apply para removê-los:');
        console.log('   node scripts/reconciliarIndices.js --apply');
    }

    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('❌ Erro fatal:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
