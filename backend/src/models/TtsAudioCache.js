const mongoose = require('mongoose');

const TtsAudioCacheSchema = new mongoose.Schema({
    hash: {
        type:     String,
        required: true,
        unique:   true,
        index:    true
    },
    audioData: {
        type:     Buffer,
        required: true
    },
    text: {
        type: String
    },
    voiceId: {
        type: String   // 'gemini' | 'elevenlabs'
    },
    dataCriacao: {
        type:    Date,
        default: Date.now
    },
    // TTL automático: o MongoDB remove o documento 30 dias após dataCriacao
    // Isso impede o cache de crescer indefinidamente
    expiraEm: {
        type:    Date,
        default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
        index:   { expireAfterSeconds: 0 }
    }
});

module.exports = mongoose.model('TtsAudioCache', TtsAudioCacheSchema);
