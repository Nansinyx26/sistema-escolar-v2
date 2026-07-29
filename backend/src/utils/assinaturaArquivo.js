/**
 * assinaturaArquivo.js — valida o tipo REAL do arquivo pelos primeiros bytes.
 *
 * PROBLEMA QUE ISTO RESOLVE
 * -------------------------
 * O `fileFilter` do multer só olha `file.mimetype`, que vem do header
 * Content-Type enviado pelo CLIENTE. Renomear `payload.exe` para `nota.pdf` e
 * declarar `application/pdf` passava direto pela lista branca: o arquivo era
 * gravado no GridFS e servido depois para o outro participante da conversa.
 *
 * Aqui o buffer é inspecionado de fato. Se a assinatura não corresponder à
 * família do mimetype declarado, o upload é recusado.
 *
 * Sem dependência nova de propósito: `file-type` moderno é ESM puro e este
 * backend é CommonJS. A lista abaixo cobre exatamente os tipos que o chat
 * aceita (ver middleware/uploadChat.js) — nada além disso precisa ser detectado.
 */

/** Compara `bytes` com o início do buffer a partir de `offset`. */
function comeca(buf, bytes, offset = 0) {
    if (!buf || buf.length < offset + bytes.length) return false;
    return bytes.every((b, i) => b === null || buf[offset + i] === b);
}

const ascii = (txt) => Array.from(txt, (c) => c.charCodeAt(0));

// Detectores por FAMÍLIA. Vários mimetypes compartilham a mesma assinatura
// (docx/xlsx/pptx são todos ZIP; mp4/m4a/mov são todos ISO-BMFF).
const FAMILIAS = {
    jpeg: (b) => comeca(b, [0xFF, 0xD8, 0xFF]),
    png: (b) => comeca(b, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    gif: (b) => comeca(b, ascii('GIF8')),
    bmp: (b) => comeca(b, ascii('BM')),
    webp: (b) => comeca(b, ascii('RIFF')) && comeca(b, ascii('WEBP'), 8),
    pdf: (b) => comeca(b, ascii('%PDF')),
    // ZIP cobre os formatos Office modernos (docx/xlsx/pptx) e .zip puro.
    zip: (b) => comeca(b, [0x50, 0x4B, 0x03, 0x04])
        || comeca(b, [0x50, 0x4B, 0x05, 0x06])
        || comeca(b, [0x50, 0x4B, 0x07, 0x08]),
    // OLE2 (Compound File): doc/xls/ppt do Office antigo.
    ole2: (b) => comeca(b, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]),
    rar: (b) => comeca(b, [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07]),
    sevenzip: (b) => comeca(b, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]),
    rtf: (b) => comeca(b, ascii('{\\rtf')),
    ogg: (b) => comeca(b, ascii('OggS')),
    wav: (b) => comeca(b, ascii('RIFF')) && comeca(b, ascii('WAVE'), 8),
    // EBML — contêiner de webm (áudio e vídeo) e mkv.
    ebml: (b) => comeca(b, [0x1A, 0x45, 0xDF, 0xA3]),
    // ISO-BMFF: 4 bytes de tamanho + 'ftyp'. Cobre mp4, m4a e mov.
    isobmff: (b) => comeca(b, ascii('ftyp'), 4),
    // MP3: tag ID3 ou frame MPEG cru.
    mp3: (b) => comeca(b, ascii('ID3'))
        || (b.length > 1 && b[0] === 0xFF && (b[1] & 0xE0) === 0xE0),
    // AAC em ADTS.
    aac: (b) => b.length > 1 && b[0] === 0xFF && (b[1] & 0xF6) === 0xF0
};

