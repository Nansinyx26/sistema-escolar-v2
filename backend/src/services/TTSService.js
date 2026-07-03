// Node 22+ provides native fetch — no need for node-fetch
const logger = require('../utils/logger');

// ─── Vozes ElevenLabs PT-BR (Masculinas) ──────────────────────────────────────
// Verificado em 2026-06-25 via API /v1/voices — 22 vozes premade disponíveis
// Ordem de prioridade: Adam (padrão) → Brian → Eric → George
const ELEVENLABS_VOICES = {
    adam: 'pNInz6obpgDQGcFmaJgB',    // Adam - Dominant, Firm (premade ✅)
    brian: 'nPczCjzI2devNBz1zQrb',   // Brian - Deep, Resonant and Comforting (premade ✅)
    eric: 'cjVigY5qzO86Huf0OWal',   // Eric - Smooth, Trustworthy (premade ✅)
    george: 'JBFqnCBsd6RMkjVDRZzb', // George - Warm, Captivating Storyteller (premade ✅)
};

// Lista de fallback: tenta cada voz na ordem até encontrar uma que funcione
// (será atualizada dinamicamente por validateAndUpdateVoices)
let VOICE_FALLBACK_ORDER = [
    ELEVENLABS_VOICES.adam,
    ELEVENLABS_VOICES.brian,
    ELEVENLABS_VOICES.eric,
    ELEVENLABS_VOICES.george,
];

let DEFAULT_VOICE_ID = ELEVENLABS_VOICES.adam;
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

/**
 * TTSService: Gerencia síntese de voz EXCLUSIVAMENTE via ElevenLabs.
 */
class TTSService {

    /**
     * Gera áudio a partir de texto usando ElevenLabs.
     * Tenta múltiplas vozes em caso de falha (voice not found).
     */
    async synthesize(text, gender = 'male', preferredProvider = 'elevenlabs') {
        const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;

        if (!apiKey) {
            throw new Error('Configuração ELEVENLABS_API_KEY ou ELEVEN_LABS_API_KEY ausente no servidor.');
        }

        console.log(`[TTS] Backend - ElevenLabs: ${apiKey ? 'Present' : 'MISSING'}. Gerando áudio via ElevenLabs.`);

        // Tenta cada voz na ordem de fallback
        let lastError = null;
        for (const voiceId of VOICE_FALLBACK_ORDER) {
            try {
                console.log(`[TTS] Tentando voz: ${voiceId}`);
                const result = await this._synthesizeElevenLabs(text, voiceId);
                console.log(`[TTS] ✅ Sucesso com voz: ${voiceId}`);
                return result;
            } catch (error) {
                lastError = error;
                // Se o erro for "voice not found", tenta a próxima
                if (error.message.includes('not found') || error.message.includes('404')) {
                    console.warn(`[TTS] Voz ${voiceId} não encontrada, tentando próxima...`);
                    continue;
                }
                // Outro erro (quota, network, etc) — não adianta tentar outra voz
                throw error;
            }
        }

        // Se todas as vozes falharam
        throw new Error(`Nenhuma voz ElevenLabs disponível. Último erro: ${lastError?.message}`);
    }

    /**
     * Sintetiza com uma voz específica pelo nome (adam, brian, eric, george).
     * Se o nome não for encontrado, usa fallback automático.
     */
    async synthesizeWithVoice(text, voiceName = 'adam') {
        const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
        if (!apiKey) {
            throw new Error('ELEVENLABS_API_KEY ausente no servidor.');
        }

        // Resolve o ID a partir do nome ou usa o valor diretamente se já for um ID
        const voiceId = ELEVENLABS_VOICES[voiceName] || ELEVENLABS_VOICES.adam;
        console.log(`[TTS] synthesizeWithVoice: name=${voiceName}, resolvedId=${voiceId}`);

        try {
            const result = await this._synthesizeElevenLabs(text, voiceId);
            console.log(`[TTS] ✅ Sucesso com voz "${voiceName}" (${voiceId})`);
            return result;
        } catch (error) {
            console.warn(`[TTS] Voz "${voiceName}" falhou (${error.message}), usando fallback...`);
            return await this.synthesize(text);
        }
    }

