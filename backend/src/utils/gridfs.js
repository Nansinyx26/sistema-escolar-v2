const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

let bucket;

/**
 * Inicializa o bucket do GridFS usando a conexão existente do Mongoose
 */
const initBucket = () => {
    if (!bucket) {
        bucket = new GridFSBucket(mongoose.connection.db, {
            bucketName: 'uploads',
        });
    }
    return bucket;
};

/**
 * Salva um buffer no GridFS
 *
 * `metadata` NÃO é opcional na prática: é ele que o
 * `FileController.autorizarArquivo` consulta para decidir quem baixa o arquivo
 * (`alunoId` aplica a regra de acesso ao aluno, `usuarioId` restringe ao dono,
 * `escolaId` barra outro tenant). Até a Issue #228 esta função gravava SEM
 * metadata nenhum, e a foto do aluno caía na última regra do FileController — a
 * dos legados, que libera qualquer `image/*` a qualquer autenticado da rede.
 *
 * @param {Buffer} buffer - Conteúdo do arquivo
 * @param {string} filename - Nome do arquivo
 * @param {string} contentType - Tipo MIME do arquivo
 * @param {Object} [metadata] - Metadados de autorização gravados no arquivo
 * @returns {Promise<string>} - ID do arquivo salvo
 */
const saveToGridFS = (buffer, filename, contentType, metadata) => {
    return new Promise((resolve, reject) => {
        const bucket = initBucket();
        const opcoes = { contentType: contentType };
        // Só declara a chave quando há o que gravar: `metadata: undefined`
        // criaria o campo vazio no documento do bucket.
        if (metadata && Object.keys(metadata).length > 0) opcoes.metadata = metadata;
        const uploadStream = bucket.openUploadStream(filename, opcoes);

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
 * Busca um arquivo no GridFS pelo nome e retorna um stream
 * @param {string} filename - Nome do arquivo
 */
const getFileStreamByFilename = (filename) => {
    const bucket = initBucket();
    return bucket.openDownloadStreamByName(filename);
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
    getFileStreamByFilename,
    deleteFile,
};
