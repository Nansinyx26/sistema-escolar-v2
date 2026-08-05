'use strict';

/**
 * ExportadorConversa.js — exporta uma conversa em TXT, PDF ou DOCX.
 *
 * SOBRE O DOCX SEM DEPENDÊNCIA NOVA
 * ---------------------------------
 * Um .docx é um ZIP com alguns XML dentro. As bibliotecas do ecossistema
 * (`docx`, `jszip`) resolveriam isso, mas nenhuma está no projeto e o formato
 * mínimo cabe em poucas dezenas de linhas.
 *
 * O ZIP é escrito com o método STORED (sem compressão). Isso é ZIP válido, o
 * Word abre normalmente, e evita a parte realmente traiçoeira de gerar um
 * container comprimido à mão. O custo é o arquivo ficar maior — irrelevante
 * para uma conversa de texto.
 *
 * O PDF reusa o printer já configurado do RelatorioController (resolução de
 * fontes Roboto com fallback), em vez de montar um segundo.
 */

const zlib = require('zlib');
const { obterPrinter } = require('../../controllers/RelatorioController');

const FORMATOS = ['txt', 'pdf', 'docx'];

/** Rótulo de quem falou, para os três formatos. */
const autorDe = (papel, nomeUsuario) =>
    papel === 'usuario' ? (nomeUsuario || 'Você') : 'Assistente';

function dataLegivel(valor) {
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR');
}

// ─────────────────────────────────────────────────────────────────────────────
// TXT
// ─────────────────────────────────────────────────────────────────────────────

