const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const logger = require('../utils/logger');
const authJWT = require('../middleware/authJWT');
const TtsAudioCache = require('../models/TtsAudioCache');
const TTSService = require('../services/TTSService');
const voiceService = require('../services/voiceService');
const { ttsUsuarioLimiter, ttsIpLimiter } = require('../middleware/rateLimiters');

// ============================================
// COTA DE API EXTERNA PAGA
// ============================================
// Cada chamada de síntese consome cota da ElevenLabs/Gemini, faturada ao
// projeto. Antes o único freio era o globalLimiter (2000 req/15min por IP), o
// que deixava qualquer conta autenticada queimar a cota inteira — e o texto
// sintetizado vinha do corpo, sem teto de tamanho. Não é vazamento de dado; é
// negação de serviço com custo financeiro.
const limitarTTS = [ttsIpLimiter, ttsUsuarioLimiter];

// Teto de caracteres por chamada. O provedor cobra por caractere, então um
// único POST com megabytes de texto valia por milhares de requisições.
const MAX_CARACTERES_TTS = 5000;

function textoDentroDoLimite(res, texto) {
    if (String(texto).length <= MAX_CARACTERES_TTS) return true;
    res.status(413).json({
        success: false,
        error: `Texto muito longo para narração (máximo ${MAX_CARACTERES_TTS} caracteres).`,
    });
    return false;
}

/**
 * POST /api/tts/speak — Gera texto via Gemini e Áudio via ElevenLabs
 * Se 'prompt' for enviado, gera o texto antes. Se 'text' for enviado, sintetiza direto.
 */
router.post('/speak', authJWT, limitarTTS, async (req, res) => {
    let { text, prompt, voiceId } = req.body;

    try {
        // Valida ANTES de chamar o Gemini: o prompt também é entrada paga.
        if (typeof prompt === 'string' && !textoDentroDoLimite(res, prompt)) return;
        if (typeof text === 'string' && !textoDentroDoLimite(res, text)) return;

        // 1. Gerar texto via Gemini se houver prompt
        if (prompt && !text) {
            text = await voiceService.generateInsightText(prompt);
        }

        if (!text) {
            return res.status(400).json({ success: false, error: 'Texto ou Prompt é obrigatório' });
        }

        // 2. Hash para Cache — inclui voiceId para não misturar caches de vozes diferentes
        const resolvedVoiceId = voiceId || 'brian';
        const hash = crypto
            .createHash('sha256')
            .update(`elevenlabs:${resolvedVoiceId}:${text}`)
            .digest('hex');
        const cached = await TtsAudioCache.findOne({ hash });

        if (cached) {
            res.set({ 'Content-Type': 'audio/mpeg', 'X-Cache': 'HIT' });
            return res.send(cached.audioData);
        }

        // 3. Sintetizar via ElevenLabs com a voz solicitada
        const result = await TTSService.synthesizeWithVoice(text, resolvedVoiceId);

        // 4. Salvar Cache
        TtsAudioCache.create({
            hash,
            audioData: result.buffer,
            text,
            voiceId: resolvedVoiceId,
        }).catch((e) => logger.warn('[TTS] Erro cache:', e.message));

        // 5. Responder
        res.set({
            'Content-Type': 'audio/mpeg',
            'X-Cache': 'MISS',
            'X-Provider': 'elevenlabs',
            'X-Text': Buffer.from(text).toString('base64'), // Envia texto base64 no header se frontend precisar
            'Access-Control-Expose-Headers': 'X-Cache, X-Text',
        });

        return res.send(result.buffer);
    } catch (error) {
        logger.error('❌ [TTS/Speak] Erro:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/tts — Legado/Simples (Sintetiza direto)
 */
router.post('/', authJWT, limitarTTS, async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ success: false, error: 'Texto obrigatório' });
    if (!textoDentroDoLimite(res, text)) return;

    try {
        const result = await TTSService.synthesize(text);
        res.set({ 'Content-Type': 'audio/mpeg' });
        return res.send(result.buffer);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/tts/voices — Lista vozes disponíveis e valida IDs configurados
 */
router.get('/voices', authJWT, async (req, res) => {
    try {
        const [voices, validation] = await Promise.all([
            TTSService.listAvailableVoices(),
            TTSService.validateAndUpdateVoices(),
        ]);

        res.json({
            success: true,
            totalVoices: voices.length,
            voices,
            validation,
        });
    } catch (error) {
        logger.error('❌ [TTS/Voices] Erro:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
