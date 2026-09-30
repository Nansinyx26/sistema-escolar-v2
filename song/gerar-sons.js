/**
 * gerar-sons.js — Gera variações de sons de notificação para avaliação.
 * Uso: node song/gerar-sons.js
 * 
 * Cria arquivos WAV puros (sem dependências) na pasta song/.
 */
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;
const songDir = __dirname;

// ── Utilitários WAV ──────────────────────────────────────────────────

function criarWav(samples) {
    const numSamples = samples.length;
    const dataSize = numSamples * 2; // 16-bit
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);

    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);       // chunk size
    buffer.writeUInt16LE(1, 20);        // PCM
    buffer.writeUInt16LE(1, 22);        // mono
    buffer.writeUInt32LE(SAMPLE_RATE, 24);
    buffer.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
    buffer.writeUInt16LE(2, 32);        // block align
    buffer.writeUInt16LE(16, 34);       // bits per sample

    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    for (let i = 0; i < numSamples; i++) {
        const val = Math.max(-1, Math.min(1, samples[i]));
        buffer.writeInt16LE(Math.round(val * 32767), 44 + i * 2);
    }
    return buffer;
}

function seg(s) { return Math.round(s * SAMPLE_RATE); }

// Envelope ADSR simplificado
function envelope(t, ataque, decaimento, sustain, release, durTotal) {
    if (t < ataque) return t / ataque;
    if (t < ataque + decaimento) return 1 - (1 - sustain) * ((t - ataque) / decaimento);
    if (t < durTotal - release) return sustain;
    return sustain * (1 - (t - (durTotal - release)) / release);
}

// ── Sons ─────────────────────────────────────────────────────────────

function sino() {
    // Som de sino cristalino — duas notas subindo, estilo escola
    const dur = 1.0;
    const total = seg(dur);
    const samples = new Float64Array(total);

    const notas = [
        { freq: 880, inicio: 0, dur: 0.5, vol: 0.35 },      // A5
        { freq: 1108.73, inicio: 0, dur: 0.5, vol: 0.15 },   // C#6 (harmônico)
        { freq: 1318.51, inicio: 0.15, dur: 0.7, vol: 0.3 }, // E6
        { freq: 1760, inicio: 0.15, dur: 0.4, vol: 0.1 },    // A6 (harmônico)
    ];

    for (const n of notas) {
        const start = seg(n.inicio);
        const len = seg(n.dur);
        for (let i = 0; i < len && (start + i) < total; i++) {
            const t = i / SAMPLE_RATE;
            const env = envelope(t, 0.005, 0.08, 0.3, n.dur * 0.6, n.dur);
            samples[start + i] += Math.sin(2 * Math.PI * n.freq * t) * n.vol * env;
        }
    }
    return samples;
}

function bolha() {
    // Pop/bolha suave — moderno, estilo app de mensagem
    const dur = 0.4;
    const total = seg(dur);
    const samples = new Float64Array(total);

    for (let i = 0; i < total; i++) {
        const t = i / SAMPLE_RATE;
        // Frequência que desce rapidamente (pop)
        const freq = 1200 * Math.exp(-t * 8) + 400;
        const env = Math.exp(-t * 10) * 0.4;
        samples[i] = Math.sin(2 * Math.PI * freq * t) * env;
    }
    return samples;
}

function gentil() {
    // Chime gentil — três notas em arpejo suave, estilo iOS
    const dur = 1.2;
    const total = seg(dur);
    const samples = new Float64Array(total);

    const notas = [
        { freq: 659.25, inicio: 0, dur: 0.4, vol: 0.25 },    // E5
        { freq: 783.99, inicio: 0.12, dur: 0.45, vol: 0.22 }, // G5
        { freq: 1046.50, inicio: 0.28, dur: 0.8, vol: 0.28 }, // C6
    ];

    for (const n of notas) {
        const start = seg(n.inicio);
        const len = seg(n.dur);
        for (let i = 0; i < len && (start + i) < total; i++) {
            const t = i / SAMPLE_RATE;
            const env = envelope(t, 0.008, 0.05, 0.4, n.dur * 0.5, n.dur);
            // Fundamental + harmônico suave
            const fund = Math.sin(2 * Math.PI * n.freq * t);
            const harm = Math.sin(2 * Math.PI * n.freq * 2 * t) * 0.15;
            samples[start + i] += (fund + harm) * n.vol * env;
        }
    }
    return samples;
}

