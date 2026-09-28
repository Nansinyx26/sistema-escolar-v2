/**
 * Impressão digital e aviso de copyright embutido (Issue #509) — sem banco.
 */
const {
    LIMIAR_HAMMING,
    calcularImpressao,
    distanciaHamming,
    phashInformativo,
} = require('../services/direitosAutorais/impressaoDigital');
const {
    detectarAvisoCopyright,
    copyrightDoXmp,
    copyrightDoIptc,
} = require('../services/direitosAutorais/avisoCopyright');
const {
    imagemObra,
    imagemDiferente,
    reduzida,
    comCopyrightExif,
    mp3,
} = require('./fixturas/midiaDireitosAutorais');

describe('impressão digital', () => {
    it('reconhece a mesma imagem reduzida e recomprimida em WebP', async () => {
        const original = await imagemObra();
        const a = await calcularImpressao(original, 'image/jpeg');
        const b = await calcularImpressao(await reduzida(original), 'image/webp');

        expect(a.sha256).not.toBe(b.sha256);
        expect(phashInformativo(a.phash)).toBe(true);
        expect(distanciaHamming(a.phash, b.phash)).toBeLessThanOrEqual(LIMIAR_HAMMING);
    });

    it('distingue imagens diferentes', async () => {
        const a = await calcularImpressao(await imagemObra(), 'image/jpeg');
        const b = await calcularImpressao(await imagemDiferente(), 'image/jpeg');
        expect(distanciaHamming(a.phash, b.phash)).toBeGreaterThan(LIMIAR_HAMMING);
    });

    it('áudio re-etiquetado mantém o hash do conteúdo sonoro', async () => {
        const a = await calcularImpressao(mp3({ quadros: { TIT2: 'Faixa' } }), 'audio/mpeg');
        const b = await calcularImpressao(mp3({ quadros: { TIT2: 'Outro nome' } }), 'audio/mpeg');
        const c = await calcularImpressao(mp3({ semente: 2 }), 'audio/mpeg');

        expect(a.sha256).not.toBe(b.sha256);
        expect(a.conteudoHash).toBe(b.conteudoHash);
        expect(a.conteudoHash).not.toBe(c.conteudoHash);
    });

    it('ignora o que não é imagem nem áudio', async () => {
        expect(await calcularImpressao(Buffer.from('%PDF-1.7'), 'application/pdf')).toBeNull();
    });

    it('imagem lisa não entra na comparação aproximada', () => {
        expect(phashInformativo('0000000000000000')).toBe(false);
        expect(phashInformativo('ffffffffffffffff')).toBe(false);
    });
});

describe('aviso de copyright embutido', () => {
    it('lê o Copyright do EXIF', async () => {
        const foto = await comCopyrightExif(await imagemObra(), '(c) Banco de Imagens S.A.');
        expect(await detectarAvisoCopyright(foto, 'imagem')).toEqual({
            fonte: 'EXIF',
            texto: '(c) Banco de Imagens S.A.',
        });
    });

    it('imagem sem aviso passa', async () => {
        expect(await detectarAvisoCopyright(await imagemObra(), 'imagem')).toBeNull();
    });

    it('lê dc:rights e xmpRights:Marked do XMP', () => {
        const comDireitos =
            '<x:xmpmeta><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">© Editora X</rdf:li></rdf:Alt></dc:rights></x:xmpmeta>';
        expect(copyrightDoXmp(Buffer.from(comDireitos))).toBe('© Editora X');
        expect(copyrightDoXmp('<rdf:Description xmpRights:Marked="True"/>')).toMatch(/protegida/);
        expect(copyrightDoXmp('<rdf:Description xmpRights:Marked="False"/>')).toBeNull();
    });

    it('lê o CopyrightNotice (2:116) do IPTC', () => {
        const texto = Buffer.from('Agência Y', 'utf8');
        const tamanho = Buffer.alloc(2);
        tamanho.writeUInt16BE(texto.length);
        const iptc = Buffer.concat([Buffer.from([0x1c, 0x02, 0x74]), tamanho, texto]);
        expect(copyrightDoIptc(iptc)).toBe('Agência Y');
    });

    it('lê TCOP do ID3 e ignora MP3 sem ele', async () => {
        const comTcop = mp3({ quadros: { TIT2: 'Hit', TCOP: '2024 Gravadora Z' } });
        expect(await detectarAvisoCopyright(comTcop, 'audio')).toEqual({
            fonte: 'ID3',
            texto: '2024 Gravadora Z',
        });
        expect(
            await detectarAvisoCopyright(mp3({ quadros: { TIT2: 'Aula' } }), 'audio')
        ).toBeNull();
    });

    it('lê COPYRIGHT= do comentário Vorbis e ICOP do WAV', async () => {
        const ogg = Buffer.concat([
            Buffer.from('OggS'),
            Buffer.from([0x10, 0, 0, 0]),
            Buffer.from('COPYRIGHT=Selo W'),
        ]);
        expect(await detectarAvisoCopyright(ogg, 'audio')).toEqual({
            fonte: 'Vorbis',
            texto: 'Selo W',
        });

        const texto = Buffer.from('Estúdio V', 'latin1');
        const tam = Buffer.alloc(4);
        tam.writeUInt32LE(texto.length);
        const wav = Buffer.concat([
            Buffer.from('RIFF'),
            Buffer.alloc(4),
            Buffer.from('WAVELIST'),
            Buffer.alloc(8),
            Buffer.from('ICOP'),
            tam,
            texto,
        ]);
        expect(await detectarAvisoCopyright(wav, 'audio')).toEqual({
            fonte: 'RIFF',
            texto: 'Estúdio V',
        });
    });
});
