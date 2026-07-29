const { validarAssinatura } = require('../utils/assinaturaArquivo');

/** Monta um buffer que começa com os bytes dados e é preenchido depois. */
function comAssinatura(bytes, tamanho = 64) {
    const buf = Buffer.alloc(tamanho, 0x41); // 'A' de enchimento
    Buffer.from(bytes).copy(buf, 0);
    return buf;
}

const PNG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const JPEG = [0xFF, 0xD8, 0xFF];
const PDF = Array.from('%PDF-1.7', (c) => c.charCodeAt(0));
const ZIP = [0x50, 0x4B, 0x03, 0x04];
const OLE2 = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const EXE_MZ = [0x4D, 0x5A, 0x90, 0x00];
const ELF = [0x7F, 0x45, 0x4C, 0x46];

describe('validarAssinatura — o conteúdo tem que bater com o tipo declarado', () => {
    it('aceita arquivos legítimos de cada família', () => {
        expect(validarAssinatura(comAssinatura(PNG), 'image/png').ok).toBe(true);
        expect(validarAssinatura(comAssinatura(JPEG), 'image/jpeg').ok).toBe(true);
        expect(validarAssinatura(comAssinatura(PDF), 'application/pdf').ok).toBe(true);
        expect(validarAssinatura(comAssinatura(OLE2), 'application/msword').ok).toBe(true);
    });

    it('aceita docx/xlsx/pptx, que são ZIP por dentro', () => {
        const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        expect(validarAssinatura(comAssinatura(ZIP), docx).ok).toBe(true);
        expect(validarAssinatura(comAssinatura(ZIP), xlsx).ok).toBe(true);
    });

    it('aceita webm da gravação de voz e mp4 do Safari', () => {
        const webm = comAssinatura([0x1A, 0x45, 0xDF, 0xA3]);
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
