const multer = require('multer');

const ALLOWED = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png'
];

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Formatos permitidos: PDF, JPG ou PNG.'), false);
    }
};

const uploadDocument = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024, files: 10 },
    fileFilter
});

module.exports = uploadDocument;
