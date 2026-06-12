/**
 * @file tts.js
 * @desc Rota de Text-to-Speech com suporte a dois provedores:
 *       - Google Gemini TTS  (GOOGLE_TTS_API_KEY)
 *       - ElevenLabs         (ELEVENLABS_API_KEY)
 *
 * O cliente escolhe o provedor via campo `provider` no body:
 *   { text, gender, provider }  — provider = 'gemini' | 'elevenlabs'
 *
 * Fallback automático: se o provedor escolhido falhar, tenta o outro.
 * Se ambos falharem, o frontend cai no Web Speech API (voz nativa).
 */

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const crypto = require('crypto');
const logger = require('../utils/logger');
const authJWT = require('../middleware/authJWT');
const TtsAudioCache = require('../models/TtsAudioCache');

// ─── Vozes Gemini TTS (pt-BR) ────────────────────────────────────────────────
const GEMINI_VOICES = {
    female: 'Zephyr',
    male:   'Charon',
};

// ─── Vozes ElevenLabs (pt-BR) ────────────────────────────────────────────────
// IDs das vozes disponíveis no plano gratuito e pago do ElevenLabs
const ELEVENLABS_VOICES = {
    female: 'cgSgspJ2msm6clMCkdW9', // Jessica (pt-BR natural)
    male:   'nPczCjzI2devNBz1zQrb', // Brian  (pt-BR natural)
};

// ─── Modelo ElevenLabs ────────────────────────────────────────────────────────
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

