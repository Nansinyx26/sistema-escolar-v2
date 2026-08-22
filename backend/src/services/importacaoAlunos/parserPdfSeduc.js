/**
 * parserPdfSeduc.js — leitor do relatório "Relação de Alunos por Classe" da
 * SEDUC-SP (exportado da SED).
 *
 * Função PURA: recebe texto (ou buffer) e devolve objeto. Sem Express, sem
 * Mongoose, sem log — quem chama decide o que fazer com o resultado.
 *
 * POR QUE ESTE PARSER É ASSIM
 * ---------------------------
 * O texto que sai de um PDF não tem colunas: tem uma sequência de fragmentos na
 * ordem em que o gerador os desenhou. Tentar casar a linha inteira de um aluno
 * com uma regex falha, porque:
 *   - o nome quebra em várias linhas e a largura das colunas varia;
 *   - o cabeçalho das colunas se repete a cada página, às vezes GRUDADO no
 *     último registro da página anterior;
 *   - Situação e Deficiência ambas podem conter a palavra "Não".
 *
 * A saída é ancorada no único trecho rígido do registro: RA + dígito + UF +
 * data de nascimento. Tudo o mais é deduzido em volta dessa âncora.
 */

const { colapsarEspacos, removerAcentos, SITUACOES_RELATORIO } = require('./normalizacao');

// ─── Cabeçalho do documento ──────────────────────────────────────────────────
// Sempre `\s+`, nunca espaço literal: o extrator de texto colapsa e expande
// espaçamento de forma imprevisível entre uma exportação e outra.

const RE_ESCOLA = /Escola:\s*(\d+)\s*-\s*(.+?)\s*(?:NR\.)?\s*Classe:\s*(\d+)/i;
const RE_ENSINO = /Tipo\s+Ensino:\s*(.+?)\s*Habilita[çc][ãa]o:\s*(\S+)\s*Sala:\s*(\S+)/i;
const RE_TURMA = /Turma:\s*(.+?)\s*$/im;
const RE_TOTAIS =
    /Ativos:\s*(\d+).*?Transferidos:\s*(\d+).*?Abandonos:\s*(\d+).*?N[ãa]o\s*Comp\.?:\s*(\d+).*?Outros:\s*(\d+).*?Cadastrados:\s*(\d+)/is;

/**
 * Cabeçalho das COLUNAS, que se repete a cada página.
 *
 * `Def[i]?ci[êe]ncia` não é descuido: o relatório oficial da SED traz o erro de
 * digitação "Defciência", sem o `i`. Uma regex que só aceite a grafia correta
 * deixa o cabeçalho da página 2 em diante dentro do texto, e ele vira nome de
 * aluno.
 */
const RE_CABECALHO_COLUNAS =
    /S[ée]rie\s*Nr\s*Nome\s+do\s+Aluno\s*RA\s*Dig\.?\s*RA\s*UF\s*RA\s*Data\s+de\s*Nascimento\s*Situa[çc][ãa]o\s*Data\s*Movimenta[çc][ãa]o\s*Def[i]?ci[êe]ncia\s*Transtorno\(s\)[\s\S]*?aprendizagem/gi;

/** Rodapés e numeração de página. */
const RES_RODAPE = [
    // Separador de página que o pdf-parse insere entre as páginas extraídas.
    // Não vem do documento, mas chega no texto como se viesse.
    /--\s*\d+\s+of\s+\d+\s*--/gi,
    /P[áa]gina\s*:?\s*\d+\s*(?:de|\/)\s*\d+/gi,
    /Impress[ãa]o\s*:?\s*\d{2}\/\d{2}\/\d{4}(?:\s*[-–]?\s*\d{2}:\d{2}(?::\d{2})?)?/gi,
    /Data\s+da\s+Impress[ãa]o\s*:?\s*\d{2}\/\d{2}\/\d{4}/gi,
    /Secretaria\s+Escolar\s+Digital/gi,
    /Secretaria\s+da\s+Educa[çc][ãa]o\s+do\s+Estado\s+de\s+S[ãa]o\s+Paulo/gi,
    /Rela[çc][ãa]o\s+de\s+Alunos\s+por\s+Classe/gi,
];

/**
 * A ÂNCORA: RA (12 dígitos) + dígito verificador + UF + data de nascimento.
 *
 * `[0-9Xx]` no dígito, nunca `\d`: o DV do RA paulista pode ser X, e há vários
 * no relatório de referência. Trocar por `\d` faz esses alunos sumirem sem
 * nenhum erro visível — o registro simplesmente não é reconhecido.
 */
const RE_ANCORA = /(\d{12})\s+([0-9Xx])\s+([A-Za-z]{2})\s+(\d{2}\/\d{2}\/\d{4})/g;

