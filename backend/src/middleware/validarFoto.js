/**
 * Formato aceito no campo `foto` (Issue #572).
 *
 * O sanitizador global tira as tags mas deixa as aspas passarem, e o frontend
 * monta `<img src="${foto}">` por interpolação. Um valor como
 * `x" onerror="..."` fechava o atributo e virava handler — que a CSP deixa
 * rodar (`script-src-attr 'unsafe-inline'`). O professor gravava isso no
 * próprio cadastro e o script rodava no navegador do diretor.
 *
 * Aqui só passa o que uma foto legítima do sistema é:
 *   - vazio/null (remove a foto);
 *   - data URI base64 de imagem raster (sem SVG, que carrega script);
 *   - URL https sem espaço, aspas, sinais de menor/maior ou crase, de um host
 *     que a CSP deixa carregar em `img-src`: o Google (foto do login) ou o
 *     próprio sistema (`FRONTEND_URL`) — Issue #604;
 *   - referência interna: `gridfs:<id>`, id do GridFS, `/api/files/<id>`,
 *     nome de arquivo legado — só letras, dígitos e `:/_.-`, sem esquema
 *     executável (`javascript:`, `vbscript:`) nem `data:` fora do formato acima.
 */

const DATA_URI_IMAGEM = /^data:image\/(png|jpe?g|webp|gif|bmp|avif);base64,[A-Za-z0-9+/=\r\n]+$/i;
const URL_HTTPS = /^https:\/\/[^\s"'<>`\\]+$/i;
const REFERENCIA_INTERNA = /^[A-Za-z0-9:/_.-]+$/;
const ESQUEMA_PROIBIDO = /^\s*(javascript|vbscript|data|file|blob):/i;

/** Foto do Google (login): o mesmo domínio que a CSP libera em `img-src`. */
function hostDoGoogle(hostname) {
    return /(^|\.)googleusercontent\.com$/i.test(String(hostname || ''));
}

function hostDoProprioSistema() {
    try {
        const url = process.env.FRONTEND_URL;
        return url ? new URL(url).hostname.toLowerCase() : null;
    } catch {
        return null;
    }
}

/**
 * URL https de host permitido (Issue #604). Qualquer host passava: o navegador
 * já recusava a imagem pela CSP, mas o banco guardava um valor que nunca
 * aparece, e a única barreira contra o vazamento do IP de quem vê a foto
 * ficava sendo a CSP.
 */
function urlHttpsPermitida(valor) {
    if (!URL_HTTPS.test(valor)) return false;
    let host;
    try {
        host = new URL(valor).hostname.toLowerCase();
    } catch {
        return false;
    }
    return hostDoGoogle(host) || host === hostDoProprioSistema();
}

function fotoValida(valor) {
    if (valor === undefined || valor === null || valor === '') return true;
    if (typeof valor !== 'string') return false;
    if (DATA_URI_IMAGEM.test(valor)) return true;
    // Endereço de outro servidor só por URL https de host permitido. Sem isto,
    // `http://host/x.png` e `//host/x.png` passavam como "referência interna"
    // (só têm letras, `:`, `/` e `.`) e escapavam da lista acima.
    if (/^https:/i.test(valor)) return urlHttpsPermitida(valor);
    if (valor.includes('://') || valor.startsWith('//')) return false;
    if (ESQUEMA_PROIBIDO.test(valor)) return false;
    return REFERENCIA_INTERNA.test(valor);
}

/**
 * Middleware: recusa com 400 qualquer corpo cujo `foto` (no primeiro nível)
 * esteja fora do formato. Corre antes das rotas, então vale para todo
 * controller que grava foto — usuário, professor, diretor, secretaria, aluno.
 * Upload multipart não é afetado: o arquivo chega em `req.file`, não no body.
 */
function recusarFotoInvalida(req, res, next) {
    const corpo = req.body;
    if (corpo && typeof corpo === 'object' && !Array.isArray(corpo) && 'foto' in corpo) {
        if (!fotoValida(corpo.foto)) {
            return res.status(400).json({
                success: false,
                codigo: 'FOTO_INVALIDA',
                error: 'Foto em formato inválido. Envie a imagem novamente.',
            });
        }
    }
    next();
}

module.exports = { fotoValida, recusarFotoInvalida, hostDoGoogle };