function dongDong() {
    // Ding-dong clássico — duas notas, estilo campainha de escola
    const dur = 1.5;
    const total = seg(dur);
    const samples = new Float64Array(total);

    const notas = [
        { freq: 830.61, inicio: 0, dur: 0.6, vol: 0.3 },   // G#5/Ab5
        { freq: 622.25, inicio: 0.35, dur: 0.9, vol: 0.3 }, // Eb5 (quarta abaixo)
    ];

    for (const n of notas) {
        const start = seg(n.inicio);
        const len = seg(n.dur);
        for (let i = 0; i < len && (start + i) < total; i++) {
            const t = i / SAMPLE_RATE;
            const env = envelope(t, 0.003, 0.1, 0.25, n.dur * 0.7, n.dur);
            // Timbre de sino: fundamental + harmonicos parciais
            const f1 = Math.sin(2 * Math.PI * n.freq * t);
            const f2 = Math.sin(2 * Math.PI * n.freq * 2.76 * t) * 0.08; // inharmonico
            const f3 = Math.sin(2 * Math.PI * n.freq * 5.4 * t) * 0.03;
            samples[start + i] += (f1 + f2 + f3) * n.vol * env;
        }
    }
    return samples;
}

function moderno() {
    // Notificação moderna — swoosh + nota, estilo Material Design
    const dur = 0.7;
    const total = seg(dur);
    const samples = new Float64Array(total);

    // Swoosh inicial (ruído filtrado subindo)
    for (let i = 0; i < seg(0.15); i++) {
        const t = i / SAMPLE_RATE;
        const noise = (Math.random() * 2 - 1) * 0.08;
        const env = Math.sin(Math.PI * t / 0.15) * 0.5;
        // Filtro simples: mistura ruído com tom subindo
        const tone = Math.sin(2 * Math.PI * (400 + t * 8000) * t) * 0.1;
        samples[i] = (noise + tone) * env;
    }

    // Nota limpa que resolve
    const notas = [
        { freq: 987.77, inicio: 0.08, dur: 0.55, vol: 0.3 }, // B5
        { freq: 1479.98, inicio: 0.08, dur: 0.3, vol: 0.08 }, // harmônico
    ];

    for (const n of notas) {
        const start = seg(n.inicio);
        const len = seg(n.dur);
        for (let i = 0; i < len && (start + i) < total; i++) {
            const t = i / SAMPLE_RATE;
            const env = envelope(t, 0.01, 0.06, 0.35, n.dur * 0.5, n.dur);
            samples[start + i] += Math.sin(2 * Math.PI * n.freq * t) * n.vol * env;
        }
    }
    return samples;
}

function xilofone() {
    // Xilofone escolar — três notas alegres, som de madeira
    const dur = 1.0;
    const total = seg(dur);
    const samples = new Float64Array(total);

    const notas = [
        { freq: 523.25, inicio: 0, dur: 0.3, vol: 0.3 },     // C5
        { freq: 659.25, inicio: 0.13, dur: 0.3, vol: 0.28 },  // E5
        { freq: 783.99, inicio: 0.26, dur: 0.55, vol: 0.32 }, // G5
    ];

    for (const n of notas) {
        const start = seg(n.inicio);
        const len = seg(n.dur);
        for (let i = 0; i < len && (start + i) < total; i++) {
            const t = i / SAMPLE_RATE;
            // Decay rápido como xilofone
            const env = Math.exp(-t * 6) * n.vol;
            // Timbre de madeira: fundamental + harmônicos não-múltiplos
            const f1 = Math.sin(2 * Math.PI * n.freq * t);
            const f2 = Math.sin(2 * Math.PI * n.freq * 3.93 * t) * 0.12;
            const f3 = Math.sin(2 * Math.PI * n.freq * 9.1 * t) * 0.03;
            samples[start + i] += (f1 + f2 + f3) * env;
        }
    }
    return samples;
}

// ── Gerar todos ──────────────────────────────────────────────────────

const sons = [
    { nome: 'sino', fn: sino, desc: 'Sino cristalino — duas notas subindo' },
    { nome: 'bolha', fn: bolha, desc: 'Pop/bolha — curto e moderno' },
    { nome: 'gentil', fn: gentil, desc: 'Chime gentil — arpejo suave, estilo iOS' },
    { nome: 'dong-dong', fn: dongDong, desc: 'Ding-dong — campainha de escola' },
    { nome: 'moderno', fn: moderno, desc: 'Swoosh + nota — Material Design' },
    { nome: 'xilofone', fn: xilofone, desc: 'Xilofone escolar — três notas alegres' },
];

console.log('🔊 Gerando sons de notificação...\n');

for (const s of sons) {
    const samples = s.fn();
    const wav = criarWav(samples);
    const arquivo = path.join(songDir, `${s.nome}.wav`);
    fs.writeFileSync(arquivo, wav);
    const kb = (wav.length / 1024).toFixed(1);
    console.log(`  ✅ ${s.nome}.wav (${kb} KB) — ${s.desc}`);
}

console.log(`\n🎵 ${sons.length} sons gerados na pasta song/`);
console.log('   Ouça cada um e escolha o favorito para usar como notificacao.mp3');
