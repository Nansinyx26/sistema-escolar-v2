/**
 * leitorXlsx.js — leitor mínimo de XLSX (Office Open XML), sem dependência.
 *
 * POR QUE NÃO SHEETJS
 * -------------------
 * O prompt original pedia `xlsx` (SheetJS). No npm esse pacote parou na
 * 0.18.5, que carrega CVE-2023-30533 (prototype pollution ao PARSEAR planilha)
 * e CVE-2024-22363 (ReDoS). As correções existem só fora do npm, na
 * distribuição própria do projeto. Colocar a 0.18.5 exatamente no caminho que
 * ingere arquivo enviado por terceiro, contendo dado pessoal de criança, é
 * trocar um problema resolvido por um risco conhecido.
 *
 * Um XLSX é um ZIP de XML. Ler os quatro arquivos de que precisamos
 * (worksheet, sharedStrings, styles, workbook) é menos código do que auditar
 * uma dependência vulnerável — e é código que só faz o que este módulo precisa.
 *
 * LIMITES CONSCIENTES: lê a PRIMEIRA planilha, entradas ZIP armazenadas
 * (método 0) ou deflate (método 8). Não abre .xls antigo (OLE2), não abre
 * arquivo protegido por senha, não avalia fórmula (usa o valor em cache).
 */

const zlib = require('node:zlib');

// ─── ZIP ─────────────────────────────────────────────────────────────────────

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const TAMANHO_MAXIMO_DESCOMPACTADO = 40 * 1024 * 1024; // trava de zip bomb

/**
 * Localiza o End Of Central Directory, varrendo de trás para frente.
 * O EOCD tem tamanho variável (comentário opcional de até 64 KB no fim).
 */
function localizarEocd(buffer) {
    const limite = Math.max(0, buffer.length - 0xffff - 22);
    for (let i = buffer.length - 22; i >= limite; i--) {
        if (buffer.readUInt32LE(i) === ASSINATURA_EOCD) return i;
    }
    return -1;
}

/**
 * Lê o diretório central e devolve um Map nome → {offset, metodo, tamanhoComprimido, tamanhoOriginal}.
 */
function lerDiretorioCentral(buffer) {
    const eocd = localizarEocd(buffer);
    if (eocd < 0) throw new Error('Arquivo XLSX inválido: estrutura ZIP não reconhecida.');

    const totalEntradas = buffer.readUInt16LE(eocd + 10);
    let cursor = buffer.readUInt32LE(eocd + 16);
    const entradas = new Map();

    for (let i = 0; i < totalEntradas; i++) {
        if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== ASSINATURA_CENTRAL)
            break;

        const metodo = buffer.readUInt16LE(cursor + 10);
        const tamanhoComprimido = buffer.readUInt32LE(cursor + 20);
        const tamanhoOriginal = buffer.readUInt32LE(cursor + 24);
        const tamanhoNome = buffer.readUInt16LE(cursor + 28);
        const tamanhoExtra = buffer.readUInt16LE(cursor + 30);
        const tamanhoComentario = buffer.readUInt16LE(cursor + 32);
        const offsetLocal = buffer.readUInt32LE(cursor + 42);
        const nome = buffer.toString('utf8', cursor + 46, cursor + 46 + tamanhoNome);

        entradas.set(nome, { offsetLocal, metodo, tamanhoComprimido, tamanhoOriginal });
        cursor += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
    }

    return entradas;
}

/** Extrai uma entrada do ZIP como string UTF-8. */
function lerEntrada(buffer, entrada) {
    if (!entrada) return '';
    if (entrada.tamanhoOriginal > TAMANHO_MAXIMO_DESCOMPACTADO) {
        throw new Error('Conteúdo da planilha excede o tamanho máximo permitido.');
    }

    const base = entrada.offsetLocal;
    // O header local repete nome/extra com tamanhos próprios — precisamos deles
    // para achar o início real dos dados.
    const tamanhoNome = buffer.readUInt16LE(base + 26);
    const tamanhoExtra = buffer.readUInt16LE(base + 28);
    const inicio = base + 30 + tamanhoNome + tamanhoExtra;
    const bruto = buffer.subarray(inicio, inicio + entrada.tamanhoComprimido);

    if (entrada.metodo === 0) return bruto.toString('utf8');
    if (entrada.metodo === 8) {
        return zlib
            .inflateRawSync(bruto, { maxOutputLength: TAMANHO_MAXIMO_DESCOMPACTADO })
            .toString('utf8');
    }
    throw new Error('Planilha usa um método de compactação não suportado.');
}