// mimetype declarado → famílias aceitáveis para ele.
const FAMILIAS_POR_MIME = {
    'image/jpeg': ['jpeg'], 'image/jpg': ['jpeg'],
    'image/png': ['png'],
    'image/gif': ['gif'],
    'image/webp': ['webp'],
    'image/bmp': ['bmp'],

    'application/pdf': ['pdf'],
    'application/rtf': ['rtf'],

    // Office moderno é ZIP; o antigo é OLE2. Aceitar ambos evita recusar um
    // .doc legítimo que o navegador rotulou como docx (acontece).
    'application/msword': ['ole2', 'zip'],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['zip', 'ole2'],
    'application/vnd.ms-excel': ['ole2', 'zip'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['zip', 'ole2'],
    'application/vnd.ms-powerpoint': ['ole2', 'zip'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['zip', 'ole2'],

    'application/zip': ['zip'], 'application/x-zip-compressed': ['zip'],
    'application/x-rar-compressed': ['rar'], 'application/vnd.rar': ['rar'],
    'application/x-7z-compressed': ['sevenzip'],

    'audio/webm': ['ebml'],
    'audio/ogg': ['ogg'],
    'audio/mpeg': ['mp3'], 'audio/mp3': ['mp3'],
    'audio/mp4': ['isobmff'],
    'audio/wav': ['wav'], 'audio/x-wav': ['wav'],
    'audio/aac': ['aac', 'mp3'],

    'video/mp4': ['isobmff'],
    'video/webm': ['ebml'],
    'video/ogg': ['ogg'],
    'video/quicktime': ['isobmff']
};

// Texto puro não tem assinatura. Em vez de liberar sem checagem (o que deixaria
// qualquer binário passar declarando text/plain), exigimos que o conteúdo se
// comporte como texto: sem byte nulo e sem assinatura de binário conhecido.
const MIMES_TEXTO = new Set(['text/plain', 'text/csv']);

/** Assinaturas explicitamente barradas, mesmo que o mimetype declare outra coisa. */
const EXECUTAVEIS = [
    { nome: 'executável Windows (MZ/PE)', teste: (b) => comeca(b, ascii('MZ')) },
    { nome: 'executável Linux (ELF)', teste: (b) => comeca(b, [0x7F, 0x45, 0x4C, 0x46]) },
    { nome: 'executável macOS (Mach-O)', teste: (b) => comeca(b, [0xCF, 0xFA, 0xED, 0xFE]) || comeca(b, [0xCE, 0xFA, 0xED, 0xFE]) },
    { nome: 'classe Java', teste: (b) => comeca(b, [0xCA, 0xFE, 0xBA, 0xBE]) },
    { nome: 'script com shebang', teste: (b) => comeca(b, ascii('#!')) }
];

function pareceTexto(buf) {
    // Só o começo importa: um binário disfarçado denuncia-se logo.
    const amostra = buf.subarray(0, 4096);
    if (amostra.includes(0x00)) return false;
    // Bytes de controle fora de \t \n \r indicam binário.
    for (const byte of amostra) {
        if (byte < 0x09 || (byte > 0x0D && byte < 0x20)) return false;
    }
    return true;
}

/**
 * Verifica se o conteúdo confere com o mimetype declarado.
 *
 * @param {Buffer} buffer conteúdo do arquivo (multer memoryStorage)
 * @param {string} mimetypeDeclarado o que o cliente afirmou ser
 * @returns {{ok: boolean, motivo?: string}}
 */
function validarAssinatura(buffer, mimetypeDeclarado) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return { ok: false, motivo: 'Arquivo vazio ou ilegível.' };
    }

    const mime = String(mimetypeDeclarado || '').toLowerCase();

    // Barreira dura: executável nunca passa, declare o que declarar.
    for (const exe of EXECUTAVEIS) {
        if (exe.teste(buffer)) {
            return { ok: false, motivo: `Conteúdo identificado como ${exe.nome} — não permitido.` };
        }
    }

    if (MIMES_TEXTO.has(mime)) {
        return pareceTexto(buffer)
            ? { ok: true }
            : { ok: false, motivo: 'O arquivo foi enviado como texto, mas o conteúdo é binário.' };
    }

    const familias = FAMILIAS_POR_MIME[mime];
    if (!familias) {
        // Mimetype fora do mapa não deveria chegar aqui (o fileFilter já
        // bloqueia), mas negar é a resposta segura.
        return { ok: false, motivo: 'Tipo de arquivo não reconhecido.' };
    }

    const confere = familias.some((f) => FAMILIAS[f] && FAMILIAS[f](buffer));
    if (!confere) {
        return {
            ok: false,
            motivo: 'O conteúdo do arquivo não corresponde ao tipo informado.'
        };
    }

    return { ok: true };
}

module.exports = { validarAssinatura, pareceTexto };
