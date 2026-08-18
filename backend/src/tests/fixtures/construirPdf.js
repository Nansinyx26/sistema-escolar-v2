/**
 * construirPdf.js — gera um PDF de teste a partir de linhas de texto.
 *
 * Existe para que a integração com `pdf-parse` seja exercitada de verdade (um
 * PDF real, gerado e relido) sem que nenhum PDF binário — muito menos um com
 * dado de aluno real — seja commitado no repositório.
 *
 * Usa o `pdfmake` que o backend já traz para emitir declarações e boletins.
 */

let printer = null;

function obterPrinter() {
    if (printer) return printer;
    const PdfPrinter = require('pdfmake');
    const vfsModule = require('pdfmake/build/vfs_fonts.js');
    const vfs = vfsModule.pdfMake?.vfs || vfsModule.vfs || vfsModule;
    const fonte = (nome) => Buffer.from(vfs[nome], 'base64');

    printer = new PdfPrinter({
        Roboto: {
            normal: fonte('Roboto-Regular.ttf'),
            bold: fonte('Roboto-Medium.ttf'),
            italics: fonte('Roboto-Italic.ttf'),
            bolditalics: fonte('Roboto-MediumItalic.ttf'),
        },
    });
    return printer;
}

/**
 * @param {string} texto conteúdo do PDF, uma linha por `\n`
 * @returns {Promise<Buffer>}
 */
function construirPdf(texto) {
    return new Promise((resolve, reject) => {
        const documento = obterPrinter().createPdfKitDocument({
            content: String(texto)
                .split('\n')
                .map((linha) => ({ text: linha, fontSize: 7 })),
            defaultStyle: { font: 'Roboto' },
            pageSize: 'A4',
            pageOrientation: 'landscape',
        });

        const pedacos = [];
        documento.on('data', (pedaco) => pedacos.push(pedaco));
        documento.on('end', () => resolve(Buffer.concat(pedacos)));
        documento.on('error', reject);
        documento.end();
    });
}

module.exports = { construirPdf };
