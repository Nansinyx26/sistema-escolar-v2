/**
 * parserPlanilha.js — leitura de XLSX e CSV para o mesmo formato de registro
 * que o `parserPdfSeduc` produz.
 *
 * Função PURA: recebe buffer, devolve objeto. Sem Express, sem Mongoose.
 */

const { lerXlsx } = require('./leitorXlsx');
const { colapsarEspacos, removerAcentos, formatarDataBr } = require('./normalizacao');

// ─── Encoding ────────────────────────────────────────────────────────────────

/**
 * Decodifica o buffer de um CSV para string.
 *
 * Relatório exportado no Windows costuma sair em ISO-8859-1 (Latin-1). Lido
 * como UTF-8, cada acento vira U+FFFD e "JOSÉ" chega ao banco como "JOS?" —
 * sem erro nenhum, o que é pior do que falhar. A detecção é por tentativa:
 * UTF-8 estrito primeiro; se o buffer não for UTF-8 válido, é Latin-1.
 */
function decodificarTexto(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return '';

    // BOMs explícitos decidem sozinhos.
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return buffer.subarray(3).toString('utf8');
    }
    if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
        return buffer.subarray(2).toString('utf16le');
    }
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
        const trocado = Buffer.from(buffer.subarray(2));
        trocado.swap16();
        return trocado.toString('utf16le');
    }

    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
        // Latin-1 é o `toString('latin1')` do Node: mapeia byte a byte para
        // U+0000–U+00FF, que é exatamente a definição do ISO-8859-1.
        return buffer.toString('latin1');
    }
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/** Detecta o separador olhando a primeira linha fora de aspas. */
function detectarSeparador(texto) {
    const primeiraLinha = texto.split(/\r?\n/, 1)[0] || '';
    let dentroDeAspas = false;
    const contagem = { ';': 0, ',': 0, '\t': 0 };

    for (const caractere of primeiraLinha) {
        if (caractere === '"') dentroDeAspas = !dentroDeAspas;
        else if (!dentroDeAspas && caractere in contagem) contagem[caractere]++;
    }

    return Object.keys(contagem).reduce(
        (melhor, atual) => (contagem[atual] > contagem[melhor] ? atual : melhor),
        ';'
    );
}

/**
 * Parser de CSV com aspas e quebra de linha embutida no campo.
 * @returns {Array<Array<string>>}
 */
function parsearCsvTexto(texto, separador) {
    const linhas = [];
    let campos = [];
    let campo = '';
    let dentroDeAspas = false;

    for (let i = 0; i < texto.length; i++) {
        const caractere = texto[i];

        if (dentroDeAspas) {
            if (caractere === '"') {
                if (texto[i + 1] === '"') {
                    campo += '"';
                    i++;
                } // aspas escapada
                else dentroDeAspas = false;
            } else {
                campo += caractere;
            }
            continue;
        }

        if (caractere === '"') {
            dentroDeAspas = true;
            continue;
        }
        if (caractere === separador) {
            campos.push(campo);
            campo = '';
            continue;
        }
        if (caractere === '\n' || caractere === '\r') {
            if (caractere === '\r' && texto[i + 1] === '\n') i++;
            campos.push(campo);
            linhas.push(campos);
            campos = [];
            campo = '';
            continue;
        }
        campo += caractere;
    }

    if (campo !== '' || campos.length > 0) {
        campos.push(campo);
        linhas.push(campos);
    }
    return linhas.filter((linha) => linha.some((valor) => String(valor).trim() !== ''));
}

// ─── Mapeamento de colunas ───────────────────────────────────────────────────

/** Cabeçalho → chave comparável: minúsculo, sem acento, sem pontuação. */
function normalizarCabecalho(texto) {
    return colapsarEspacos(
        removerAcentos(String(texto || ''))
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
    );
}

