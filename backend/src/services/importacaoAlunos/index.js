/**
 * services/importacaoAlunos — ponto de entrada da leitura de arquivos.
 *
 * Roteia o buffer para o parser certo e devolve sempre a MESMA forma de
 * resultado, venha ele de PDF, XLSX ou CSV. Continua sendo camada pura: nada
 * de Express, nada de Mongoose, nada de log.
 */

const crypto = require('node:crypto');

const { parsearPdfSeduc, parsearTextoSeduc } = require('./parserPdfSeduc');
const { parsearXlsx, parsearCsv } = require('./parserPlanilha');
const classificador = require('./classificador');
const normalizacao = require('./normalizacao');
const { pareceTexto } = require('../../utils/assinaturaArquivo');

/** Teto de tamanho do upload (§5.1). Espelhado no multer da rota. */
const TAMANHO_MAXIMO = 5 * 1024 * 1024;

/** Teto de linhas por importação — uma classe da SED não passa de ~50. */
const MAXIMO_LINHAS = 500;

const ORIGEM_POR_TIPO = {
    pdf: 'importacao_pdf',
    xlsx: 'importacao_planilha',
    csv: 'importacao_planilha',
};

/**
 * Detecta o tipo REAL do arquivo pelos primeiros bytes.
 *
 * O `mimetype` do multipart vem do cliente e é forjável: renomear um binário
 * para `.pdf` e declarar `application/pdf` passa por qualquer checagem de
 * extensão. Aqui quem decide é o conteúdo.
 *
 * @returns {{tipo: 'pdf'|'xlsx'|'csv'|null, motivo?: string}}
 */
function detectarTipo(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return { tipo: null, motivo: 'Arquivo vazio ou ilegível.' };
    }

    if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return { tipo: 'pdf' };

    // ZIP: pode ser XLSX, mas também DOCX/PPTX/ODT/.zip puro. Só a presença da
    // parte `xl/` confirma que é planilha do Office.
    if (
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
    ) {
        const cabecalho = buffer.toString('latin1');
        if (cabecalho.includes('xl/workbook.xml') || cabecalho.includes('xl/worksheets/'))
            return { tipo: 'xlsx' };
        return {
            tipo: null,
            motivo: 'O arquivo é um pacote Office, mas não é uma planilha (.xlsx). Envie PDF, XLSX ou CSV.',
        };
    }

    // OLE2 — .xls/.doc do Office antigo.
    if (
        buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
    ) {
        return {
            tipo: null,
            motivo: 'Formato .xls antigo não é suportado. Salve como .xlsx ou .csv e envie novamente.',
        };
    }

    if (pareceTexto(buffer)) return { tipo: 'csv' };

    return { tipo: null, motivo: 'Formato não reconhecido. Envie PDF, XLSX ou CSV.' };
}

/** SHA-256 do arquivo — vai para a auditoria; o conteúdo não. */
function hashArquivo(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Lê um arquivo enviado e devolve os registros brutos + cabeçalho.
 *
 * @param {object} entrada
 * @param {Buffer} entrada.buffer
 * @param {Object<string, number>} [entrada.mapaColunas] mapeamento manual (planilha)
 * @returns {Promise<{tipo: string, origemCadastro: string, cabecalho: object, registros: Array,
 *                    avisos: string[], totalDeclarado: number|null, colunas: string[], faltando: string[]}>}
 * @throws {Error} com `.codigo` legível quando o arquivo não pode ser lido
 */
async function lerArquivo({ buffer, mapaColunas }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw erroDeLeitura('Arquivo vazio ou ilegível.');
    }
    if (buffer.length > TAMANHO_MAXIMO) {
        throw erroDeLeitura('Arquivo acima do limite de 5 MB.');
    }

    const { tipo, motivo } = detectarTipo(buffer);
    if (!tipo) throw erroDeLeitura(motivo);

    let resultado;
    try {
        if (tipo === 'pdf') resultado = await parsearPdfSeduc(buffer);
        else if (tipo === 'xlsx') resultado = parsearXlsx(buffer, mapaColunas);
        else resultado = parsearCsv(buffer, mapaColunas);
    } catch {
        // A mensagem original pode conter trecho do arquivo — e o arquivo tem
        // dado pessoal. Só a categoria do erro sai daqui.
        throw erroDeLeitura(
            tipo === 'pdf'
                ? 'Não foi possível ler o texto deste PDF. Ele pode estar protegido ou ser uma imagem digitalizada.'
                : 'Não foi possível ler esta planilha. Confira se o arquivo não está corrompido ou protegido por senha.'
        );
    }

    const registros = (resultado.registros || []).slice(0, MAXIMO_LINHAS);
    const avisos = [...(resultado.avisos || [])];
    if ((resultado.registros || []).length > MAXIMO_LINHAS) {
        avisos.push(
            `O arquivo tem mais de ${MAXIMO_LINHAS} linhas; apenas as ${MAXIMO_LINHAS} primeiras foram carregadas.`
        );
    }

    return {
        tipo,
        origemCadastro: ORIGEM_POR_TIPO[tipo],
        cabecalho: resultado.cabecalho,
        registros,
        avisos,
        totalDeclarado: resultado.totalDeclarado === undefined ? null : resultado.totalDeclarado,
        colunas: resultado.colunas || [],
        faltando: resultado.faltando || [],
    };
}

function erroDeLeitura(mensagem) {
    const erro = new Error(mensagem);
    erro.leitura = true;
    return erro;
}

module.exports = {
    lerArquivo,
    detectarTipo,
    hashArquivo,
    TAMANHO_MAXIMO,
    MAXIMO_LINHAS,
    // reexporta a camada pura para quem só precisa de uma parte
    parsearTextoSeduc,
    parsearPdfSeduc,
    parsearXlsx,
    parsearCsv,
    classificador,
    normalizacao,
};