    /**
     * Testa a conectividade com ElevenLabs.
     */
    async testConnectivity() {
        const results = {};
        try {
            await this._synthesizeElevenLabs(".", DEFAULT_VOICE_ID);
            results['elevenlabs'] = { status: "healthy", name: 'ElevenLabs' };
        } catch (err) {
            results['elevenlabs'] = { status: "error", name: 'ElevenLabs', message: err.message };
        }
        return results;
    }

    /**
     * Lista todas as vozes disponíveis na conta ElevenLabs.
     * Retorna array com { name, voice_id, category }.
     */
    async listAvailableVoices() {
        const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
        if (!apiKey) {
            throw new Error('ELEVENLABS_API_KEY ausente.');
        }

        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            headers: { 'xi-api-key': apiKey }
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(`Erro ao listar vozes: ${errData.detail?.message || response.status}`);
        }

        const data = await response.json();
        return data.voices.map(v => ({
            name: v.name,
            voice_id: v.voice_id,
            category: v.category
        }));
    }

    /**
     * Valida os IDs hardcoded contra as vozes realmente disponíveis na conta.
     * Atualiza VOICE_FALLBACK_ORDER para conter apenas vozes válidas.
     * Retorna relatório de validação.
     */
    async validateAndUpdateVoices() {
        const report = { valid: [], invalid: [], fallbackOrder: [] };

        try {
            const available = await this.listAvailableVoices();
            const availableIds = new Set(available.map(v => v.voice_id));

            for (const [name, id] of Object.entries(ELEVENLABS_VOICES)) {
                if (availableIds.has(id)) {
                    const voiceInfo = available.find(v => v.voice_id === id);
                    report.valid.push({ name, id, category: voiceInfo?.category });
                } else {
                    report.invalid.push({ name, id });
                    console.warn(`[TTS] ⚠️ Voz "${name}" (${id}) NÃO está disponível nesta conta.`);
                }
            }

            // Atualizar fallback para conter apenas vozes válidas
            const validIds = report.valid.map(v => v.id);
            if (validIds.length > 0) {
                VOICE_FALLBACK_ORDER = validIds;
                DEFAULT_VOICE_ID = validIds[0];
                console.log(`[TTS] ✅ Fallback atualizado: ${report.valid.map(v => v.name).join(' → ')}`);
            } else {
                console.error('[TTS] ❌ Nenhuma voz hardcoded está disponível na conta!');
            }

            report.fallbackOrder = VOICE_FALLBACK_ORDER;
        } catch (err) {
            console.error('[TTS] Erro ao validar vozes:', err.message);
            report.error = err.message;
        }

        return report;
    }

    async _synthesizeElevenLabs(text, voiceId, signal) {
        const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
        const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`;

        console.log(`[ TTS ] ElevenLabs Request: voiceId=${voiceId}, model=${ELEVENLABS_MODEL}`);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'xi-api-key': apiKey,
                'Content-Type': 'application/json',
                'Accept': 'audio/mpeg'
            },
            body: JSON.stringify({
                text: text.substring(0, 5000),
                model_id: ELEVENLABS_MODEL,
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            }),
            signal
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const msg = errData.detail?.message || errData.message || `Status ${response.status}`;
            console.error(`[ TTS ] ElevenLabs Error (${response.status}):`, msg);
            throw new Error(msg);
        }

        const arrayBuffer = await response.arrayBuffer();
        return {
            buffer: Buffer.from(arrayBuffer),
            contentType: 'audio/mpeg',
            provider: 'elevenlabs'
        };
    }
}

module.exports = new TTSService();

