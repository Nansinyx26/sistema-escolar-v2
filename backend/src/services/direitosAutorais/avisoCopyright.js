/**
 * avisoCopyright.js — lê o aviso de direitos autorais que o próprio arquivo
 * declara.
 *
 * Banco de imagens, gravadora e loja de música gravam o titular dentro do
 * arquivo. É o sinal mais barato que existe: não depende de catálogo, e pega a
 * foto do Getty ou a faixa comprada na loja no primeiro envio.
 *
 *   Imagem: EXIF Copyright (0x8298), XMP `dc:rights` / `xmpRights:Marked`,
 *           IPTC CopyrightNotice (2:116).
 *   Áudio:  ID3v2 TCOP/WCOP (e TCR/WCP da v2.2), comentário Vorbis/Opus
 *           `COPYRIGHT=`, chunk RIFF `ICOP` (WAV) e átomo `cprt` (M4A).
 *
 * Só se lê o cabeçalho: nenhum desses campos mora no meio do fluxo de áudio.
 */
const sharp = require('sharp');

const JANELA_AUDIO = 256 * 1024;
const TAMANHO_MAX_TEXTO = 120;

function limpar(texto) {
    const limpo = String(texto || '')
        // biome-ignore lint/suspicious/noControlCharactersInRegex: remove bytes de controle do texto vindo do arquivo
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return limpo.slice(0, TAMANHO_MAX_TEXTO);
}

// ── Imagem ───────────────────────────────────────────────────────────────────

/** Tag Copyright (0x8298) do IFD0 de um bloco EXIF/TIFF. */
function copyrightDoExif(exif) {
    if (!Buffer.isBuffer(exif) || exif.length < 14) return null;
    let base = 0;
    if (exif.toString('latin1', 0, 6) === 'Exif\u0000\u0000') base = 6;

    const ordem = exif.toString('latin1', base, base + 2);
    if (ordem !== 'II' && ordem !== 'MM') return null;
    const le = ordem === 'II';
    const u16 = (pos) => (le ? exif.readUInt16LE(pos) : exif.readUInt16BE(pos));
    const u32 = (pos) => (le ? exif.readUInt32LE(pos) : exif.readUInt32BE(pos));

    try {
        const ifd0 = base + u32(base + 4);
        const entradas = u16(ifd0);
        for (let i = 0; i < entradas; i++) {
            const entrada = ifd0 + 2 + i * 12;
            if (u16(entrada) !== 0x8298) continue;
            const quantidade = u32(entrada + 4);
            const inicio = quantidade <= 4 ? entrada + 8 : base + u32(entrada + 8);
            const texto = limpar(exif.toString('latin1', inicio, inicio + quantidade));
            return texto || null;
        }
    } catch {
        // EXIF truncado: o offset aponta para fora do bloco. Sem aviso legível.
    }
    return null;
}

