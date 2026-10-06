/**
 * limparCorpoMultipart — Issue #647.
 *
 * O filtro global de app.js (`sanitizeObject` + `removerOperadoresMongoProfundo`)
 * roda antes das rotas e só enxerga o corpo JSON. Num upload, quem lê o corpo
 * é o `multer`, DENTRO da rota, depois do filtro: os campos de texto do
 * formulário (`nomeDocumento`, `observacoes`…) e o nome do arquivo chegavam ao
 * controller sem tag removida e com chave `$`/`a.b` intacta — o `multer` monta
 * `alunoId[$ne]=x` como objeto.
 *
 * Vai logo depois do `multer` em toda rota de upload, e aplica ao corpo o mesmo
 * tratamento do filtro global. O nome do arquivo também é texto do usuário:
 * aparece para quem recebe o anexo e fica gravado no banco.
 */
const {
    sanitizeObject,
    sanitizeInput,
    removerOperadoresMongoProfundo,
} = require('../utils/sanitize');

function arquivosDaRequisicao(req) {
    if (req.file) return [req.file];
    if (Array.isArray(req.files)) return req.files;
    if (req.files && typeof req.files === 'object') return Object.values(req.files).flat();
    return [];
}

function limparCorpoMultipart(req, _res, next) {
    if (req.body && typeof req.body === 'object') {
        sanitizeObject(req.body);
        removerOperadoresMongoProfundo(req.body);
    }
    for (const arquivo of arquivosDaRequisicao(req)) {
        if (arquivo && typeof arquivo.originalname === 'string') {
            arquivo.originalname = sanitizeInput(arquivo.originalname);
        }
    }
    next();
}

module.exports = { limparCorpoMultipart };
