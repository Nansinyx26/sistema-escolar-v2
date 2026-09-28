/**
 * Fábrica de mídias para os testes de direitos autorais (Issue #509): imagem
 * gerada com o sharp e MP3 com etiqueta ID3 montada byte a byte.
 */
const sharp = require('sharp');

function svg(fundo) {
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">` +
            `<rect width="400" height="300" fill="#${fundo}"/>` +
            `<circle cx="120" cy="150" r="80" fill="#e33"/>` +
            `<rect x="230" y="40" width="120" height="200" fill="#36c"/>` +
            `<polygon points="0,300 200,200 400,300" fill="#2a2"/></svg>`
    );
}

const SVG_DIFERENTE = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">` +
        `<rect width="400" height="300" fill="#fff"/>` +
        `<circle cx="300" cy="100" r="60" fill="#333"/>` +
        `<rect x="20" y="150" width="200" height="100" fill="#c93"/></svg>`
);

const imagemObra = () => sharp(svg('ffd')).jpeg().toBuffer();
const imagemDiferente = () => sharp(SVG_DIFERENTE).jpeg().toBuffer();
const reduzida = (buffer) => sharp(buffer).resize(200, 150).webp({ quality: 50 }).toBuffer();
const comCopyrightExif = (buffer, texto) =>
    sharp(buffer)
        .withExif({ IFD0: { Copyright: texto } })
        .jpeg()
        .toBuffer();

function syncsafe(n) {
    return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

function quadroId3(id, texto) {
    const dados = Buffer.concat([Buffer.from([0x00]), Buffer.from(texto, 'latin1')]);
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(dados.length);
    return Buffer.concat([Buffer.from(id, 'latin1'), tamanho, Buffer.from([0, 0]), dados]);
}

/** Um "fluxo MPEG" fictício: cabeçalho de quadro + enchimento determinístico. */
function fluxoAudio(semente = 1) {
    const corpo = Buffer.alloc(4096);
    for (let i = 0; i < corpo.length; i++) corpo[i] = (i * 31 + semente * 7) & 0xff;
    corpo[0] = 0xff;
    corpo[1] = 0xfb;
    return corpo;
}

/** MP3 com etiqueta ID3v2.3 contendo os quadros dados (ex.: { TIT2, TCOP }). */
function mp3({ quadros = {}, semente = 1 } = {}) {
    const corpoTag = Buffer.concat(Object.entries(quadros).map(([id, t]) => quadroId3(id, t)));
    const cabecalho = Buffer.concat([
        Buffer.from('ID3', 'latin1'),
        Buffer.from([0x03, 0x00, 0x00]),
        syncsafe(corpoTag.length),
    ]);
    return Buffer.concat([cabecalho, corpoTag, fluxoAudio(semente)]);
}

module.exports = { imagemObra, imagemDiferente, reduzida, comCopyrightExif, mp3 };