// ─────────────────────────────────────────────────────────────────────────────
// Utilitário: PCM raw → WAV (para o Gemini, que retorna PCM sem header)
// ─────────────────────────────────────────────────────────────────────────────
function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitDepth = 16) {
    const byteRate   = sampleRate * channels * (bitDepth / 8);
    const blockAlign = channels * (bitDepth / 8);
    const dataSize   = pcmBuffer.length;
    const wav        = Buffer.alloc(44 + dataSize);

    wav.write('RIFF', 0, 'ascii');
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write('WAVE', 8, 'ascii');
    wav.write('fmt ', 12, 'ascii');
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(channels, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(byteRate, 28);
    wav.writeUInt16LE(blockAlign, 32);
    wav.writeUInt16LE(bitDepth, 34);
    wav.write('data', 36, 'ascii');
    wav.writeUInt32LE(dataSize, 40);
    pcmBuffer.copy(wav, 44);

    return wav;
}

// ─────────────────────────────────────────────────────────────────────────────
// Síntese via Google Gemini TTS
// Retorna: { buffer: Buffer, contentType: string } ou lança erro
// ─────────────────────────────────────────────────────────────────────────────
async function synthesizeGemini(text, gender) {
    const apiKey = process.env.GOOGLE_TTS_API_KEY;
    if (!apiKey || apiKey === 'COLE_SUA_CHAVE_AQUI') {
        throw new Error('GOOGLE_TTS_API_KEY não configurada');
    }

    const voiceName = gender === 'male' ? GEMINI_VOICES.male : GEMINI_VOICES.female;
    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
            await new Promise(r => setTimeout(r, 600 * attempt));
            logger.warn(`[TTS/Gemini] Retry ${attempt}/${MAX_RETRIES}...`);
        }

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: text.substring(0, 5000) }] }],
                    generationConfig: {
                        responseModalities: ['AUDIO'],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: { voiceName }
                            }
                        }
                    }
                })
            }
        );

        if (!response.ok) {
            const errDetail = await response.json().catch(() => ({}));
            const errMsg = errDetail.error?.message || `HTTP ${response.status}`;

            if (response.status === 401 || response.status === 403) {
                throw new Error(`Gemini: chave inválida ou sem permissão (${response.status})`);
            }
            if (response.status === 429) {
                throw new Error('Gemini: limite de uso atingido (429)');
            }
            if (response.status >= 500 && attempt < MAX_RETRIES) continue;

            throw new Error(`Gemini: ${errMsg}`);
        }

        const json = await response.json();
        const candidate    = json?.candidates?.[0];
        const finishReason = candidate?.finishReason;
        const audioBase64  = candidate?.content?.parts?.[0]?.inlineData?.data;

        if (audioBase64) {
            const pcm    = Buffer.from(audioBase64, 'base64');
            const buffer = pcmToWav(pcm);
            return { buffer, contentType: 'audio/wav' };
        }

        if (finishReason === 'OTHER' || finishReason === 'SAFETY') {
            throw new Error(`Gemini: conteúdo bloqueado pelo filtro (${finishReason})`);
        }

        if (attempt < MAX_RETRIES) continue;
        throw new Error(`Gemini: resposta sem áudio. finishReason=${finishReason ?? 'UNKNOWN'}`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Síntese via ElevenLabs
// Retorna: { buffer: Buffer, contentType: string } ou lança erro
// ─────────────────────────────────────────────────────────────────────────────
async function synthesizeElevenLabs(text, gender) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey || apiKey === 'COLE_SUA_CHAVE_AQUI') {
        throw new Error('ELEVENLABS_API_KEY não configurada');
    }

    const voiceId = gender === 'male' ? ELEVENLABS_VOICES.male : ELEVENLABS_VOICES.female;
    const url     = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'xi-api-key':   apiKey,
            'Content-Type': 'application/json',
            'Accept':       'audio/mpeg'
        },
        body: JSON.stringify({
            text:       text.substring(0, 5000),
            model_id:   ELEVENLABS_MODEL,
            voice_settings: {
                stability:         0.5,
                similarity_boost:  0.75,
                style:             0.0,
                use_speaker_boost: true
            }
        })
    });

    if (!response.ok) {
        const errDetail = await response.json().catch(() => ({}));
        const errMsg    = errDetail.detail?.message || errDetail.message || `HTTP ${response.status}`;

        if (response.status === 401) throw new Error('ElevenLabs: chave inválida (401)');
        if (response.status === 429) throw new Error('ElevenLabs: limite de uso atingido (429)');

        throw new Error(`ElevenLabs: ${errMsg}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer || buffer.length === 0) {
        throw new Error('ElevenLabs: buffer de áudio vazio');
    }

    return { buffer, contentType: 'audio/mpeg' };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tts/status — verifica configuração dos dois provedores
// ─────────────────────────────────────────────────────────────────────────────
router.get('/status', authJWT, async (req, res) => {
    const geminiKey     = process.env.GOOGLE_TTS_API_KEY;
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;

    const status = {
        gemini: {
            configured:  !!(geminiKey && geminiKey !== 'COLE_SUA_CHAVE_AQUI'),
            apiKeyPrefix: geminiKey && geminiKey !== 'COLE_SUA_CHAVE_AQUI'
                ? `${geminiKey.substring(0, 8)}...`
                : null,
            connectionOk: false,
            lastError:    null,
            httpStatus:   null
        },
        elevenlabs: {
            configured:  !!(elevenLabsKey && elevenLabsKey !== 'COLE_SUA_CHAVE_AQUI'),
            apiKeyPrefix: elevenLabsKey && elevenLabsKey !== 'COLE_SUA_CHAVE_AQUI'
                ? `${elevenLabsKey.substring(0, 8)}...`
                : null,
            connectionOk: false,
            lastError:    null,
            httpStatus:   null
        }
    };

    // Testa Gemini
    if (status.gemini.configured) {
        try {
            const testRes  = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${geminiKey}`,
                {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        contents: [{ parts: [{ text: 'Olá, teste de voz do sistema escolar.' }] }],
                        generationConfig: {
                            responseModalities: ['AUDIO'],
                            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: GEMINI_VOICES.female } } }
                        }
                    })
                }
            );
            const testJson  = await testRes.json().catch(() => ({}));
            const testAudio = testJson?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

            status.gemini.httpStatus    = testRes.status;
            status.gemini.connectionOk  = testRes.ok && !!testAudio;
            if (!testRes.ok) {
                status.gemini.lastError = testJson.error?.message || `HTTP ${testRes.status}`;
            } else if (!testAudio) {
                status.gemini.lastError = `Sem áudio. finishReason: ${testJson?.candidates?.[0]?.finishReason ?? 'UNKNOWN'}`;
            }
        } catch (err) {
            status.gemini.lastError = err.message;
        }
    } else {
        status.gemini.lastError = 'GOOGLE_TTS_API_KEY ausente ou não configurada no .env';
    }

    // Testa ElevenLabs (só verifica a autenticação, não gera áudio para economizar créditos)
    if (status.elevenlabs.configured) {
        try {
            const testRes = await fetch('https://api.elevenlabs.io/v1/user', {
                headers: { 'xi-api-key': elevenLabsKey }
            });
            const testJson = await testRes.json().catch(() => ({}));

            status.elevenlabs.httpStatus   = testRes.status;
            status.elevenlabs.connectionOk = testRes.ok;
            if (!testRes.ok) {
                status.elevenlabs.lastError = testJson.detail?.message || `HTTP ${testRes.status}`;
            }
        } catch (err) {
            status.elevenlabs.lastError = err.message;
        }
    } else {
        status.elevenlabs.lastError = 'ELEVENLABS_API_KEY ausente ou não configurada no .env';
    }

    res.json({ success: true, status });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tts — converte texto em áudio