/**
 * Aliases aceitos por campo. A comparação é EXATA sobre o cabeçalho
 * normalizado — comparar por "contém" faria "numero ra" cair em
 * `numeroChamada` por causa do alias "numero".
 */
const ALIASES = {
    nome: ['nome', 'nome do aluno', 'aluno', 'nome completo', 'nome aluno'],
    ra: ['ra', 'n ra', 'no ra', 'numero ra', 'matricula', 'ra aluno', 'registro academico'],
    raDigito: ['dig ra', 'digito', 'dig', 'dv', 'digito ra', 'dig do ra'],
    raUf: ['uf ra', 'uf', 'uf do ra', 'estado'],
    dataNascimento: [
        'data de nascimento',
        'nascimento',
        'dt nasc',
        'data nasc',
        'data nascimento',
        'dt nascimento',
    ],
    numeroChamada: ['nr', 'n', 'numero', 'chamada', 'no', 'numero chamada', 'no chamada'],
    serie: ['serie', 'ano', 'serie ano'],
    situacao: ['situacao', 'status'],
    dataMovimentacao: [
        'data movimentacao',
        'data de movimentacao',
        'dt movimentacao',
        'movimentacao',
    ],
    deficiencia: ['deficiencia', 'possui deficiencia', 'pcd'],
    transtornos: [
        'transtornos',
        'transtorno',
        'transtorno s',
        'transtorno s que impacta m o desenvolvimento da aprendizagem',
    ],
};

const CAMPOS_OBRIGATORIOS = ['nome', 'ra', 'dataNascimento'];

/**
 * Associa cada coluna do arquivo a um campo do sistema.
 * @returns {{mapa: Object<string, number>, cabecalhos: string[], faltando: string[]}}
 */
function mapearColunas(linhaCabecalho) {
    const cabecalhos = (linhaCabecalho || []).map((celula) => normalizarCabecalho(celula));
    const mapa = {};

    for (const [campo, aliases] of Object.entries(ALIASES)) {
        const indice = cabecalhos.findIndex(
            (cabecalho) => cabecalho && aliases.includes(cabecalho)
        );
        if (indice >= 0) mapa[campo] = indice;
    }

    const faltando = CAMPOS_OBRIGATORIOS.filter((campo) => mapa[campo] === undefined);
    return { mapa, cabecalhos, faltando };
}

/** Uma linha do arquivo tem cabeçalho quando pelo menos dois campos são reconhecidos. */
function pareceCabecalho(linha) {
    return Object.keys(mapearColunas(linha).mapa).length >= 2;
}

// ─── Célula → string ─────────────────────────────────────────────────────────

/**
 * Converte o valor de uma célula em texto.
 *
 * O SheetJS não é o único a devolver três tipos para a coluna de data — o
 * nosso leitor faz o mesmo, porque o XLSX guarda os três: Date (quando o
 * formato da célula é de data), número (serial cru, quando não é) e string
 * (quando o autor digitou a data como texto). Os três chegam aqui.
 */
function celulaParaTexto(valor) {
    if (valor === null || valor === undefined) return '';
    if (valor instanceof Date) return formatarDataBr(valor);
    if (typeof valor === 'number') return String(valor);
    return colapsarEspacos(valor);
}

// ─── Entradas públicas ───────────────────────────────────────────────────────

/**
 * Converte a matriz de células em registros no formato do parser de PDF.
 *
 * @param {Array<Array<*>>} matriz
 * @param {Object<string, number>} [mapaManual] mapeamento coluna→campo escolhido pelo usuário
 */