/**
 * `<série> <nr> <NOME>` no FIM do segmento.
 *
 * O nome é exigido em CAIXA ALTA (é como o relatório imprime). Isso é o que
 * impede a regex de morder a cauda do registro anterior: "Ativo", "Não" e
 * "Transferido" têm minúsculas e não casam com a classe do nome, então o
 * motor continua procurando e para no par série/número correto.
 */
const RE_SERIE_NR_NOME_ESTRITA = /(\d{1,2})\s+(\d{1,3})\s+([A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’.\- ]*?)\s*$/;
/** Fallback tolerante, para exportações que não usem caixa alta. */
const RE_SERIE_NR_NOME_RELAXADA = /(\d{1,2})\s+(\d{1,3})\s+(\p{L}[\s\S]*?)\s*$/u;

const RE_DATA = /\b(\d{2}\/\d{2}\/\d{4})\b/;
const RE_SIM_NAO = /\b(Sim|N[ãa]o)\b/i;

/**
 * Normaliza o texto extraído antes de segmentar.
 *
 * Ordem importa: o cabeçalho das colunas é removido ANTES do colapso de
 * espaços, porque a regex dele tolera quebras de linha mas fica mais frágil
 * depois que tudo vira uma linha só.
 */
function normalizarTexto(bruto) {
    let texto = String(bruto || '').replace(/\r\n?/g, '\n');
    texto = texto.replace(/\u00a0/g, ' '); // NBSP vira espaço comum
    texto = texto.replace(RE_CABECALHO_COLUNAS, ' ');
    for (const re of RES_RODAPE) texto = texto.replace(re, ' ');
    return colapsarEspacos(texto);
}

/** Lê o bloco de cabeçalho do documento. Campo ausente vira string vazia/null. */
function extrairCabecalho(textoOriginal, textoNormalizado) {
    const cabecalho = {
        codigoEscola: '',
        nomeEscola: '',
        codigoClasse: '',
        tipoEnsino: '',
        habilitacao: '',
        sala: '',
        turma: '',
        totais: null,
    };

    const escola = RE_ESCOLA.exec(textoNormalizado);
    if (escola) {
        cabecalho.codigoEscola = escola[1];
        cabecalho.nomeEscola = colapsarEspacos(escola[2]);
        cabecalho.codigoClasse = escola[3];
    }

    const ensino = RE_ENSINO.exec(textoNormalizado);
    if (ensino) {
        cabecalho.tipoEnsino = colapsarEspacos(ensino[1]);
        cabecalho.habilitacao = ensino[2];
        cabecalho.sala = ensino[3];
    }

    // Turma é lida do texto ORIGINAL: `RE_TURMA` termina em `$` multiline, e
    // no texto colapsado (linha única) ela engoliria o documento inteiro.
    const turma = RE_TURMA.exec(String(textoOriginal || ''));
    if (turma) cabecalho.turma = colapsarEspacos(turma[1]);

    const totais = RE_TOTAIS.exec(textoNormalizado);
    if (totais) {
        cabecalho.totais = {
            ativos: +totais[1],
            transferidos: +totais[2],
            abandonos: +totais[3],
            naoCompareceram: +totais[4],
            outros: +totais[5],
            cadastrados: +totais[6],
        };
    }

    return cabecalho;
}

/**
 * Onde termina o bloco de cabeçalho — o segmento anterior à PRIMEIRA âncora
 * começa daí, não do byte 0, senão o nome do primeiro aluno vem colado ao
 * "Ativos: 30 Transferidos: 0 ...".
 */
function fimDoCabecalho(texto) {
    const totais = RE_TOTAIS.exec(texto);
    if (totais) return totais.index + totais[0].length;
    const ensino = RE_ENSINO.exec(texto);
    if (ensino) return ensino.index + ensino[0].length;
    const escola = RE_ESCOLA.exec(texto);
    if (escola) return escola.index + escola[0].length;
    return 0;
}

/**
 * Parseia a CAUDA de um registro — o que vem depois de `RA dig UF data` e
 * antes do próximo `<série> <nr> <nome>`.
 *
 * A ORDEM DOS PASSOS É OBRIGATÓRIA (§5.3). A coluna Situação pode conter
 * "Não Comp." e a coluna Deficiência contém "Não". Se a deficiência fosse lida
 * primeiro, o "Não" de "Não Comp." seria consumido como deficiência e sobraria
 * um "Comp." órfão virando transtorno. Situação sai primeiro, por lista
 * fechada; só o que restar é oferecido ao teste de Sim/Não.
 */
