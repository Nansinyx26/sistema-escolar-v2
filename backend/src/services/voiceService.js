const fetch = globalThis.fetch || (function() { try { return require('node-fetch'); } catch { return null; } })();
const logger = require('../utils/logger');
const TTSService = require('./TTSService');

/**
 * voiceService: Faz a ponte entre IA (Gemini) e Voz (ElevenLabs).
 */
class VoiceService {

    /**
     * Gera texto a partir de um prompt usando Google Gemini.
     * @param {string} prompt
     * @param {object} [opts]
     * @param {number} [opts.maxOutputTokens=1000] - teto de saída (controle de custo)
     * @param {number} [opts.temperature=0.7]
     */
    async generateInsightText(prompt, opts = {}) {
        // Aceita múltiplos nomes de variável para a chave do Gemini.
        // No Render a chave está configurada como GEMINI_KEY.
        const apiKey = process.env.GEMINI_KEY
            || process.env.GEMINI_API_KEY
            || process.env.GOOGLE_TTS_API_KEY
            || process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            const err = new Error('Chave do Gemini não configurada no servidor (GEMINI_KEY).');
            err.quotaExceeded = true;
            throw err;
        }

        // Controle de custo: teto de entrada (~16k chars ≈ 4k tokens).
        // Prompts maiores são truncados preservando o início (instruções + dados).
        const MAX_PROMPT_CHARS = 16000;
        if (typeof prompt === 'string' && prompt.length > MAX_PROMPT_CHARS) {
            logger.warn(`[VoiceService] Prompt truncado de ${prompt.length} para ${MAX_PROMPT_CHARS} chars.`);
            prompt = prompt.slice(0, MAX_PROMPT_CHARS);
        }

        const modelos = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro'];
        let lastError = null;

        for (const mod of modelos) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mod)}:generateContent?key=${apiKey}`;
            console.log(`[VoiceService] Chamando Gemini (${mod}) para: "${prompt.substring(0, 50)}..."`);

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: opts.temperature ?? 0.7,
                            maxOutputTokens: opts.maxOutputTokens ?? 1000,
                        }
                    })
                });

                if (!response.ok) {
                    const errBody = await response.json().catch(() => ({}));
                    const errMsg = errBody.error?.message || `Erro Gemini: ${response.status}`;
                    const err = new Error(errMsg);
                    if (response.status === 429 || errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('rate limit')) {
                        err.quotaExceeded = true;
                    }
                    lastError = err;
                    logger.warn(`[VoiceService] Erro no modelo ${mod}: ${errMsg}. Tentando próximo fallback...`);
                    continue;
                }

                const data = await response.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                return text.replace(/[*_~`#]/g, '').trim();
            } catch (error) {
                lastError = error;
                logger.warn(`[VoiceService] Gemini error no modelo ${mod}: ${error.message}`);
            }
        }

        throw lastError || new Error('Todos os modelos Gemini falharam no VoiceService.');
    }

    /**
     * Sintetiza texto em áudio usando ElevenLabs via TTSService.
     */
    async synthesizeSpeech(text) {
        // TTSService já está refatorado para usar apenas ElevenLabs e voz masculina
        return await TTSService.synthesize(text);
    }
}

module.exports = new VoiceService();
