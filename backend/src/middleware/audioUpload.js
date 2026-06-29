const multer = require('multer');
require('dotenv').config();

// Armazenamento em memória para envio ao GridFS
const storage = multer.memoryStorage();

// Filtro para aceitar apenas arquivos de áudio
const fileFilter = (req, file, cb) => {
    const allowedMimes = [
        'audio/mpeg',
        'audio/mp3',
        'audio/wav',
        'audio/ogg',
        'audio/webm',
        'audio/x-m4a',
        'audio/m4a'
    ];

    if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
        cb(null, true);
    } else {
        cb(new Error('Apenas arquivos de áudio são permitidos!'), false);
    }
};

const audioUpload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB max (suficiente para mensagens de voz)
        files: 1
    },
    fileFilter
});

module.exports = audioUpload;
