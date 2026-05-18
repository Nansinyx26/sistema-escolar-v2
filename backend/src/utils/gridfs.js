const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

let bucket;

/**
 * Inicializa o bucket do GridFS usando a conexão existente do Mongoose
 */
const initBucket = () => {
    if (!bucket) {
        bucket = new GridFSBucket(mongoose.connection.db, {
            bucketName: 'uploads'
        });
    }
    return bucket;
};

/**
 * Salva um buffer no GridFS
 * @param {Buffer} buffer - Conteúdo do arquivo
 * @param {string} filename - Nome do arquivo
 * @param {string} contentType - Tipo MIME do arquivo
 * @returns {Promise<string>} - ID do arquivo salvo
 */
const saveToGridFS = (buffer, filename, contentType) => {
    return new Promise((resolve, reject) => {
        const bucket = initBucket();
        const uploadStream = bucket.openUploadStream(filename, {
            contentType: contentType
        });

        uploadStream.on('error', reject);
        uploadStream.on('finish', () => {
            resolve(uploadStream.id.toString());
        });

        uploadStream.end(buffer);
    });
};

/**
 * Busca um arquivo no GridFS e retorna um stream
 * @param {string} id - ID do arquivo
 */
const getFileStream = (id) => {
    const bucket = initBucket();
    return bucket.openDownloadStream(new mongoose.Types.ObjectId(id));
};

/**
 * Deleta um arquivo do GridFS
 * @param {string} id - ID do arquivo
 */
const deleteFile = async (id) => {
    const bucket = initBucket();
    await bucket.delete(new mongoose.Types.ObjectId(id));
};

module.exports = {
    saveToGridFS,
    getFileStream,
    deleteFile
};