// ─── XML ─────────────────────────────────────────────────────────────────────

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodifica entidades XML, incluindo as numéricas. */
function decodificarXml(texto) {
    return String(texto || '').replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (inteiro, corpo) => {
        if (corpo[0] === '#') {
            const codigo =
                corpo[1] === 'x' || corpo[1] === 'X'
                    ? parseInt(corpo.slice(2), 16)
                    : parseInt(corpo.slice(1), 10);
            return Number.isFinite(codigo) && codigo >= 0 && codigo <= 0x10ffff
                ? String.fromCodePoint(codigo)
                : inteiro;
        }
        return Object.hasOwn(ENTIDADES, corpo) ? ENTIDADES[corpo] : inteiro;
    });
}

/** Concatena o conteúdo de todos os `<t>` de um trecho (runs de texto rico). */
function textoDosNosT(trecho) {
    const partes = [];
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
    for (const achado of String(trecho || '').matchAll(re))
        partes.push(decodificarXml(achado[1] || ''));
    return partes.join('');
}

// ─── sharedStrings / styles ──────────────────────────────────────────────────

function lerSharedStrings(xml) {
    if (!xml) return [];
    const strings = [];
    const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g;
    for (const achado of xml.matchAll(re)) strings.push(achado[1] ? textoDosNosT(achado[1]) : '');
    return strings;
}

// numFmtId embutidos que representam data/hora (ECMA-376, tabela de formatos).
const FORMATOS_DATA_EMBUTIDOS = new Set([
    14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57,
]);

/**
 * Devolve um Set com os índices de `cellXfs` cujo formato é de data.
 *
 * Isso é o que permite distinguir "45000" (quantidade) de "45000" (03/03/2023):
 * no XLSX os dois são o MESMO número; só o formato aplicado diz qual é qual.
 */
function lerEstilosDeData(xml) {
    const estilosData = new Set();
    if (!xml) return estilosData;

    // Formatos customizados (numFmtId >= 164) declarados no próprio arquivo.
    const customizadosData = new Set();
    const reNumFmt = /<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"[^>]*\/?>/g;
    for (const achado of xml.matchAll(reNumFmt)) {
        // Remove literais entre aspas e escapes antes de procurar tokens de data.
        const codigo = decodificarXml(achado[2])
            .replace(/"[^"]*"/g, '')
            .replace(/\\./g, '');
        if (/[dmyhs]/i.test(codigo) && !/^[^dmy]*$/i.test(codigo)) customizadosData.add(+achado[1]);
    }

    const blocoCellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
    if (!blocoCellXfs) return estilosData;

    const reXf = /<xf\b[^>]*?\/>|<xf\b[^>]*?>[\s\S]*?<\/xf>/g;
    let indice = 0;
    for (const xf of blocoCellXfs[1].matchAll(reXf)) {
        const numFmtId = /numFmtId="(\d+)"/.exec(xf[0]);
        const id = numFmtId ? +numFmtId[1] : 0;
        if (FORMATOS_DATA_EMBUTIDOS.has(id) || customizadosData.has(id)) estilosData.add(indice);
        indice++;
    }

    return estilosData;
}

// ─── Datas seriais do Excel ──────────────────────────────────────────────────

const EPOCH_EXCEL = Date.UTC(1899, 11, 30);

/**
 * Converte o número serial do Excel em Date (meio-dia UTC, como o resto do
 * módulo — ver `normalizacao.parseDataBr`).
 *
 * O BUG DO ANO BISSEXTO DE 1900
 * -----------------------------
 * O Excel acredita que 1900 foi bissexto e reserva o serial 60 para um
 * 29/02/1900 que nunca existiu. Por isso a conversão precisa de duas âncoras:
 *   - serial >= 60 (qualquer data a partir de 01/03/1900): epoch 30/12/1899,
 *     porque o dia fantasma já está embutido na contagem;
 *   - serial < 60 (janeiro e fevereiro de 1900): epoch 31/12/1899, senão toda
 *     data cai um dia antes.
 * Data de nascimento de aluno vive inteiramente na primeira faixa; a segunda
 * está aqui para a função não mentir se for reaproveitada.
 */
