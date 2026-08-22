/**
 * uploadImportacao.js — recebimento do arquivo da importação de alunos.
 *
 * `memoryStorage` não é otimização, é requisito: o Render tem filesystem
 * efêmero e possivelmente mais de uma instância. Arquivo gravado em disco some
 * no próximo deploy e não é visto pela instância que atender o "confirmar".
 * Além disso o arquivo carrega dado pessoal de criança — quanto menos lugares
 * ele tocar, melhor.
 *
 * O `mimetype` conferido aqui vem do cliente e é FORJÁVEL. Ele é só o primeiro
 * filtro, barato. Quem decide o tipo de verdade é
 * `services/importacaoAlunos/index.js#detectarTipo`, que lê os bytes.
 */
const multer = require('multer');

const TAMANHO_MAXIMO = 5 * 1024 * 1024; // 5 MB (§5.1)

const MIMETYPES_ACEITOS = new Set([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'text/plain',
    'application/csv',
    'application/octet-stream', // alguns navegadores rotulam .csv assim
]);

const EXTENSOES_ACEITAS = /\.(pdf|xlsx|xls|csv|txt)$/i;

const uploadImportacao = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: TAMANHO_MAXIMO, files: 1, fields: 10 },
    fileFilter: (_req, file, cb) => {
        const mimeOk = MIMETYPES_ACEITOS.has(String(file.mimetype || '').toLowerCase());
        const extensaoOk = EXTENSOES_ACEITAS.test(String(file.originalname || ''));
        if (mimeOk || extensaoOk) return cb(null, true);
        return cb(new Error('Formato não aceito. Envie PDF, XLSX ou CSV.'), false);
    },
});

/**
 * Converte os erros do multer em resposta JSON legível.
 *
 * Sem isto, estourar o limite de 5 MB devolve o handler de erro genérico do
 * app — e o usuário vê "erro interno" em vez de "arquivo grande demais".
 */
function tratarErroUpload(err, _req, res, next) {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
        const mensagens = {
            LIMIT_FILE_SIZE: 'Arquivo acima do limite de 5 MB.',
            LIMIT_FILE_COUNT: 'Envie um arquivo por vez.',
            LIMIT_UNEXPECTED_FILE: 'Campo de arquivo inesperado. Use o campo "arquivo".',
        };
        return res
            .status(400)
            .json({ success: false, error: mensagens[err.code] || 'Falha ao receber o arquivo.' });
    }

    return res
        .status(400)
        .json({ success: false, error: err.message || 'Falha ao receber o arquivo.' });
}

module.exports = { uploadImportacao, tratarErroUpload };