function parsearCauda(cauda) {
    let resto = colapsarEspacos(cauda);
    const resultado = { situacao: '', dataMovimentacao: '', deficiencia: '', transtornos: '' };

    // 1. Situação, por lista fechada e ancorada no INÍCIO da cauda.
    const alvo = removerAcentos(resto).toLowerCase();
    for (const [rotulo] of SITUACOES_RELATORIO) {
        const chave = removerAcentos(rotulo).toLowerCase();
        if (alvo.startsWith(chave)) {
            resultado.situacao = rotulo;
            resto = colapsarEspacos(resto.slice(rotulo.length));
            break;
        }
    }

    // 2. Data de movimentação.
    const data = RE_DATA.exec(resto);
    if (data) {
        resultado.dataMovimentacao = data[1];
        resto = colapsarEspacos(
            `${resto.slice(0, data.index)} ${resto.slice(data.index + data[0].length)}`
        );
    }

    // 3. Deficiência — agora que o "Não" de "Não Comp." já saiu de cena.
    const simNao = RE_SIM_NAO.exec(resto);
    if (simNao) {
        resultado.deficiencia = simNao[1];
        resto = colapsarEspacos(
            `${resto.slice(0, simNao.index)} ${resto.slice(simNao.index + simNao[0].length)}`
        );
    }

    // 4. O que sobrou é transtorno, se não for ruído de pontuação.
    if (/\p{L}/u.test(resto)) resultado.transtornos = resto;

    return resultado;
}

/**
 * Separa um segmento em `[cauda do registro anterior, série, nr, nome]`.
 * @returns {{cauda: string, serie: string, numeroChamada: string, nome: string}|null}
 *          null quando o segmento não traz `<série> <nr> <nome>` — nesse caso
 *          ele é fragmento de continuação de nome (ver §5.2, armadilha 1).
 */
function dividirSegmento(segmento) {
    const texto = colapsarEspacos(segmento);
    if (!texto) return null;

    const casamento = RE_SERIE_NR_NOME_ESTRITA.exec(texto) || RE_SERIE_NR_NOME_RELAXADA.exec(texto);
    if (!casamento) return null;

    return {
        cauda: colapsarEspacos(texto.slice(0, casamento.index)),
        serie: casamento[1],
        numeroChamada: casamento[2],
        nome: colapsarEspacos(casamento[3]),
    };
}

/**
 * Parseia o texto já extraído do PDF.
 *
 * @param {string} textoBruto texto extraído do PDF
 * @returns {{cabecalho: object, registros: Array, avisos: Array<string>, totalDeclarado: number|null}}
 */
function parsearTextoSeduc(textoBruto) {
    const texto = normalizarTexto(textoBruto);
    const cabecalho = extrairCabecalho(textoBruto, texto);
    const avisos = [];

    if (!texto) {
        return {
            cabecalho,
            registros: [],
            avisos: ['O documento não contém texto legível.'],
            totalDeclarado: null,
        };
    }

    RE_ANCORA.lastIndex = 0;
    const ancoras = [...texto.matchAll(RE_ANCORA)];

    if (ancoras.length === 0) {
        return {
            cabecalho,
            registros: [],
            avisos: [
                'Nenhum aluno foi identificado no documento. Confirme que é o relatório "Relação de Alunos por Classe" da SED e que o PDF não é uma imagem digitalizada.',
            ],
            totalDeclarado: cabecalho.totais ? cabecalho.totais.cadastrados : null,
        };
    }

    const registros = [];
    let cursor = fimDoCabecalho(texto);

    for (let i = 0; i < ancoras.length; i++) {
        const ancora = ancoras[i];
        const segmento = texto.slice(cursor, ancora.index);
        cursor = ancora.index + ancora[0].length;

        const partes = dividirSegmento(segmento);

        if (!partes) {
            // Segmento sem `<série> <nr>`: é continuação do nome do aluno
            // anterior (o nome atravessou a quebra de página). Concatena em vez
            // de criar um registro novo — mas AVISA, porque a âncora deste
            // trecho fica sem dono e o total do cabeçalho vai acusar.
            const fragmento = colapsarEspacos(segmento);
            if (registros.length > 0 && fragmento) {
                const anterior = registros[registros.length - 1];
                anterior.nome = colapsarEspacos(`${anterior.nome} ${fragmento}`);
                avisos.push(
                    `Trecho na posição ${i + 1} foi tratado como continuação do nome anterior; confira esse registro.`
                );
            } else if (fragmento) {
                avisos.push(`Trecho na posição ${i + 1} não pôde ser associado a nenhum aluno.`);
            }
            continue;
        }

        // A cauda do segmento pertence ao registro ANTERIOR, não a este.
        if (registros.length > 0 && partes.cauda) {
            Object.assign(registros[registros.length - 1], parsearCauda(partes.cauda));
        }

        registros.push({
            indice: registros.length,
            serie: partes.serie,
            numeroChamada: partes.numeroChamada,
            nome: partes.nome,
            ra: ancora[1],
            raDigito: ancora[2].toUpperCase(),
            raUf: ancora[3].toUpperCase(),
            dataNascimento: ancora[4],
            situacao: '',
            dataMovimentacao: '',
            deficiencia: '',
            transtornos: '',
        });
    }

    // Sobra depois da ÚLTIMA âncora. Pode ser a cauda do último registro
    // (situação/deficiência/transtorno) e/ou o pedaço final de um nome que foi
    // partido pela quebra de página e reordenado pela extração de texto.
    const sobra = colapsarEspacos(texto.slice(cursor));
    if (sobra && registros.length > 0) {
        const ultimo = registros[registros.length - 1];
        const cauda = parsearCauda(sobra);
        Object.assign(ultimo, cauda);

        // O que a cauda não reconheceu como situação/data/Sim-Não sobrou em
        // "transtornos" — mas pode ser, na verdade, o final do nome que a
        // quebra de página arrancou e a extração de texto jogou para o fim do
        // documento. É exatamente o caso do registro nº 30 do relatório de
        // referência.
        if (cauda.transtornos && ehContinuacaoDeNome(cauda.transtornos, ultimo.nome)) {
            ultimo.nome = colapsarEspacos(`${ultimo.nome} ${cauda.transtornos}`);
            ultimo.transtornos = '';
            avisos.push(
                `O nome do aluno nº ${ultimo.numeroChamada || registros.length} foi remontado a partir de uma quebra de página; confira esse registro.`
            );
        }
    }

    return {
        cabecalho,
        registros,
        avisos,
        totalDeclarado: cabecalho.totais ? cabecalho.totais.cadastrados : null,
    };
}

