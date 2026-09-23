/**
 * anexoCompactadoMacro.test.js — Issue #415.
 *
 * O envio do chat aceitava ZIP, RAR, 7z e Office antigo, e não havia antivírus
 * no caminho: o anexo ia inteiro para o GridFS e era baixado do outro lado por
 * uma família ou por quem trabalha na escola. Compactado esconde o conteúdo do
 * único filtro que existe (a checagem de assinatura), e macro executa na
 * máquina de quem abre.
 *
 * A prova que interessa é a invertida: o arquivo perigoso é RECUSADO mesmo
 * quando o rótulo mente. E o contrário — PDF, imagem e .docx sem macro —
 * continua passando, senão a escola migra a conversa para o WhatsApp e o
 * arquivo sai de vez do controle.
 */
const { validarAssinatura } = require('../utils/assinaturaArquivo');
const { inspecionarZip } = require('../utils/pacoteOoxml');
const uploadChat = require('../middleware/uploadChat');
const { montarZip, docxSemMacro, docxComMacro, zipComum } = require('./fixturas/zip');

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ZIPs montados byte a byte em `fixturas/zip.js`: o que está sendo verificado
// é a leitura do ÍNDICE do arquivo, que fica no fim. Um buffer que só comece
// com a assinatura de ZIP cairia sempre no ramo "não deu para ler" e o teste
// passaria sem provar nada.
const DOCX_LIMPO = docxSemMacro();
const DOCM = docxComMacro();
const ZIP_COMUM = zipComum();

function comAssinatura(bytes, tamanho = 64) {
    const buf = Buffer.alloc(tamanho, 0x41);
    Buffer.from(bytes).copy(buf, 0);
    return buf;
}

const RAR = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07];
const SETE_ZIP = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_SO_ASSINATURA = comAssinatura([0x50, 0x4b, 0x03, 0x04]);

describe('#415 — compactado e macro não entram no chat', () => {
    describe('a lista branca do upload', () => {
        it('não aceita mais ZIP, RAR nem 7z', () => {
            for (const mime of [
                'application/zip',
                'application/x-zip-compressed',
                'application/x-rar-compressed',
                'application/vnd.rar',
                'application/x-7z-compressed',
            ]) {
                expect(uploadChat.ALLOWED.has(mime)).toBe(false);
                expect(uploadChat.EXT_POR_MIME[mime]).toBeUndefined();
            }
        });

        it('não aceita Office antigo nem Office com macro', () => {
            for (const mime of [
                'application/msword',
                'application/vnd.ms-excel',
                'application/vnd.ms-powerpoint',
                'application/vnd.ms-word.document.macroenabled.12',
                'application/vnd.ms-excel.sheet.macroenabled.12',
                'application/vnd.ms-powerpoint.presentation.macroenabled.12',
            ]) {
                expect(uploadChat.ALLOWED.has(mime)).toBe(false);
            }
        });

        it('continua aceitando PDF, imagem, docx/xlsx/pptx, áudio e vídeo', () => {
            for (const mime of [
                'application/pdf',
                'image/jpeg',
                'image/png',
                DOCX,
                XLSX,
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'audio/webm',
                'video/mp4',
                'text/plain',
            ]) {
                expect(uploadChat.ALLOWED.has(mime)).toBe(true);
            }
        });

        it('a recusa diz o que enviar no lugar', () => {
            expect(uploadChat.MENSAGEM_POR_MOTIVO.compactado).toMatch(/separadamente/i);
            expect(uploadChat.MENSAGEM_POR_MOTIVO.macro).toMatch(/docx/);
            expect(uploadChat.MENSAGEM_POR_MOTIVO['office-antigo']).toMatch(/PDF/);
        });
    });
});

describe('#415 — o conteúdo, não o rótulo', () => {
    it('recusa ZIP comum que se declara .docx', () => {
        const veredito = validarAssinatura(ZIP_COMUM, DOCX);
        expect(veredito.ok).toBe(false);
        expect(veredito.motivo).toMatch(/compactado/i);
    });

    it('recusa documento com macro disfarçado de .docx', () => {
        const veredito = validarAssinatura(DOCM, DOCX);
        expect(veredito.ok).toBe(false);
        expect(veredito.motivo).toMatch(/macro/i);
    });

    it('recusa RAR e 7z declarados como PDF', () => {
        expect(validarAssinatura(comAssinatura(RAR), 'application/pdf').motivo).toMatch(
            /compactado/i
        );
        expect(validarAssinatura(comAssinatura(SETE_ZIP), 'application/pdf').motivo).toMatch(
            /compactado/i
        );
    });

    it('recusa Office antigo (OLE2), venha rotulado como vier', () => {
        for (const mime of [DOCX, 'application/pdf', 'application/msword']) {
            const veredito = validarAssinatura(comAssinatura(OLE2), mime);
            expect(veredito.ok).toBe(false);
            expect(veredito.motivo).toMatch(/macro/i);
        }
    });

    it('recusa ZIP sem índice legível: não dá para provar que não tem macro', () => {
        expect(validarAssinatura(ZIP_SO_ASSINATURA, DOCX).ok).toBe(false);
        expect(validarAssinatura(DOCX_LIMPO.subarray(0, 20), DOCX).ok).toBe(false);
    });
});

describe('#415 — o que a escola manda todo dia continua passando', () => {
    it('aceita .docx e .xlsx sem macro', () => {
        expect(validarAssinatura(DOCX_LIMPO, DOCX).ok).toBe(true);
        expect(validarAssinatura(DOCX_LIMPO, XLSX).ok).toBe(true);
    });

    it('aceita PDF e imagem', () => {
        expect(validarAssinatura(Buffer.from('%PDF-1.7 conteudo'), 'application/pdf').ok).toBe(
            true
        );
        const png = comAssinatura([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        expect(validarAssinatura(png, 'image/png').ok).toBe(true);
    });

    it('aceita o áudio da gravação de voz', () => {
        const webm = comAssinatura([0x1a, 0x45, 0xdf, 0xa3]);
        expect(validarAssinatura(webm, 'audio/webm').ok).toBe(true);
    });
});

describe('#415 — inspecionarZip classifica pelo índice', () => {
    it('separa pacote do Office, pacote com macro e compactado comum', () => {
        expect(inspecionarZip(DOCX_LIMPO).tipo).toBe('office');
        expect(inspecionarZip(DOCM).tipo).toBe('office-com-macro');
        expect(inspecionarZip(ZIP_COMUM).tipo).toBe('compactado');
        expect(inspecionarZip(ZIP_SO_ASSINATURA).tipo).toBe('ilegivel');
    });

    it('acha a macro mesmo com a barra invertida que compactador de Windows grava', () => {
        const nomeComBarraInvertida = ['word', 'vbaProject.bin'].join(String.fromCharCode(92));
        const pacote = montarZip({
            '[Content_Types].xml': '<Types/>',
            [nomeComBarraInvertida]: 'MACRO',
        });
        expect(inspecionarZip(pacote).tipo).toBe('office-com-macro');
    });
});