// Body: { text, gender, provider }
//   provider = 'gemini' | 'elevenlabs' | 'auto' (padrão: auto)
//   auto = tenta o provedor com chave configurada; fallback para o outro
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', authJWT, async (req, res) => {
    const { text, gender = 'female', provider = 'auto' } = req.body;

    if (!text) {
        return res.status(400).json({ success: false, error: 'Texto é obrigatório' });
    }

    const textNormalized = text.trim();

    if (textNormalized.length < 5) {
        return res.status(400).json({
            success: false,
            error: 'Texto muito curto para síntese de voz (mínimo 5 caracteres).'
        });
    }

    // Hash único por provedor + gênero + texto
    const hash = crypto
        .createHash('sha256')
        .update(`${provider}:${gender}:${textNormalized}`)
        .digest('hex');

    logger.info(`[TTS] Requisição: provider=${provider} gender=${gender} texto="${textNormalized.substring(0, 30)}..."`);

    try {
        // 1. Cache
        const cached = await TtsAudioCache.findOne({ hash });
        if (cached) {
            logger.info(`[TTS] Cache HIT: ${hash.substring(0, 8)}`);
            // Detecta tipo pelo magic bytes (WAV = RIFF, MP3 = 0xFF 0xFB ou ID3)
            const isWav = cached.audioData.slice(0, 4).toString('ascii') === 'RIFF';
            res.set({
                'Content-Type':   isWav ? 'audio/wav' : 'audio/mpeg',
                'Content-Length': cached.audioData.length,
                'X-Cache':        'HIT',
                'X-Provider':     cached.voiceId || provider,
                'Access-Control-Expose-Headers': 'X-Cache, X-Provider'
            });
            return res.send(cached.audioData);
        }

        // 2. Determinar ordem de provedores
        const geminiOk     = !!(process.env.GOOGLE_TTS_API_KEY   && process.env.GOOGLE_TTS_API_KEY   !== 'COLE_SUA_CHAVE_AQUI');
        const elevenOk     = !!(process.env.ELEVENLABS_API_KEY    && process.env.ELEVENLABS_API_KEY    !== 'COLE_SUA_CHAVE_AQUI');

        let providerOrder;
        if (provider === 'gemini') {
            providerOrder = ['gemini', 'elevenlabs'];
        } else if (provider === 'elevenlabs') {
            providerOrder = ['elevenlabs', 'gemini'];
        } else {
            // auto: prioriza o que tem chave configurada
            providerOrder = elevenOk ? ['elevenlabs', 'gemini'] : ['gemini', 'elevenlabs'];
        }

        let result   = null;
        let usedProv = null;
        const errors = [];

        for (const prov of providerOrder) {
            try {
                const startTime = Date.now();

                if (prov === 'gemini') {
                    if (!geminiOk) { errors.push('Gemini: não configurado'); continue; }
                    result = await synthesizeGemini(textNormalized, gender);
                } else {
                    if (!elevenOk) { errors.push('ElevenLabs: não configurado'); continue; }
                    result = await synthesizeElevenLabs(textNormalized, gender);
                }

                const duration = Date.now() - startTime;
                logger.info(`[TTS/${prov}] Sucesso! ${duration}ms, ${result.buffer.length}B`);
                usedProv = prov;
                break;

            } catch (err) {
                logger.warn(`[TTS/${prov}] Falhou: ${err.message}. Tentando próximo provedor...`);
                errors.push(`${prov}: ${err.message}`);
            }
        }

        if (!result) {
            logger.error('[TTS] Todos os provedores falharam:', errors);
            return res.status(503).json({
                success: false,
                error:   'Nenhum serviço de voz disponível no momento.',
                details: errors
            });
        }

        // 3. Salva no cache
        await TtsAudioCache.create({
            hash,
            audioData: result.buffer,
            text:      textNormalized,
            voiceId:   usedProv
        }).catch(e => logger.warn('[TTS] Erro ao salvar cache:', e.message));

        // 4. Responde
        res.set({
            'Content-Type':   result.contentType,
            'Content-Length': result.buffer.length,
            'X-Cache':        'MISS',
            'X-Provider':     usedProv,
            'Access-Control-Expose-Headers': 'X-Cache, X-Provider'
        });
        return res.send(result.buffer);

    } catch (error) {
        logger.error('❌ [TTS] Exceção inesperada:', error);
        res.status(500).json({ success: false, error: 'Erro interno no serviço de áudio.' });
    }
});

module.exports = router;