function copyrightDoXmp(xmp) {
    if (!xmp) return null;
    const texto = Buffer.isBuffer(xmp) ? xmp.toString('utf8') : String(xmp);

    const direitos = texto.match(/<dc:rights>[\s\S]*?<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i);
    if (direitos && limpar(direitos[1])) return limpar(direitos[1]);

    if (
        /xmpRights:Marked\s*=\s*["']True["']/i.test(texto) ||
        /<xmpRights:Marked>\s*True\s*</i.test(texto)
    ) {
        return 'obra marcada como protegida (XMP)';
    }
    return null;
}

/** Dataset 2:116 (CopyrightNotice) do IPTC-IIM. */
function copyrightDoIptc(iptc) {
    if (!Buffer.isBuffer(iptc)) return null;
    for (let i = 0; i + 5 <= iptc.length; i++) {
        if (iptc[i] === 0x1c && iptc[i + 1] === 0x02 && iptc[i + 2] === 0x74) {
            const tamanho = iptc.readUInt16BE(i + 3);
            const texto = limpar(iptc.toString('utf8', i + 5, i + 5 + tamanho));
            if (texto) return texto;
        }
    }
    return null;
}

async function avisoEmImagem(buffer) {
    const meta = await sharp(buffer, { failOn: 'none' })
        .metadata()
        .catch(() => null);
    if (!meta) return null;

    const exif = copyrightDoExif(meta.exif);
    if (exif) return { fonte: 'EXIF', texto: exif };
    const xmp = copyrightDoXmp(meta.xmp);
    if (xmp) return { fonte: 'XMP', texto: xmp };
    const iptc = copyrightDoIptc(meta.iptc);
    if (iptc) return { fonte: 'IPTC', texto: iptc };
    return null;
}

// ── Áudio ────────────────────────────────────────────────────────────────────

function decodificarTextoId3(dados) {
    if (dados.length === 0) return '';
    const codificacao = dados[0];
    const corpo = dados.subarray(1);
    if (codificacao === 1) {
        // UTF-16 com BOM
        if (corpo[0] === 0xfe && corpo[1] === 0xff) {
            return Buffer.from(corpo.subarray(2)).swap16().toString('utf16le');
        }
        return corpo.subarray(corpo[0] === 0xff ? 2 : 0).toString('utf16le');
    }
    if (codificacao === 2)
        return Buffer.from(corpo.subarray(0, corpo.length & ~1))
            .swap16()
            .toString('utf16le');
    if (codificacao === 3) return corpo.toString('utf8');
    return corpo.toString('latin1');
}

function copyrightDoId3(buffer) {
    if (buffer.length < 10 || buffer.toString('latin1', 0, 3) !== 'ID3') return null;
    const versao = buffer[3];
    const tamanhoTag =
        ((buffer[6] & 0x7f) << 21) |
        ((buffer[7] & 0x7f) << 14) |
        ((buffer[8] & 0x7f) << 7) |
        (buffer[9] & 0x7f);
    const fimTag = Math.min(buffer.length, 10 + tamanhoTag);

    const v22 = versao === 2;
    const cabecalho = v22 ? 6 : 10;
    const idTamanho = v22 ? 3 : 4;
    let pos = 10;

    while (pos + cabecalho <= fimTag) {
        const id = buffer.toString('latin1', pos, pos + idTamanho);
        if (!/^[A-Z0-9]+$/.test(id)) break; // chegou ao preenchimento

        let tamanho;
        if (v22) tamanho = buffer.readUIntBE(pos + 3, 3);
        else if (versao === 4)
            tamanho =
                ((buffer[pos + 4] & 0x7f) << 21) |
                ((buffer[pos + 5] & 0x7f) << 14) |
                ((buffer[pos + 6] & 0x7f) << 7) |
                (buffer[pos + 7] & 0x7f);
        else tamanho = buffer.readUInt32BE(pos + 4);

        const dados = buffer.subarray(pos + cabecalho, Math.min(fimTag, pos + cabecalho + tamanho));
        if (id === 'TCOP' || id === 'TCR') {
            const texto = limpar(decodificarTextoId3(dados));
            if (texto) return texto;
        }
        if (id === 'WCOP' || id === 'WCP') {
            const texto = limpar(dados.toString('latin1'));
            if (texto) return texto;
        }
        pos += cabecalho + tamanho;
    }
    return null;
}

function copyrightDoVorbis(janela) {
    const texto = janela.toString('latin1');
    const achado = texto.match(/COPYRIGHT=([\x20-\x7e -ÿ]{1,200})/i);
    return achado ? limpar(achado[1]) || null : null;
}

function copyrightDoRiff(janela) {
    if (janela.toString('latin1', 0, 4) !== 'RIFF') return null;
    const pos = janela.indexOf('ICOP', 12, 'latin1');
    if (pos < 0 || pos + 8 > janela.length) return null;
    const tamanho = janela.readUInt32LE(pos + 4);
    return limpar(janela.toString('latin1', pos + 8, pos + 8 + tamanho)) || null;
}

function copyrightDoMp4(janela) {
    const pos = janela.indexOf('cprt', 0, 'latin1');
    if (pos < 0) return null;
    // iTunes: cprt > data (tamanho, 'data', tipo, locale, texto)
    const data = janela.indexOf('data', pos, 'latin1');
    if (data < 0 || data - pos > 16 || data < 4) return null;
    const tamanho = janela.readUInt32BE(data - 4);
    return limpar(janela.toString('utf8', data + 12, data - 4 + tamanho)) || null;
}

function avisoEmAudio(buffer) {
    const id3 = copyrightDoId3(buffer);
    if (id3) return { fonte: 'ID3', texto: id3 };

    const janela = buffer.subarray(0, JANELA_AUDIO);
    const riff = copyrightDoRiff(janela);
    if (riff) return { fonte: 'RIFF', texto: riff };
    const mp4 = copyrightDoMp4(janela);
    if (mp4) return { fonte: 'MP4', texto: mp4 };
    const vorbis = copyrightDoVorbis(janela);
    if (vorbis) return { fonte: 'Vorbis', texto: vorbis };
    return null;
}

/**
 * @returns {Promise<{ fonte: string, texto: string } | null>}
 */
async function detectarAvisoCopyright(buffer, midia) {
    if (!Buffer.isBuffer(buffer)) return null;
    if (midia === 'imagem') return avisoEmImagem(buffer);
    if (midia === 'audio') return avisoEmAudio(buffer);
    return null;
}

module.exports = {
    detectarAvisoCopyright,
    copyrightDoXmp,
    copyrightDoIptc,
};
