/**
 * impressaoDigital.js — a identidade de uma imagem ou de um áudio.
 *
 * Três impressões, cada uma pegando um disfarce diferente:
 *
 *   - `sha256`: os bytes exatos. Pega a cópia idêntica e nada mais — um único
 *     byte trocado já produz outro valor.
 *   - `conteudoHash` (só áudio): SHA-256 do áudio SEM as etiquetas ID3. Trocar
 *     o título ou o artista de um MP3 muda os bytes do arquivo, mas não o som;
 *     sem isto, re-etiquetar a música bastaria para passar pelo catálogo.
 *   - `phash` (só imagem): dHash de 64 bits. A imagem é reduzida a 9×8 em tons
 *     de cinza e cada bit diz se um pixel é mais claro que o vizinho. Mudar o
 *     tamanho, recomprimir o JPEG ou converter para WebP mexe pouco nesse
 *     desenho, então a distância de Hamming entre as duas versões fica baixa.
 *
 * Não há impressão acústica (Chromaprint): exige binário nativo e decodificar
 * o áudio, custo que o plano do Render não comporta no caminho do upload.
 */
const crypto = require('node:crypto');
const sharp = require('sharp');

// Até quantos bits (de 64) duas imagens podem diferir e ainda serem a mesma
// obra. Reduzir à metade e recomprimir em WebP custa de 6 a 9 bits; imagens
// diferentes ficam acima de 20. Um falso positivo impede um professor de
// enviar a própria foto, então a régua fica perto do disfarce, não do meio.
const LIMIAR_HAMMING = 10;

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function midiaDe(mimetype) {
    const mime = String(mimetype || '').toLowerCase();
    if (mime.startsWith('image/')) return 'imagem';
    if (mime.startsWith('audio/')) return 'audio';
    return null;
}

/**
 * Remove a etiqueta ID3v2 do início e a ID3v1 do fim. O que sobra é o fluxo
 * de áudio. Arquivo sem ID3 volta intacto.
 */
function semEtiquetasId3(buffer) {
    let inicio = 0;
    let fim = buffer.length;

    if (buffer.length >= 10 && buffer.toString('latin1', 0, 3) === 'ID3') {
        // Tamanho "syncsafe": 4 bytes de 7 bits cada.
        const tamanho =
            ((buffer[6] & 0x7f) << 21) |
            ((buffer[7] & 0x7f) << 14) |
            ((buffer[8] & 0x7f) << 7) |
            (buffer[9] & 0x7f);
        const temRodape = (buffer[5] & 0x10) !== 0;
        inicio = Math.min(buffer.length, 10 + tamanho + (temRodape ? 10 : 0));
    }

    if (fim - inicio >= 128 && buffer.toString('latin1', fim - 128, fim - 125) === 'TAG') {
        fim -= 128;
    }

    return buffer.subarray(inicio, fim);
}

// Diferença mínima de brilho para o bit valer 1. Em área lisa os vizinhos são
// praticamente iguais, e a recompressão os faz oscilar ±1 para lá e para cá:
// comparar com `<` puro virava moeda jogada a cada JPEG. Com a margem, área
// lisa dá 0 de forma estável.
const MARGEM_RUIDO = 2;

async function dHash(buffer) {
    const pixels = await sharp(buffer, { failOn: 'none' })
        .grayscale()
        .resize(9, 8, { fit: 'fill' })
        .raw()
        .toBuffer();

    let hash = 0n;
    for (let linha = 0; linha < 8; linha++) {
        for (let coluna = 0; coluna < 8; coluna++) {
            const aqui = pixels[linha * 9 + coluna];
            const vizinho = pixels[linha * 9 + coluna + 1];
            hash = (hash << 1n) | (vizinho - aqui > MARGEM_RUIDO ? 1n : 0n);
        }
    }
    return hash.toString(16).padStart(16, '0');
}

function distanciaHamming(a, b) {
    let diferenca = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
    let bits = 0;
    while (diferenca) {
        bits += Number(diferenca & 1n);
        diferenca >>= 1n;
    }
    return bits;
}

/**
 * Imagem lisa (uma cor só, ou degradê suave) gera hash com quase todos os bits
 * iguais — e todas as imagens lisas ficam parecidas entre si. Comparar essas
 * por aproximação bloquearia qualquer fundo branco; só a cópia exata vale.
 */
function phashInformativo(phash) {
    if (!phash) return false;
    const uns = distanciaHamming(phash, '0000000000000000');
    return uns >= 4 && uns <= 60;
}

/**
 * @returns {Promise<{ midia: 'imagem'|'audio', sha256: string,
 *   conteudoHash: string|null, phash: string|null } | null>}
 *   null quando o tipo não é imagem nem áudio.
 */
async function calcularImpressao(buffer, mimetype) {
    const midia = midiaDe(mimetype);
    if (!midia || !Buffer.isBuffer(buffer)) return null;

    const impressao = { midia, sha256: sha256(buffer), conteudoHash: null, phash: null };

    if (midia === 'audio') {
        impressao.conteudoHash = sha256(semEtiquetasId3(buffer));
    } else {
        // Imagem que o sharp não decodifica (corrompida, formato exótico) fica
        // só com o SHA-256: a cópia exata continua sendo pega.
        impressao.phash = await dHash(buffer).catch(() => null);
    }

    return impressao;
}

module.exports = {
    LIMIAR_HAMMING,
    calcularImpressao,
    distanciaHamming,
    phashInformativo,
    midiaDe,
};
