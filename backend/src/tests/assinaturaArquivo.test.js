const { validarAssinatura } = require('../utils/assinaturaArquivo');

/** Monta um buffer que começa com os bytes dados e é preenchido depois. */
function comAssinatura(bytes, tamanho = 64) {
    const buf = Buffer.alloc(tamanho, 0x41); // 'A' de enchimento
    Buffer.from(bytes).copy(buf, 0);
    return buf;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const PDF = Array.from('%PDF-1.7', (c) => c.charCodeAt(0));
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const EXE_MZ = [0x4d, 0x5a, 0x90, 0x00];
const ELF = [0x7f, 0x45, 0x4c, 0x46];

describe('validarAssinatura — o conteúdo tem que bater com o tipo declarado', () => {
    it('aceita arquivos legítimos de cada família', () => {
        expect(validarAssinatura(comAssinatura(PNG), 'image/png').ok).toBe(true);
        expect(validarAssinatura(comAssinatura(JPEG), 'image/jpeg').ok).toBe(true);
        expect(validarAssinatura(comAssinatura(PDF), 'application/pdf').ok).toBe(true);
    });

    // docx/xlsx/pptx são ZIP por dentro, e desde a #415 não basta a assinatura:
    // o índice do pacote é lido para separar documento de compactado e para
    // achar macro. Os casos com ZIP montado de verdade estão em
    // `anexoCompactadoMacro.test.js`.
    it('recusa Office antigo (OLE2), que carrega macro no próprio arquivo', () => {
        const veredito = validarAssinatura(comAssinatura(OLE2), 'application/msword');
        expect(veredito.ok).toBe(false);
        expect(veredito.motivo).toMatch(/macro/i);
    });

    it('recusa ZIP sem índice legível declarado como docx', () => {
        const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        expect(validarAssinatura(comAssinatura(ZIP), docx).ok).toBe(false);
    });

    it('aceita webm da gravação de voz e mp4 do Safari', () => {
        const webm = comAssinatura([0x1a, 0x45, 0xdf, 0xa3]);
        expect(validarAssinatura(webm, 'audio/webm').ok).toBe(true);

        // ISO-BMFF: 4 bytes de tamanho e depois 'ftyp'
        const mp4 = comAssinatura([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]);
        expect(validarAssinatura(mp4, 'audio/mp4').ok).toBe(true);
        expect(validarAssinatura(mp4, 'video/mp4').ok).toBe(true);
    });

    it('recusa executável Windows disfarçado de PDF', () => {
        const resultado = validarAssinatura(comAssinatura(EXE_MZ), 'application/pdf');
        expect(resultado.ok).toBe(false);
        expect(resultado.motivo).toMatch(/executável Windows/i);
    });

    it('recusa binário ELF e script com shebang mesmo declarando texto', () => {
        expect(validarAssinatura(comAssinatura(ELF), 'text/plain').ok).toBe(false);

        const script = Buffer.from('#!/bin/sh\nrm -rf /\n');
        const resultado = validarAssinatura(script, 'text/plain');
        expect(resultado.ok).toBe(false);
        expect(resultado.motivo).toMatch(/shebang/i);
    });

    it('recusa quando a família não corresponde ao mimetype declarado', () => {
        // PNG de verdade, mas anunciado como PDF
        const resultado = validarAssinatura(comAssinatura(PNG), 'application/pdf');
        expect(resultado.ok).toBe(false);
        expect(resultado.motivo).toMatch(/não corresponde/i);
    });

    it('aceita texto de verdade e recusa binário rotulado como texto', () => {
        expect(validarAssinatura(Buffer.from('nome;nota\nAna;9.5\n'), 'text/csv').ok).toBe(true);

        const comNulo = Buffer.from([0x41, 0x00, 0x42, 0x43]);
        const resultado = validarAssinatura(comNulo, 'text/plain');
        expect(resultado.ok).toBe(false);
        expect(resultado.motivo).toMatch(/binário/i);
    });

    it('recusa arquivo vazio e mimetype fora da lista branca', () => {
        expect(validarAssinatura(Buffer.alloc(0), 'image/png').ok).toBe(false);
        expect(validarAssinatura(comAssinatura(PNG), 'application/x-msdownload').ok).toBe(false);
    });
});
