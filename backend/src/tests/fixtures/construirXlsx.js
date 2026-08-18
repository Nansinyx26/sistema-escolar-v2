/**
 * construirXlsx.js — gerador de XLSX **sintético** para os testes.
 *
 * Existe para que os testes do leitor de planilha exercitem um arquivo real
 * (ZIP + deflate + sharedStrings + styles + serial de data) sem que nenhum
 * .xlsx binário — que ninguém consegue revisar num diff — entre no repositório.
 *
 * LGPD: todo dado produzido aqui é inventado. Nenhum RA, nome ou data de
 * nascimento real entra em fixture.
 */

const zlib = require('node:zlib');

// ─── CRC-32 (exigido pelo formato ZIP) ───────────────────────────────────────

const TABELA_CRC = (() => {
    const tabela = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let valor = i;
        for (let bit = 0; bit < 8; bit++)
            valor = valor & 1 ? 0xedb88320 ^ (valor >>> 1) : valor >>> 1;
        tabela[i] = valor;
    }
    return tabela;
})();

function crc32(buffer) {
    let crc = -1;
    for (const byte of buffer) crc = (crc >>> 8) ^ TABELA_CRC[(crc ^ byte) & 0xff];
    return (crc ^ -1) >>> 0;
}

// ─── ZIP ─────────────────────────────────────────────────────────────────────

/** Monta um ZIP com as entradas dadas, comprimindo com deflate (método 8). */
function montarZip(entradas) {
    const pedacosLocais = [];
    const pedacosCentrais = [];
    let offset = 0;

    for (const { nome, conteudo } of entradas) {
        const original = Buffer.from(conteudo, 'utf8');
        const comprimido = zlib.deflateRawSync(original);
        const nomeBuffer = Buffer.from(nome, 'utf8');
        const crc = crc32(original);

        const cabecalhoLocal = Buffer.alloc(30);
        cabecalhoLocal.writeUInt32LE(0x04034b50, 0);
        cabecalhoLocal.writeUInt16LE(20, 4); // versão necessária
        cabecalhoLocal.writeUInt16LE(0, 6); // flags
        cabecalhoLocal.writeUInt16LE(8, 8); // método: deflate
        cabecalhoLocal.writeUInt32LE(0, 10); // data/hora
        cabecalhoLocal.writeUInt32LE(crc, 14);
        cabecalhoLocal.writeUInt32LE(comprimido.length, 18);
        cabecalhoLocal.writeUInt32LE(original.length, 22);
        cabecalhoLocal.writeUInt16LE(nomeBuffer.length, 26);
        cabecalhoLocal.writeUInt16LE(0, 28); // extra

        const cabecalhoCentral = Buffer.alloc(46);
        cabecalhoCentral.writeUInt32LE(0x02014b50, 0);
        cabecalhoCentral.writeUInt16LE(20, 4);
        cabecalhoCentral.writeUInt16LE(20, 6);
        cabecalhoCentral.writeUInt16LE(0, 8);
        cabecalhoCentral.writeUInt16LE(8, 10);
        cabecalhoCentral.writeUInt32LE(0, 12);
        cabecalhoCentral.writeUInt32LE(crc, 16);
        cabecalhoCentral.writeUInt32LE(comprimido.length, 20);
        cabecalhoCentral.writeUInt32LE(original.length, 24);
        cabecalhoCentral.writeUInt16LE(nomeBuffer.length, 28);
        cabecalhoCentral.writeUInt32LE(offset, 42);

        pedacosLocais.push(cabecalhoLocal, nomeBuffer, comprimido);
        pedacosCentrais.push(cabecalhoCentral, nomeBuffer);
        offset += cabecalhoLocal.length + nomeBuffer.length + comprimido.length;
    }

    const central = Buffer.concat(pedacosCentrais);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entradas.length, 8);
    eocd.writeUInt16LE(entradas.length, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(offset, 16);

    return Buffer.concat([...pedacosLocais, central, eocd]);
}

// ─── XLSX ────────────────────────────────────────────────────────────────────

const escaparXml = (texto) =>
    String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/** Índice de coluna (base 0) → "A", "B", ... "AA". */
function letraDaColuna(indice) {
    let letra = '';
    let n = indice + 1;
    while (n > 0) {
        const resto = (n - 1) % 26;
        letra = String.fromCharCode(65 + resto) + letra;
        n = Math.floor((n - resto) / 26);
    }
    return letra;
}

/**
 * Constrói um .xlsx a partir de uma matriz.
 *
 * Tipos de célula aceitos:
 *   - string        → sharedString
 *   - number        → numérico simples
 *   - { serial: n } → número COM formato de data (dd/mm/yyyy), que é como o
 *                     Excel guarda datas e o caso que o leitor precisa resolver
 *   - Date          → convertido para serial com formato de data
 *
 * @param {Array<Array<*>>} matriz
 * @returns {Buffer}
 */
function construirXlsx(matriz) {
    const sharedStrings = [];
    const indiceDaString = new Map();

    const registrarString = (texto) => {
        if (!indiceDaString.has(texto)) {
            indiceDaString.set(texto, sharedStrings.length);
            sharedStrings.push(texto);
        }
        return indiceDaString.get(texto);
    };

    const linhasXml = matriz.map((linha, indiceLinha) => {
        const celulas = linha.map((valor, indiceColuna) => {
            const ref = `${letraDaColuna(indiceColuna)}${indiceLinha + 1}`;

            if (valor === null || valor === undefined || valor === '') return '';

            if (
                valor instanceof Date ||
                (valor && typeof valor === 'object' && 'serial' in valor)
            ) {
                const serial =
                    valor instanceof Date
                        ? Math.round(
                              (Date.UTC(
                                  valor.getUTCFullYear(),
                                  valor.getUTCMonth(),
                                  valor.getUTCDate()
                              ) -
                                  Date.UTC(1899, 11, 30)) /
                                  86400000
                          )
                        : valor.serial;
                // s="1" aponta para o cellXf com numFmtId de data (ver styles.xml)
                return `<c r="${ref}" s="1"><v>${serial}</v></c>`;
            }

            if (typeof valor === 'number') return `<c r="${ref}"><v>${valor}</v></c>`;

            return `<c r="${ref}" t="s"><v>${registrarString(String(valor))}</v></c>`;
        });

        return `<row r="${indiceLinha + 1}">${celulas.join('')}</row>`;
    });

    const planilha = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${linhasXml.join('')}</sheetData></worksheet>`;

    const stringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">${sharedStrings
        .map((texto) => `<si><t>${escaparXml(texto)}</t></si>`)
        .join('')}</sst>`;

    // cellXfs[0] = geral; cellXfs[1] = formato de data customizado (id 164).
    const estilos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/></cellXfs>
</styleSheet>`;

    return montarZip([
        {
            nome: '[Content_Types].xml',
            conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
        },
        {
            nome: 'xl/workbook.xml',
            conteudo: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="Alunos" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>`,
        },
        { nome: 'xl/sharedStrings.xml', conteudo: stringsXml },
        { nome: 'xl/styles.xml', conteudo: estilos },
        { nome: 'xl/worksheets/sheet1.xml', conteudo: planilha },
    ]);
}

module.exports = { construirXlsx, montarZip, crc32, letraDaColuna };
