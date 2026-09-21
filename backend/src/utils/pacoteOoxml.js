/**
 * pacoteOoxml.js — lê o índice de um arquivo ZIP para distinguir um documento
 * do Office de um arquivo compactado comum, e para achar macro dentro dele.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * `.docx`, `.xlsx` e `.pptx` são ZIP por dentro. Para a assinatura de bytes,
 * um `.zip` qualquer e um documento do Word são a mesma coisa: `PK\x03\x04`.
 * Então recusar compactado (Issue #415) olhando só os quatro primeiros bytes
 * derrubaria junto todo documento moderno do Office.
 *
 * A diferença está no conteúdo: todo pacote OPC (o formato dos arquivos
 * `x`) traz obrigatoriamente a peça `[Content_Types].xml` na raiz. Um ZIP
 * comum não traz. E a macro, quando existe, vive numa peça de nome conhecido
 * (`vbaProject.bin`) — é o que separa `.docx` de `.docm`.
 *
 * Só o ÍNDICE do ZIP é lido (o "diretório central", a lista de nomes no fim do
 * arquivo). Nada é descompactado: não há como um arquivo inflar em memória.
 */

const ASSINATURA_DIRETORIO_CENTRAL = 0x02014b50; // 'PK\x01\x02'
const ASSINATURA_FIM_DIRETORIO = 0x06054b50; // 'PK\x05\x06'

// O comentário final do ZIP tem no máximo 65535 bytes; o cabeçalho de fim tem
// 22. Além disso não há o que procurar.
const JANELA_FIM = 65535 + 22;

// Teto de nomes lidos. Um ZIP com milhões de entradas não pode virar laço
// longo dentro da requisição — passando disto, o arquivo é tratado como
// ilegível, que é a resposta segura.
const MAX_ENTRADAS = 5000;

/** Posição do cabeçalho de fim do diretório central, ou -1. */
function acharFimDoDiretorio(buf) {
    const inicio = Math.max(0, buf.length - JANELA_FIM);
    for (let i = buf.length - 22; i >= inicio; i--) {
        if (buf.readUInt32LE(i) === ASSINATURA_FIM_DIRETORIO) return i;
    }
    return -1;
}

/**
 * Nomes das peças de dentro do ZIP.
 *
 * @param {Buffer} buf conteúdo do arquivo
 * @returns {{ok: boolean, nomes: string[]}} `ok:false` quando o índice não pôde
 *   ser lido — arquivo truncado, ZIP64 ou corrompido.
 */
function lerNomes(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 22) return { ok: false, nomes: [] };

    const fim = acharFimDoDiretorio(buf);
    if (fim < 0) return { ok: false, nomes: [] };

    let ponteiro = buf.readUInt32LE(fim + 16); // início do diretório central
    const total = buf.readUInt16LE(fim + 10); // entradas neste volume
    // 0xFFFF/0xFFFFFFFF é a marca de ZIP64: os valores reais estão noutro
    // cabeçalho. Não vale implementar ZIP64 para um anexo de 10 MB — o
    // chamador trata `ok:false` recusando.
    if (ponteiro === 0xffffffff || total === 0xffff) return { ok: false, nomes: [] };
    if (ponteiro >= buf.length) return { ok: false, nomes: [] };
    if (total > MAX_ENTRADAS) return { ok: false, nomes: [] };

    const nomes = [];
    for (let i = 0; i < total; i++) {
        if (ponteiro + 46 > buf.length) return { ok: false, nomes: [] };
        if (buf.readUInt32LE(ponteiro) !== ASSINATURA_DIRETORIO_CENTRAL) {
            return { ok: false, nomes: [] };
        }
        const tamNome = buf.readUInt16LE(ponteiro + 28);
        const tamExtra = buf.readUInt16LE(ponteiro + 30);
        const tamComentario = buf.readUInt16LE(ponteiro + 32);
        const fimNome = ponteiro + 46 + tamNome;
        if (fimNome > buf.length) return { ok: false, nomes: [] };

        nomes.push(buf.toString('utf8', ponteiro + 46, fimNome));
        ponteiro = fimNome + tamExtra + tamComentario;
    }

    return { ok: true, nomes };
}

/**
 * Nome de peça em forma comparável.
 *
 * O separador do formato é a barra normal, mas compactador de Windows grava
 * `\` — e aí `word\vbaProject.bin` passava por um padrão escrito com `/`,
 * ou seja, a macro escapava da busca. Normalizar antes de comparar fecha isso.
 */
function normalizar(nome) {
    return String(nome).replace(/\\/g, '/').replace(/^\/+/, '');
}

/** A peça obrigatória que todo pacote do Office tem e um ZIP comum não tem. */
function ehPacoteDoOffice(nomes) {
    return nomes.some((n) => normalizar(n).toLowerCase() === '[content_types].xml');
}

/**
 * Peças de macro. `vbaProject.bin` é o projeto VBA de Word/Excel/PowerPoint;
 * `vbaData.xml` o acompanha no Word; a folha de macro do Excel 4.0 ainda é
 * executável e não precisa de VBA nenhum.
 */
const PECAS_DE_MACRO = [/(^|\/)vbaproject\.bin$/i, /(^|\/)vbadata\.xml$/i, /(^|\/)macrosheets\//i];

function temMacro(nomes) {
    return nomes.some((n) => PECAS_DE_MACRO.some((re) => re.test(normalizar(n))));
}

/**
 * Classifica um buffer com assinatura de ZIP.
 *
 * @param {Buffer} buf
 * @returns {{tipo: 'office'|'office-com-macro'|'compactado'|'ilegivel'}}
 */
function inspecionarZip(buf) {
    const { ok, nomes } = lerNomes(buf);
    if (!ok) return { tipo: 'ilegivel' };
    if (!ehPacoteDoOffice(nomes)) return { tipo: 'compactado' };
    if (temMacro(nomes)) return { tipo: 'office-com-macro' };
    return { tipo: 'office' };
}

module.exports = { inspecionarZip };
