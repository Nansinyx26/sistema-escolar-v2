/**
 * verificarDireitosAutorais — recusa no upload a imagem ou o áudio protegido
 * por direitos autorais (Issue #509).
 *
 * Vem DEPOIS do multer (precisa do buffer) e ANTES de qualquer conversão: a
 * foto de perfil vira WebP em `convertToWebP`, e o reencode apaga o EXIF/XMP
 * onde mora o aviso de copyright.
 *
 * Arquivo aceito ganha `arquivo.impressaoDireitosAutorais`, que o handler grava
 * em `metadata.impressao` (via `carimboImpressao`) — é o que permite, depois,
 * bloquear pelo id as cópias já armazenadas.
 *
 * Falha da análise (catálogo fora do ar, bug) NÃO derruba o upload: vai para o
 * hub de observabilidade e o arquivo segue. É uma política de conteúdo, não
 * uma barreira de segurança — a assinatura de bytes e a moderação continuam no
 * caminho —, e o arquivo ainda pode ser bloqueado pelo id depois.
 */
const obs = require('../observability');
const logger = require('../utils/logger');
const { analisar } = require('../services/direitosAutorais');

async function verificarDireitosAutorais(req, res, next) {
    const arquivos = [];
    if (req.file) arquivos.push(req.file);
    if (Array.isArray(req.files)) arquivos.push(...req.files);

    for (const arquivo of arquivos) {
        let veredito;
        try {
            veredito = await analisar(arquivo.buffer, arquivo.mimetype, { escolaId: req.escolaId });
        } catch (err) {
            obs.captureException(err, { tipo: 'direitos_autorais.analise' });
            logger.warn(`[DireitosAutorais] análise indisponível: ${err.message}`);
            continue;
        }

        if (!veredito.ok) {
            logger.info(
                `[DireitosAutorais] upload recusado (${veredito.aviso?.fonte || 'catalogo'})`
            );
            return res.status(451).json({
                success: false,
                codigo: veredito.codigo,
                error: `"${arquivo.originalname}": ${veredito.motivo}`,
            });
        }
        if (veredito.impressao) arquivo.impressaoDireitosAutorais = veredito.impressao;
    }

    return next();
}

module.exports = verificarDireitosAutorais;
