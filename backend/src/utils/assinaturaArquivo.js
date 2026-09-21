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
 * Desde a Issue #415, duas famílias são barradas por si: arquivo compactado
 * (ZIP, RAR, 7z) e documento capaz de carregar macro — o Office antigo (OLE2)
 * e o pacote moderno que traz peça de VBA dentro. Como `.docx` também é ZIP,
 * não dá para decidir pelos quatro primeiros bytes: o índice do pacote é lido
 * em `utils/pacoteOoxml.js` para separar documento de compactado.
 *
 * Sem dependência nova de propósito: `file-type` moderno é ESM puro e este
 * backend é CommonJS. A lista abaixo cobre exatamente os tipos que o chat
 * aceita (ver middleware/uploadChat.js) — nada além disso precisa ser detectado.
 */

const { inspecionarZip } = require('./pacoteOoxml');

/** Compara `bytes` com o início do buffer a partir de `offset`. */
function comeca(buf, bytes, offset = 0) {
    if (!buf || buf.length < offset + bytes.length) return false;
    return bytes.every((b, i) => b === null || buf[offset + i] === b);
}

const ascii = (txt) => Array.from(txt, (c) => c.charCodeAt(0));

// Detectores por FAMÍLIA. Vários mimetypes compartilham a mesma assinatura
// (docx/xlsx/pptx são todos ZIP; mp4/m4a/mov são todos ISO-BMFF).
const FAMILIAS = {
    jpeg: (b) => comeca(b, [0xff, 0xd8, 0xff]),
    png: (b) => comeca(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    gif: (b) => comeca(b, ascii('GIF8')),
    bmp: (b) => comeca(b, ascii('BM')),
    webp: (b) => comeca(b, ascii('RIFF')) && comeca(b, ascii('WEBP'), 8),
    pdf: (b) => comeca(b, ascii('%PDF')),
    // ZIP cobre os formatos Office modernos (docx/xlsx/pptx) e .zip puro.
    zip: (b) =>
        comeca(b, [0x50, 0x4b, 0x03, 0x04]) ||
        comeca(b, [0x50, 0x4b, 0x05, 0x06]) ||
        comeca(b, [0x50, 0x4b, 0x07, 0x08]),
    // OLE2 (Compound File): doc/xls/ppt do Office antigo.
    ole2: (b) => comeca(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    rar: (b) => comeca(b, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]),
    sevenzip: (b) => comeca(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]),
    rtf: (b) => comeca(b, ascii('{\\rtf')),
    ogg: (b) => comeca(b, ascii('OggS')),
    wav: (b) => comeca(b, ascii('RIFF')) && comeca(b, ascii('WAVE'), 8),
    // EBML — contêiner de webm (áudio e vídeo) e mkv.
    ebml: (b) => comeca(b, [0x1a, 0x45, 0xdf, 0xa3]),
    // ISO-BMFF: 4 bytes de tamanho + 'ftyp'. Cobre mp4, m4a e mov.
    isobmff: (b) => comeca(b, ascii('ftyp'), 4),
    // MP3: tag ID3 ou frame MPEG cru.
    mp3: (b) =>
        comeca(b, ascii('ID3')) || (b.length > 1 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
    // AAC em ADTS.
    aac: (b) => b.length > 1 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0,
};

// mimetype declarado → famílias aceitáveis para ele.
const FAMILIAS_POR_MIME = {
    'image/jpeg': ['jpeg'],
    'image/jpg': ['jpeg'],
    'image/png': ['png'],
    'image/gif': ['gif'],
    'image/webp': ['webp'],
    'image/bmp': ['bmp'],

    'application/pdf': ['pdf'],
    'application/rtf': ['rtf'],

    // Office moderno é ZIP — e só ele. O fallback para OLE2 saiu com a #415:
    // aceitar o formato antigo era aceitar o contêiner de macro, e o mesmo
    // arquivo salvo como `x` (docx/xlsx/pptx) passa sem perder nada.
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['zip'],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['zip'],
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['zip'],

    'audio/webm': ['ebml'],
    'audio/ogg': ['ogg'],
    'audio/mpeg': ['mp3'],
    'audio/mp3': ['mp3'],
    'audio/mp4': ['isobmff'],
    'audio/wav': ['wav'],
    'audio/x-wav': ['wav'],
    'audio/aac': ['aac', 'mp3'],

    'video/mp4': ['isobmff'],
    'video/webm': ['ebml'],
    'video/ogg': ['ogg'],
    'video/quicktime': ['isobmff'],
};

// Texto puro não tem assinatura. Em vez de liberar sem checagem (o que deixaria
// qualquer binário passar declarando text/plain), exigimos que o conteúdo se
// comporte como texto: sem byte nulo e sem assinatura de binário conhecido.
const MIMES_TEXTO = new Set(['text/plain', 'text/csv']);

/** Assinaturas explicitamente barradas, mesmo que o mimetype declare outra coisa. */
const EXECUTAVEIS = [
    { nome: 'executável Windows (MZ/PE)', teste: (b) => comeca(b, ascii('MZ')) },
    { nome: 'executável Linux (ELF)', teste: (b) => comeca(b, [0x7f, 0x45, 0x4c, 0x46]) },
    {
        nome: 'executável macOS (Mach-O)',
        teste: (b) => comeca(b, [0xcf, 0xfa, 0xed, 0xfe]) || comeca(b, [0xce, 0xfa, 0xed, 0xfe]),
    },
    { nome: 'classe Java', teste: (b) => comeca(b, [0xca, 0xfe, 0xba, 0xbe]) },
    { nome: 'script com shebang', teste: (b) => comeca(b, ascii('#!')) },
];

/**
 * Assinaturas recusadas pelo que são, independentemente do tipo declarado
 * (Issue #415). O texto diz o que enviar no lugar: recusar sem alternativa
 * empurra a pessoa para o WhatsApp, e aí o arquivo sai do controle da escola.
 */
const BARRADOS_POR_ASSINATURA = [
    {
        teste: (b) => FAMILIAS.rar(b),
        motivo: 'arquivo compactado (RAR) não é aceito no envio. Envie cada arquivo separadamente — PDF, imagem ou documento do Office sem macro.',
    },
    {
        teste: (b) => FAMILIAS.sevenzip(b),
        motivo: 'arquivo compactado (7z) não é aceito no envio. Envie cada arquivo separadamente — PDF, imagem ou documento do Office sem macro.',
    },
    {
        // OLE2 é o contêiner do Office antigo (.doc/.xls/.ppt), que guarda
        // macro no próprio arquivo. O mesmo documento salvo como .docx/.xlsx
        // passa — o formato novo separa a macro num arquivo `m`, que também é
        // recusado adiante.
        teste: (b) => FAMILIAS.ole2(b),
        motivo: 'documento do Office antigo (.doc, .xls, .ppt) não é aceito porque pode conter macro. Salve como .docx, .xlsx ou .pptx, ou envie em PDF.',
    },
];

/**
 * Veredito para buffer com assinatura de ZIP. `.docx` e um `.zip` qualquer
 * começam com os mesmos quatro bytes, então quem decide é o índice do pacote.
 */
function vereditoDeZip(buffer) {
    const { tipo } = inspecionarZip(buffer);
    if (tipo === 'compactado') {
        return {
            ok: false,
            motivo: 'arquivo compactado (ZIP) não é aceito no envio. Envie cada arquivo separadamente — PDF, imagem ou documento do Office sem macro.',
        };
    }
    if (tipo === 'office-com-macro') {
        return {
            ok: false,
            motivo: 'documento com macro (.docm, .xlsm, .pptm) não é aceito. Salve como .docx, .xlsx ou .pptx, ou envie em PDF.',
        };
    }
    if (tipo === 'ilegivel') {
        // Não conseguir ler o índice significa não conseguir provar que não há
        // macro. Recusar é a resposta segura — o arquivo salvo de novo pelo
        // Office passa.
        return {
            ok: false,
            motivo: 'não foi possível verificar o conteúdo do documento. Salve novamente como .docx, .xlsx ou .pptx, ou envie em PDF.',
        };
    }
    return { ok: true };
}

function pareceTexto(buf) {
    // Só o começo importa: um binário disfarçado denuncia-se logo.
    const amostra = buf.subarray(0, 4096);
    if (amostra.includes(0x00)) return false;
    // Bytes de controle fora de \t \n \r indicam binário.
    for (const byte of amostra) {
        if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) return false;
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

    // Compactado e documento com macro são barrados pelo conteúdo, não pelo
    // rótulo: renomear .zip para .pdf não ajuda em nada (Issue #415).
    for (const barrado of BARRADOS_POR_ASSINATURA) {
        if (barrado.teste(buffer)) {
            return { ok: false, motivo: barrado.motivo[0].toUpperCase() + barrado.motivo.slice(1) };
        }
    }

    if (FAMILIAS.zip(buffer)) {
        const veredito = vereditoDeZip(buffer);
        if (!veredito.ok) {
            return {
                ok: false,
                motivo: veredito.motivo[0].toUpperCase() + veredito.motivo.slice(1),
            };
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
            motivo: 'O conteúdo do arquivo não corresponde ao tipo informado.',
        };
    }

    return { ok: true };
}

module.exports = { validarAssinatura, pareceTexto };