const PREPOSICOES_NOME = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E']);

/**
 * Decide se um trecho solto é o final de um nome partido ou o conteúdo da
 * coluna "Transtorno(s)".
 *
 * Não há como distinguir com certeza — os dois são texto livre na mesma
 * posição. O que separa os dois na prática:
 *   - o relatório imprime NOME em caixa alta e sem dígito; um transtorno vem
 *     como prosa ("Dislexia", "Transtorno do Espectro Autista") ou com vírgula
 *     entre itens, e nenhum dos dois passa no teste de caixa alta;
 *   - resta a colisão com sigla ("TDAH"). Ela é resolvida exigindo DUAS
 *     palavras, ou uma preposição ligando o fragmento ao nome anterior —
 *     "... VINÍCIUS DE" + "ARAÚJO RIBEIRO" é a assinatura da quebra.
 *
 * Errar aqui não corrompe dado silenciosamente: o resultado aparece na
 * pré-visualização, é editável linha a linha e ainda passa pela conferência de
 * totais do §5.4.
 */
function ehContinuacaoDeNome(trecho, nomeAnterior) {
    const texto = colapsarEspacos(trecho);
    if (!texto || /\d/.test(texto)) return false;
    if (!/^[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ'’.\- ]*$/.test(texto)) return false;

    const palavras = texto.split(' ').filter(Boolean);
    if (palavras.length >= 2) return true;

    const palavrasAnteriores = colapsarEspacos(nomeAnterior).split(' ').filter(Boolean);
    const ultimaAnterior = removerAcentos(
        palavrasAnteriores[palavrasAnteriores.length - 1] || ''
    ).toUpperCase();
    const primeiraAtual = removerAcentos(palavras[0] || '').toUpperCase();

    return PREPOSICOES_NOME.has(ultimaAnterior) || PREPOSICOES_NOME.has(primeiraAtual);
}

/**
 * Extrai o texto de um PDF em memória.
 *
 * O buffer NUNCA é gravado em disco: o Render tem filesystem efêmero e o
 * arquivo carrega dado pessoal de criança. Ele é lido, convertido em texto e
 * liberado por quem chamou.
 */
async function extrairTextoPdf(buffer) {
    const { PDFParse } = require('pdf-parse');
    let parser = null;
    try {
        parser = new PDFParse({ data: buffer });
        const resultado = await parser.getText();
        return String(resultado?.text || '');
    } finally {
        if (parser) {
            try {
                await parser.destroy();
            } catch {
                /* liberação best-effort */
            }
        }
    }
}

/** Buffer do PDF → resultado do parse. */
async function parsearPdfSeduc(buffer) {
    const texto = await extrairTextoPdf(buffer);
    return parsearTextoSeduc(texto);
}

module.exports = {
    parsearTextoSeduc,
    parsearPdfSeduc,
    extrairTextoPdf,
    // exportados para teste unitário
    normalizarTexto,
    extrairCabecalho,
    parsearCauda,
    dividirSegmento,
    RE_ANCORA,
    RE_CABECALHO_COLUNAS,
};
