const multer = require('multer');
const sharp = require('sharp');
require('dotenv').config();

// Use memory storage to get access to buffer for WebP conversion
const storage = multer.memoryStorage();

// Custom file filter to only accept images
const fileFilter = (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Apenas imagens são permitidas!'), false);
    }
};

// Configure multer with limits and file filter
const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB max file size
        files: 1 // 1 file at a time
    },
    fileFilter
});

// Middleware to convert uploaded image to WebP
const convertToWebP = async (req, res, next) => {
    if (!req.file) {
        return next();
    }

    try {
        // Convert the uploaded file buffer to WebP
        const webpBuffer = await sharp(req.file.buffer)
            .webp({ quality: 80 })
            .toBuffer();

        // Update req.file with converted data
        req.file.buffer = webpBuffer;
        req.file.mimetype = 'image/webp';
        req.file.size = webpBuffer.length;
        req.file.originalname = req.file.originalname.replace(/\.[^.]+$/, '.webp');

        next();
    } catch (error) {
        console.error('Erro ao converter imagem para WebP:', error);
        next(error);
    }
};

module.exports = upload;
module.exports.convertToWebP = convertToWebP;
