/**
 * uploadChat.js — upload de anexos do chat interno.
 *
 * `uploadDocument` só aceita PDF/JPG/PNG porque nasceu para documentos de
 * aluno. O chat precisa de Word, Excel, PowerPoint, vídeo e áudio
 * (audio/webm da gravação de voz), então tem o próprio filtro — sem afrouxar
 * o upload de documentos, que continua restrito.
 *
 * O que NÃO entra (Issue #415): arquivo compactado e documento capaz de
 * carregar macro. Não há antivírus no caminho, e o anexo é baixado do outro
 * lado por uma família ou por quem trabalha na escola: o compactado esconde o
 * que vai dentro do único filtro que existe, e a macro executa na máquina de
 * quem abre. Aqui o rótulo é barrado; o conteúdo é conferido byte a byte em
 * `utils/assinaturaArquivo.js`, que é o que pega o `.zip` renomeado.
 */
const multer = require('multer');

// Tipos aceitos no chat. Mantido explícito (lista branca) — nada de aceitar
// qualquer coisa e confiar na extensão.
const ALLOWED = new Set([
    // Imagens
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    // Documentos
    'application/pdf',
    // Só o Office moderno: o antigo (.doc/.xls/.ppt) guarda macro no próprio
    // arquivo e saiu da lista com a #415.
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/rtf',
    'text/plain',
    'text/csv',
    // Áudio (a gravação de voz do navegador sai como audio/webm)
    'audio/webm',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/wav',
    'audio/x-wav',
    'audio/aac',
    // Vídeo
    'video/mp4',
    'video/webm',
    'video/ogg',
    'video/quicktime',
]);

// Extensão derivada do mimetype — o nome original do usuário nunca vira nome
// de arquivo no GridFS (evita path traversal e nomes executáveis).
const EXT_POR_MIME = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'application/pdf': '.pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/rtf': '.rtf',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/mp4': '.m4a',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/aac': '.aac',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/ogg': '.ogv',
    'video/quicktime': '.mov',
};

// Tipos que a pessoa tenta enviar com frequência e que têm resposta própria:
// dizer só "formato não permitido" para um ZIP deixa a pessoa procurando o que
// fez de errado. Mapa de mimetype → o que fazer no lugar.
const RECUSADOS_COM_EXPLICACAO = new Map([
    ['application/zip', 'compactado'],
    ['application/x-zip-compressed', 'compactado'],
    ['application/x-rar-compressed', 'compactado'],
    ['application/vnd.rar', 'compactado'],
    ['application/x-7z-compressed', 'compactado'],
    ['application/gzip', 'compactado'],
    ['application/x-tar', 'compactado'],
    ['application/x-gzip', 'compactado'],
    ['application/msword', 'office-antigo'],
    ['application/vnd.ms-excel', 'office-antigo'],
    ['application/vnd.ms-powerpoint', 'office-antigo'],
    ['application/vnd.ms-word.document.macroenabled.12', 'macro'],
    ['application/vnd.ms-word.template.macroenabled.12', 'macro'],
    ['application/vnd.ms-excel.sheet.macroenabled.12', 'macro'],
    ['application/vnd.ms-excel.template.macroenabled.12', 'macro'],
    ['application/vnd.ms-excel.addin.macroenabled.12', 'macro'],
    ['application/vnd.ms-excel.sheet.binary.macroenabled.12', 'macro'],
    ['application/vnd.ms-powerpoint.presentation.macroenabled.12', 'macro'],
    ['application/vnd.ms-powerpoint.slideshow.macroenabled.12', 'macro'],
]);

const MENSAGEM_POR_MOTIVO = {
    compactado:
        'Arquivo compactado (ZIP, RAR ou 7z) não é aceito no chat. Envie cada arquivo separadamente — PDF, imagem ou documento do Office sem macro.',
    'office-antigo':
        'Documento do Office antigo (.doc, .xls, .ppt) não é aceito porque pode conter macro. Salve como .docx, .xlsx ou .pptx, ou envie em PDF.',
    macro: 'Documento com macro (.docm, .xlsm, .pptm) não é aceito no chat. Salve como .docx, .xlsx ou .pptx, ou envie em PDF.',
};

const fileFilter = (req, file, cb) => {
    const mime = String(file.mimetype).toLowerCase();
    if (ALLOWED.has(mime)) {
        return cb(null, true);
    }

    const motivo = RECUSADOS_COM_EXPLICACAO.get(mime);
    return cb(
        new Error(
            motivo
                ? MENSAGEM_POR_MOTIVO[motivo]
                : 'Formato de arquivo não permitido no chat. Envie PDF, imagem, vídeo, áudio ou documento do Office sem macro (.docx, .xlsx, .pptx).'
        ),
        false
    );
};

// 10 MB por arquivo. O teto anterior (25 MB) × 5 arquivos permitia 125 MB numa
// requisição só, tudo carregado em memória (memoryStorage) antes de ir para o
// GridFS — num plano pequeno do Render isso derruba o processo.
const LIMITE_ARQUIVO = 10 * 1024 * 1024;
// Áudio de voz tem teto próprio e menor: 5 minutos de gravação do navegador
// ficam bem abaixo disso, então passar de 5 MB indica arquivo indevido.
const LIMITE_AUDIO = 5 * 1024 * 1024;

const uploadChat = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: LIMITE_ARQUIVO, files: 5 },
    fileFilter,
});

module.exports = uploadChat;
module.exports.EXT_POR_MIME = EXT_POR_MIME;
module.exports.LIMITE_ARQUIVO = LIMITE_ARQUIVO;
module.exports.LIMITE_AUDIO = LIMITE_AUDIO;
module.exports.ALLOWED = ALLOWED;
module.exports.RECUSADOS_COM_EXPLICACAO = RECUSADOS_COM_EXPLICACAO;
module.exports.MENSAGEM_POR_MOTIVO = MENSAGEM_POR_MOTIVO;