function serialParaData(serial) {
    if (!Number.isFinite(serial) || serial <= 0 || serial > 2958466) return null;
    const dias = Math.floor(serial);
    const ajusteBissexto1900 = dias < 60 ? 1 : 0;
    const data = new Date(EPOCH_EXCEL + (dias + ajusteBissexto1900) * 86400000);
    if (Number.isNaN(data.getTime())) return null;
    return new Date(
        Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate(), 12, 0, 0)
    );
}

// ─── Planilha ────────────────────────────────────────────────────────────────

/** "BC12" → 54 (índice de coluna base 0). */
function colunaDaReferencia(ref) {
    const letras = /^([A-Z]+)/.exec(String(ref || '').toUpperCase());
    if (!letras) return -1;
    let coluna = 0;
    for (const caractere of letras[1]) coluna = coluna * 26 + (caractere.charCodeAt(0) - 64);
    return coluna - 1;
}

/**
 * Lê as linhas da primeira planilha.
 * @returns {Array<Array<string|number|Date>>} matriz de células
 */
function lerLinhas(xmlPlanilha, sharedStrings, estilosData) {
    const linhas = [];
    const reLinha = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;

    for (const linha of xmlPlanilha.matchAll(reLinha)) {
        const celulas = [];
        const conteudo = linha[1] || '';
        const reCelula = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;

        for (const celula of conteudo.matchAll(reCelula)) {
            const atributos = celula[1] || celula[2] || '';
            const corpo = celula[3] || '';

            const ref = /r="([A-Z]+\d+)"/i.exec(atributos);
            const indiceColuna = ref ? colunaDaReferencia(ref[1]) : celulas.length;
            const tipoAchado = /t="([^"]+)"/.exec(atributos);
            const tipo = tipoAchado ? tipoAchado[1] : 'n';
            const estilo = /s="(\d+)"/.exec(atributos);

            const valorNo = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(corpo);
            const bruto = valorNo ? decodificarXml(valorNo[1]) : '';
            let valor = '';

            if (tipo === 's') {
                const indice = parseInt(bruto, 10);
                valor = Number.isFinite(indice) ? sharedStrings[indice] || '' : '';
            } else if (tipo === 'inlineStr') {
                valor = textoDosNosT(corpo);
            } else if (tipo === 'str' || tipo === 'e') {
                valor = bruto;
            } else if (tipo === 'b') {
                valor = bruto === '1' ? 'Sim' : 'Não';
            } else if (bruto !== '') {
                const numero = Number(bruto);
                if (!Number.isFinite(numero)) {
                    valor = bruto;
                } else if (estilo && estilosData.has(+estilo[1])) {
                    // Número com formato de data → serial do Excel.
                    valor = serialParaData(numero) || numero;
                } else {
                    valor = numero;
                }
            }

            if (indiceColuna >= 0) {
                while (celulas.length < indiceColuna) celulas.push('');
                celulas[indiceColuna] = valor;
            }
        }

        linhas.push(celulas);
    }

    return linhas;
}

/**
 * Lê um XLSX em memória.
 * @param {Buffer} buffer conteúdo do arquivo
 * @returns {Array<Array<string|number|Date>>} matriz de células da primeira planilha
 */
function lerXlsx(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('Arquivo de planilha vazio ou ilegível.');
    }

    const entradas = lerDiretorioCentral(buffer);

    // Primeira planilha: `sheet1.xml` cobre praticamente tudo o que o Excel e o
    // Google Planilhas geram; o fallback pega qualquer outro nome.
    let nomePlanilha = 'xl/worksheets/sheet1.xml';
    if (!entradas.has(nomePlanilha)) {
        nomePlanilha = [...entradas.keys()]
            .filter((nome) => /^xl\/worksheets\/[^/]+\.xml$/.test(nome))
            .sort()[0];
    }
    if (!nomePlanilha) throw new Error('A planilha não contém nenhuma aba legível.');

    const sharedStrings = lerSharedStrings(
        lerEntrada(buffer, entradas.get('xl/sharedStrings.xml'))
    );
    const estilosData = lerEstilosDeData(lerEntrada(buffer, entradas.get('xl/styles.xml')));
    return lerLinhas(lerEntrada(buffer, entradas.get(nomePlanilha)), sharedStrings, estilosData);
}

module.exports = {
    lerXlsx,
    // exportados para teste unitário
    serialParaData,
    colunaDaReferencia,
    decodificarXml,
    lerDiretorioCentral,
};
