/**
 * uploadChat.js — upload de anexos do chat interno.
 *
 * `uploadDocument` só aceita PDF/JPG/PNG porque nasceu para documentos de
 * aluno. O chat precisa de Word, Excel, PowerPoint, ZIP, vídeo e áudio
 * (audio/webm da gravação de voz), então tem o próprio filtro — sem afrouxar
 * o upload de documentos, que continua restrito.
 */
const multer = require('multer');

// Tipos aceitos no chat. Mantido explícito (lista branca) — nada de aceitar
// qualquer coisa e confiar na extensão.
const ALLOWED = new Set([
    // Imagens
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
    // Documentos
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/rtf',
    'text/plain',
    'text/csv',
    // Compactados
    'application/zip', 'application/x-zip-compressed',
    'application/x-rar-compressed', 'application/vnd.rar', 'application/x-7z-compressed',
    // Áudio (a gravação de voz do navegador sai como audio/webm)
    'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/mp4',
    'audio/wav', 'audio/x-wav', 'audio/aac',
    // Vídeo
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'
]);

// Extensão derivada do mimetype — o nome original do usuário nunca vira nome
// de arquivo no GridFS (evita path traversal e nomes executáveis).
const EXT_POR_MIME = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
    'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/rtf': '.rtf',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'application/zip': '.zip', 'application/x-zip-compressed': '.zip',
    'application/x-rar-compressed': '.rar', 'application/vnd.rar': '.rar',
    'application/x-7z-compressed': '.7z',
    'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav',
    'audio/x-wav': '.wav', 'audio/aac': '.aac',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv',
    'video/quicktime': '.mov'
};

const fileFilter = (req, file, cb) => {
    if (ALLOWED.has(String(file.mimetype).toLowerCase())) {
        cb(null, true);
    } else {
        cb(new Error('Formato de arquivo não permitido no chat.'), false);
    }
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
    fileFilter
});

module.exports = uploadChat;
module.exports.EXT_POR_MIME = EXT_POR_MIME;
module.exports.LIMITE_ARQUIVO = LIMITE_ARQUIVO;
module.exports.LIMITE_AUDIO = LIMITE_AUDIO;
module.exports.ALLOWED = ALLOWED;
