/**
 * zip.js — monta arquivos ZIP de verdade para os testes.
 *
 * Desde a Issue #415 não basta o anexo começar com a assinatura de ZIP: o
 * índice do arquivo é lido para separar documento do Office de compactado
 * comum e para achar macro dentro do pacote. Um buffer de quatro bytes, que
 * antes servia de fixture de `.docx`, agora cai no ramo "não deu para ler" e
 * é recusado — com razão.
 *
 * Método "armazenado" (sem compressão): nada aqui precisa ser descompactado,
 * e assim a fixture não depende de biblioteca nenhuma.
 */

/**
 * @param {Record<string,string>} entradas nome da peça → conteúdo
 * @returns {Buffer}
 */
function montarZip(entradas) {
    const locais = [];
    const centrais = [];
    let deslocamento = 0;

    for (const [nome, conteudo] of Object.entries(entradas)) {
        const nomeBuf = Buffer.from(nome, 'utf8');
        const dados = Buffer.from(conteudo, 'utf8');

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 8); // armazenado
        local.writeUInt32LE(0, 14); // crc — a leitura do índice não confere
        local.writeUInt32LE(dados.length, 18);
        local.writeUInt32LE(dados.length, 22);
        local.writeUInt16LE(nomeBuf.length, 26);
        locais.push(local, nomeBuf, dados);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 10);
        central.writeUInt32LE(0, 16);
        central.writeUInt32LE(dados.length, 20);
        central.writeUInt32LE(dados.length, 24);
        central.writeUInt16LE(nomeBuf.length, 28);
        central.writeUInt32LE(deslocamento, 42);
        centrais.push(central, nomeBuf);

        deslocamento += local.length + nomeBuf.length + dados.length;
    }

    const corpo = Buffer.concat(locais);
    const diretorio = Buffer.concat(centrais);
    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(Object.keys(entradas).length, 8);
    fim.writeUInt16LE(Object.keys(entradas).length, 10);
    fim.writeUInt32LE(diretorio.length, 12);
    fim.writeUInt32LE(corpo.length, 16);

    return Buffer.concat([corpo, diretorio, fim]);
}

/** `.docx` mínimo e legítimo: pacote do Office, sem macro. */
function docxSemMacro() {
    return montarZip({
        '[Content_Types].xml': '<Types/>',
        '_rels/.rels': '<Relationships/>',
        'word/document.xml': '<w:document/>',
    });
}

/** O mesmo pacote com o projeto VBA dentro — é o que `.docm` traz. */
function docxComMacro() {
    return montarZip({
        '[Content_Types].xml': '<Types/>',
        'word/document.xml': '<w:document/>',
        'word/vbaProject.bin': 'MACRO',
    });
}

/** Compactado comum: sem `[Content_Types].xml`, não é pacote do Office. */
function zipComum() {
    return montarZip({ 'boletim.pdf': '%PDF-1.7', 'foto.jpg': 'xxxx' });
}

module.exports = { montarZip, docxSemMacro, docxComMacro, zipComum };
