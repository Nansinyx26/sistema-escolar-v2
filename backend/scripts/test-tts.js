const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const ttsService = require('../src/services/TTSService');

(async () => {
    console.log("Iniciando teste de conectividade TTS...");
    console.log("GOOGLE_TTS_API_KEY:", process.env.GOOGLE_TTS_API_KEY ? "Presente" : "Ausente");
    console.log("ELEVENLABS_API_KEY:", process.env.ELEVENLABS_API_KEY ? "Presente" : "Ausente");
    
    try {
        const providers = ttsService._getAvailableProviders();
        const results = {};

        for (const p of providers) {
            try {
                console.log(`\nTestando provedor: ${p.name}...`);
                await ttsService._callProvider(p, "Olá, esta é uma mensagem de teste do sistema escolar.", "female");
                results[p.id] = { status: "healthy", name: p.name };
                console.log(`[OK] Provedor ${p.name} respondeu com sucesso.`);
            } catch (err) {
                results[p.id] = { status: "error", name: p.name, message: err.message };
                console.error(`[ERRO] Provedor ${p.name} falhou:`, err.message);
            }
        }

        console.log("\nResultados do teste:\n", JSON.stringify(results, null, 2));
    } catch (error) {
        console.error("Erro geral no teste:", error);
    }
})();
