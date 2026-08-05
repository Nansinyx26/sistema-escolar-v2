const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const TTSService = require('./services/TTSService');

async function testAll() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║        ElevenLabs TTS — Diagnóstico Completo    ║');
    console.log('╚══════════════════════════════════════════════════╝');

    const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
    console.log(`\n🔑 API Key: ${apiKey ? '✅ Presente' : '❌ Ausente'}`);

    if (!apiKey) {
        console.error('Sem API key. Defina ELEVENLABS_API_KEY no .env');
        process.exit(1);
    }

    // 1. Listar vozes disponíveis na conta
    console.log('\n── 1. Vozes disponíveis na conta ──────────────────');
    try {
        const voices = await TTSService.listAvailableVoices();
        console.log(`Total: ${voices.length} vozes\n`);
        voices.forEach(v => {
            console.log(`  • ${v.name.padEnd(20)} │ ID: ${v.voice_id} │ Categoria: ${v.category}`);
        });
    } catch (err) {
        console.error('❌ Erro ao listar vozes:', err.message);
    }

    // 2. Validar IDs hardcoded
    console.log('\n── 2. Validação dos IDs configurados ─────────────');
    try {
        const report = await TTSService.validateAndUpdateVoices();

        if (report.valid.length > 0) {
            console.log('\n  ✅ Vozes válidas:');
            report.valid.forEach(v => {
                console.log(`     • ${v.name.padEnd(10)} │ ${v.id} │ ${v.category}`);
            });
        }

        if (report.invalid.length > 0) {
            console.log('\n  ⚠️  Vozes NÃO disponíveis:');
            report.invalid.forEach(v => {
                console.log(`     • ${v.name.padEnd(10)} │ ${v.id}`);
            });
        }

        console.log(`\n  Fallback order final: ${report.fallbackOrder.length} vozes`);
    } catch (err) {
        console.error('❌ Erro na validação:', err.message);
    }

    // 3. Testar síntese com fallback
    console.log('\n── 3. Teste de síntese (com fallback) ────────────');
    try {
        const result = await TTSService.synthesize('Teste de conexão com ElevenLabs.');
        console.log(`  ✅ Sucesso! Provider: ${result.provider}, Buffer: ${result.buffer.length} bytes`);
    } catch (err) {
        console.error(`  ❌ Falha na síntese: ${err.message}`);
    }

    // 4. Teste de conectividade
    console.log('\n── 4. Teste de conectividade ──────────────────────');
    try {
        const connectivity = await TTSService.testConnectivity();
        for (const [key, info] of Object.entries(connectivity)) {
            const icon = info.status === 'healthy' ? '✅' : '❌';
            console.log(`  ${icon} ${info.name}: ${info.status}${info.message ? ' — ' + info.message : ''}`);
        }
    } catch (err) {
        console.error('  ❌ Erro:', err.message);
    }

    console.log('\n══════════════════════════════════════════════════');
    console.log('Diagnóstico completo.');
}

testAll().catch(console.error);