function matrizParaRegistros(matriz, mapaManual) {
    const avisos = [];
    if (!matriz || matriz.length === 0) {
        return {
            registros: [],
            avisos: ['O arquivo não contém nenhuma linha de dados.'],
            colunas: [],
            faltando: CAMPOS_OBRIGATORIOS,
        };
    }

    const temCabecalho = !mapaManual && pareceCabecalho(matriz[0]);
    const { mapa: mapaAutomatico, cabecalhos } = mapearColunas(matriz[0]);
    const mapa = mapaManual || mapaAutomatico;

    if (!mapaManual && !temCabecalho) {
        return {
            registros: [],
            avisos: [
                'Não foi possível identificar o cabeçalho das colunas. Faça o mapeamento manual.',
            ],
            colunas: (matriz[0] || []).map((celula) => celulaParaTexto(celula)),
            faltando: CAMPOS_OBRIGATORIOS,
        };
    }

    const faltandoFinal = CAMPOS_OBRIGATORIOS.filter((campo) => mapa[campo] === undefined);
    if (faltandoFinal.length > 0) {
        return {
            registros: [],
            avisos: [
                `Colunas obrigatórias não identificadas: ${faltandoFinal.join(', ')}. Faça o mapeamento manual.`,
            ],
            colunas: cabecalhos,
            faltando: faltandoFinal,
        };
    }

    const registros = [];
    const inicio = mapaManual ? 1 : temCabecalho ? 1 : 0;

    for (let i = inicio; i < matriz.length; i++) {
        const linha = matriz[i] || [];
        const ler = (campo) =>
            mapa[campo] === undefined ? '' : celulaParaTexto(linha[mapa[campo]]);

        const registro = {
            indice: registros.length,
            serie: ler('serie'),
            numeroChamada: ler('numeroChamada'),
            nome: ler('nome'),
            ra: ler('ra'),
            raDigito: ler('raDigito'),
            raUf: ler('raUf'),
            dataNascimento: ler('dataNascimento'),
            situacao: ler('situacao'),
            dataMovimentacao: ler('dataMovimentacao'),
            deficiencia: ler('deficiencia'),
            transtornos: ler('transtornos'),
        };

        // Linha totalmente vazia não vira registro nem erro.
        if (!Object.values(registro).some((valor) => typeof valor === 'string' && valor !== ''))
            continue;
        registros.push(registro);
    }

    if (registros.length === 0) avisos.push('O arquivo tem cabeçalho, mas nenhuma linha de aluno.');

    return { registros, avisos, colunas: cabecalhos, faltando: [] };
}

/** Buffer CSV → registros. */
function parsearCsv(buffer, mapaManual) {
    const texto = decodificarTexto(buffer);
    if (!colapsarEspacos(texto)) {
        return {
            cabecalho: cabecalhoVazio(),
            registros: [],
            avisos: ['O arquivo CSV está vazio.'],
            colunas: [],
            faltando: CAMPOS_OBRIGATORIOS,
            totalDeclarado: null,
        };
    }
    const matriz = parsearCsvTexto(texto, detectarSeparador(texto));
    return {
        cabecalho: cabecalhoVazio(),
        totalDeclarado: null,
        ...matrizParaRegistros(matriz, mapaManual),
    };
}

/** Buffer XLSX → registros. */
function parsearXlsx(buffer, mapaManual) {
    const matriz = lerXlsx(buffer);
    return {
        cabecalho: cabecalhoVazio(),
        totalDeclarado: null,
        ...matrizParaRegistros(matriz, mapaManual),
    };
}

/**
 * Planilha não traz o cabeçalho institucional do relatório da SED. Devolver a
 * mesma forma que o parser de PDF mantém o consumidor único.
 */
function cabecalhoVazio() {
    return {
        codigoEscola: '',
        nomeEscola: '',
        codigoClasse: '',
        tipoEnsino: '',
        habilitacao: '',
        sala: '',
        turma: '',
        totais: null,
    };
}

module.exports = {
    parsearCsv,
    parsearXlsx,
    matrizParaRegistros,
    mapearColunas,
    // exportados para teste unitário
    decodificarTexto,
    detectarSeparador,
    parsearCsvTexto,
    normalizarCabecalho,
    celulaParaTexto,
    ALIASES,
    CAMPOS_OBRIGATORIOS,
};