function gerarTxt(conversa, nomeUsuario) {
    const linhas = [
        conversa.titulo,
        '='.repeat(Math.min(conversa.titulo.length, 60)),
        `Exportado em ${dataLegivel(new Date())}`,
        ''
    ];

    if (conversa.resumo) {
        linhas.push('[Resumo dos trechos mais antigos]', conversa.resumo, '');
    }

    for (const m of conversa.mensagens || []) {
        linhas.push(`${autorDe(m.papel, nomeUsuario)} — ${dataLegivel(m.em)}`);
        linhas.push(m.texto);
        if (m.ferramentas?.length) {
            linhas.push(`(consultas: ${m.ferramentas.join(', ')})`);
        }
        linhas.push('');
    }

    return Buffer.from(linhas.join('\n'), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF
// ─────────────────────────────────────────────────────────────────────────────

const VERDE = '#10b981';
const ESCURO = '#111827';
const CINZA = '#6b7280';

function gerarPdf(conversa, nomeUsuario) {
    const printer = obterPrinter();
    if (!printer) {
        const erro = new Error('A geração de PDF não está disponível neste servidor.');
        erro.semPdf = true;
        throw erro;
    }

    const conteudo = [
        { text: conversa.titulo, fontSize: 15, bold: true, color: VERDE, margin: [0, 0, 0, 4] },
        { text: `Exportado em ${dataLegivel(new Date())}`, fontSize: 8, color: CINZA, margin: [0, 0, 0, 16] }
    ];

    if (conversa.resumo) {
        conteudo.push({
            text: 'Resumo dos trechos mais antigos',
            fontSize: 9, bold: true, color: CINZA, margin: [0, 0, 0, 3]
        });
        conteudo.push({ text: conversa.resumo, fontSize: 9, italics: true, color: CINZA, margin: [0, 0, 0, 14] });
    }

    for (const m of conversa.mensagens || []) {
        conteudo.push({
            text: `${autorDe(m.papel, nomeUsuario)} — ${dataLegivel(m.em)}`,
            fontSize: 8,
            bold: true,
            color: m.papel === 'usuario' ? ESCURO : VERDE,
            margin: [0, 8, 0, 2]
        });
        conteudo.push({ text: m.texto, fontSize: 10, color: ESCURO, lineHeight: 1.3 });
    }

    return new Promise((resolve, reject) => {
        try {
            const doc = printer.createPdfKitDocument({
                pageSize: 'A4',
                content: conteudo,
                defaultStyle: { font: 'Roboto' }
            });
            const partes = [];
            doc.on('data', (p) => partes.push(p));
            doc.on('end', () => resolve(Buffer.concat(partes)));
            doc.on('error', reject);
            doc.end();
        } catch (e) {
            reject(e);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCX — ZIP mínimo (método STORED) + Office Open XML
// ─────────────────────────────────────────────────────────────────────────────

/** Escapa o texto para XML. Sem isso, um "<" na conversa corrompe o documento. */
function escaparXml(texto) {
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/** Um parágrafo Word, com quebras de linha preservadas. */
function paragrafo(texto, { negrito = false, tamanho = 22, cor = null } = {}) {
    const runs = String(texto).split('\n').map((linha, i) => {
        const quebra = i > 0 ? '<w:br/>' : '';
        return `<w:r><w:rPr>${negrito ? '<w:b/>' : ''}<w:sz w:val="${tamanho}"/>`
            + `${cor ? `<w:color w:val="${cor}"/>` : ''}</w:rPr>`
            + `${quebra}<w:t xml:space="preserve">${escaparXml(linha)}</w:t></w:r>`;
    }).join('');

    return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${runs}</w:p>`;
}

function documentoXml(conversa, nomeUsuario) {
    const corpo = [
        paragrafo(conversa.titulo, { negrito: true, tamanho: 32, cor: '10B981' }),
        paragrafo(`Exportado em ${dataLegivel(new Date())}`, { tamanho: 16, cor: '6B7280' })
    ];

    if (conversa.resumo) {
        corpo.push(paragrafo('Resumo dos trechos mais antigos', { negrito: true, tamanho: 18, cor: '6B7280' }));
        corpo.push(paragrafo(conversa.resumo, { tamanho: 18, cor: '6B7280' }));
    }

    for (const m of conversa.mensagens || []) {
        corpo.push(paragrafo(
            `${autorDe(m.papel, nomeUsuario)} — ${dataLegivel(m.em)}`,
            { negrito: true, tamanho: 16, cor: m.papel === 'usuario' ? '111827' : '10B981' }
        ));
        corpo.push(paragrafo(m.texto));
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        + `<w:body>${corpo.join('')}</w:body></w:document>`;
}

const CONTENT_TYPES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>';

const RELS_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>';

/**
 * Monta um ZIP com entradas STORED (sem compressão).
 *
 * O formato é: para cada arquivo, um Local File Header + os bytes; ao final,
 * o Central Directory e o End Of Central Directory. Sem compressão, o CRC-32 e
 * os tamanhos são os do próprio conteúdo, o que elimina a maior fonte de erro.
 *
 * @param {Array<{nome: string, dados: Buffer}>} arquivos
 */
function montarZip(arquivos) {
    const locais = [];
    const central = [];
    let deslocamento = 0;

    for (const { nome, dados } of arquivos) {
        const nomeBuf = Buffer.from(nome, 'utf8');
        const crc = zlib.crc32
            ? zlib.crc32(dados)          // Node 20.12+
            : crc32(dados);              // fallback próprio

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);  // assinatura
        local.writeUInt16LE(20, 4);          // versão mínima
        local.writeUInt16LE(0, 6);           // flags
        local.writeUInt16LE(0, 8);           // método 0 = STORED
        local.writeUInt16LE(0, 10);          // hora
        local.writeUInt16LE(0, 12);          // data
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(dados.length, 18);
        local.writeUInt32LE(dados.length, 22);
        local.writeUInt16LE(nomeBuf.length, 26);
        local.writeUInt16LE(0, 28);          // sem campo extra

        locais.push(local, nomeBuf, dados);

        const entrada = Buffer.alloc(46);
        entrada.writeUInt32LE(0x02014b50, 0);
        entrada.writeUInt16LE(20, 4);
        entrada.writeUInt16LE(20, 6);
        entrada.writeUInt16LE(0, 8);
        entrada.writeUInt16LE(0, 10);
        entrada.writeUInt16LE(0, 12);
        entrada.writeUInt16LE(0, 14);
        entrada.writeUInt32LE(crc, 16);
        entrada.writeUInt32LE(dados.length, 20);
        entrada.writeUInt32LE(dados.length, 24);
        entrada.writeUInt16LE(nomeBuf.length, 28);
        entrada.writeUInt16LE(0, 30);
        entrada.writeUInt16LE(0, 32);
        entrada.writeUInt16LE(0, 34);
        entrada.writeUInt16LE(0, 36);
        entrada.writeUInt32LE(0, 38);
        entrada.writeUInt32LE(deslocamento, 42);

        central.push(entrada, nomeBuf);
        deslocamento += local.length + nomeBuf.length + dados.length;
    }

    const centralBuf = Buffer.concat(central);
    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(0, 4);
    fim.writeUInt16LE(0, 6);
    fim.writeUInt16LE(arquivos.length, 8);
    fim.writeUInt16LE(arquivos.length, 10);
    fim.writeUInt32LE(centralBuf.length, 12);
    fim.writeUInt32LE(deslocamento, 16);
    fim.writeUInt16LE(0, 20);

    return Buffer.concat([...locais, centralBuf, fim]);
}

/** CRC-32 para versões de Node sem `zlib.crc32`. */
let TABELA_CRC = null;
function crc32(buf) {
    if (!TABELA_CRC) {
        TABELA_CRC = new Int32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            TABELA_CRC[i] = c;
        }
    }
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ TABELA_CRC[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ -1) >>> 0;
}

function gerarDocx(conversa, nomeUsuario) {
    return montarZip([
        { nome: '[Content_Types].xml', dados: Buffer.from(CONTENT_TYPES_XML, 'utf8') },
        { nome: '_rels/.rels', dados: Buffer.from(RELS_XML, 'utf8') },
        { nome: 'word/document.xml', dados: Buffer.from(documentoXml(conversa, nomeUsuario), 'utf8') }
    ]);
}

// ─────────────────────────────────────────────────────────────────────────────

const TIPOS_MIME = {
    txt: 'text/plain; charset=utf-8',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

/** Nome de arquivo seguro a partir do título da conversa. */
function nomeArquivo(titulo, formato) {
    const base = String(titulo || 'conversa')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')  // tira acentos
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'conversa';
    return `${base}.${formato}`;
}

/**
 * @returns {Promise<{buffer: Buffer, mime: string, nome: string}>}
 */
async function exportar(conversa, formato, nomeUsuario) {
    const f = String(formato || 'txt').toLowerCase();
    if (!FORMATOS.includes(f)) {
        const erro = new Error(`Formato inválido. Use: ${FORMATOS.join(', ')}.`);
        erro.formatoInvalido = true;
        throw erro;
    }

    const buffer = f === 'pdf'
        ? await gerarPdf(conversa, nomeUsuario)
        : f === 'docx'
            ? gerarDocx(conversa, nomeUsuario)
            : gerarTxt(conversa, nomeUsuario);

    return { buffer, mime: TIPOS_MIME[f], nome: nomeArquivo(conversa.titulo, f) };
}

module.exports = { exportar, FORMATOS, nomeArquivo, montarZip, gerarTxt };
