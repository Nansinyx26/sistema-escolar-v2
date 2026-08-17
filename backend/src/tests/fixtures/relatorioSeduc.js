/**
 * relatorioSeduc.js — fixtures SINTÉTICAS do relatório "Relação de Alunos por
 * Classe" da SEDUC-SP.
 *
 * ⚠️ TODO dado aqui é INVENTADO. Nenhum RA, nome ou data de nascimento real
 * entra no repositório — nem em teste, nem em comentário (§7.8). Os RAs usam a
 * faixa 90000000xxxx, que não corresponde a nenhuma numeração emitida.
 */

/**
 * Cabeçalho das COLUNAS, reproduzido com o erro de digitação "Defciência" que
 * o relatório oficial traz. É por causa dele que a regex de remoção precisa
 * tolerar as duas grafias — se o teste usasse só a forma correta, a regressão
 * passaria despercebida.
 */
const CABECALHO_COLUNAS_COM_ERRO =
    'Série Nr Nome do Aluno RA Dig. RA UF RA Data de Nascimento Situação ' +
    'Data Movimentação Defciência Transtorno(s) que impacta(m) o desenvolvimento da aprendizagem';

/** Mesma linha, com a grafia correta — o parser tem de aceitar as duas. */
const CABECALHO_COLUNAS_CORRETO = CABECALHO_COLUNAS_COM_ERRO.replace('Defciência', 'Deficiência');

/** Nomes sintéticos em caixa alta e com acento, como o relatório imprime. */
const NOMES = [
    'ANA CLARA FICTICIA DE SOUZA',
    'BRUNO INVENTADO LIMA',
    'CAMILA IMAGINARIA MOISÉS',
    'DANIEL SUPOSTO ARAÚJO',
    'ELISA HIPOTETICA RAMOS',
    'FABIO SIMULADO NUNES',
    'GABRIELA TESTADA PEREIRA',
    'HENRIQUE MODELO CARDOSO',
    'ISABELA EXEMPLO VIEIRA',
    'JOAO PEDRO AMOSTRA LOPES',
    'KARINA PROTOTIPO DIAS',
    'LUCAS RASCUNHO MENDES',
    'MARIA DAS DORES ENSAIO',
    'NATALIA ESBOCO TAVARES',
    'OTAVIO PLACEBO ROCHA',
    'PAULA REFERENCIA BRAGA',
    'QUEZIA SINTETICA MELO',
    'RAFAEL DEMONSTRA PINTO',
    'SOFIA VALIDACAO CUNHA',
    'THIAGO VINÍCIUS DE ARAÚJO RIBEIRO',
    'ULISSES FIGURADO SALES',
    'VANESSA APOCRIFA NEVES',
    'WAGNER ARBITRARIO FARIA',
    'XENIA POSTICA GOMES',
    'YASMIN ALEGORICA DUARTE',
    'ZECA ILUSTRATIVO BORGES',
    'ALICE PARADIGMA REIS',
    'BERNARDO ESQUEMA COSTA',
    'CECILIA MAQUETE ALVES',
    'DIOGO CENARIO BATISTA',
];

/** RA sintético determinístico para a posição `n` (1-based). */
function raSintetico(n) {
    return `90000000${String(n).padStart(4, '0')}`;
}

/** Dígito verificador alternando entre numérico e X — o X é o caso crítico. */
function digitoSintetico(n) {
    return n % 3 === 0 ? 'X' : String(n % 10);
}

/** Data de nascimento sintética, espalhada ao longo de 2014. */
function nascimentoSintetico(n) {
    const dia = String((n % 28) + 1).padStart(2, '0');
    const mes = String((n % 12) + 1).padStart(2, '0');
    return `${dia}/${mes}/2014`;
}

/**
 * Monta o texto de um relatório.
 *
 * @param {object} [opcoes]
 * @param {number} [opcoes.quantidade=30]        quantos alunos gerar
 * @param {number} [opcoes.cadastradosDeclarado] total declarado no cabeçalho
 *                                               (use diferente de `quantidade`
 *                                               para exercitar a divergência)
 * @param {boolean} [opcoes.nomePartido=false]   parte o nome do último aluno na
 *                                               quebra de página, deixando o
 *                                               fragmento final isolado no fim
 * @param {number} [opcoes.alunosPorPagina=20]   onde repetir o cabeçalho
 * @param {Array<object>} [opcoes.extras]        registros adicionais literais
 */
function montarRelatorio(opcoes = {}) {
    const {
        quantidade = 30,
        cadastradosDeclarado,
        nomePartido = false,
        alunosPorPagina = 20,
        extras = [],
    } = opcoes;

    const total = quantidade + extras.length;
    const declarado = cadastradosDeclarado === undefined ? total : cadastradosDeclarado;

    const linhas = [
        'Relação de Alunos por Classe',
        'Secretaria Escolar Digital',
        'Escola: 900001 - ESCOLA ESTADUAL SINTETICA DE TESTE NR. Classe: 7000001',
        'Tipo Ensino: ENSINO FUNDAMENTAL DE 9 ANOS Habilitação: 1 Sala: 012',
        'Turma: 5 ANO A - MANHA',
        `Ativos: ${Math.max(0, declarado - 1)} Transferidos: 0 Abandonos: 0 ` +
            `Não Comp.: ${declarado > 0 ? 1 : 0} Outros: 0 Cadastrados: ${declarado}`,
        CABECALHO_COLUNAS_COM_ERRO,
    ];

    for (let n = 1; n <= quantidade; n++) {
        if (n > 1 && (n - 1) % alunosPorPagina === 0) {
            linhas.push('Página 1 de 2');
            linhas.push(n % 2 === 0 ? CABECALHO_COLUNAS_CORRETO : CABECALHO_COLUNAS_COM_ERRO);
        }

        const nome = NOMES[(n - 1) % NOMES.length];
        const ancora = `${raSintetico(n)} ${digitoSintetico(n)} SP ${nascimentoSintetico(n)}`;

        // O aluno 2 exercita a colisão do §5.3: Situação "Não Comp." preenchida
        // JUNTO com Deficiência "Não".
        const cauda = n === 2 ? 'Não Comp. 15/03/2025 Não' : 'Não';

        const ultimo = n === quantidade;
        if (ultimo && nomePartido) {
            // Nome cortado pela quebra de página: o começo fica antes do
            // cabeçalho repetido, e o final aparece SOLTO no fim do documento.
            const palavras = nome.split(' ');
            const inicio = palavras.slice(0, -2).join(' ');
            const fim = palavras.slice(-2).join(' ');
            linhas.push(`5 ${n} ${inicio}`);
            linhas.push(CABECALHO_COLUNAS_COM_ERRO);
            linhas.push(`${ancora} ${cauda}`);
            linhas.push(fim);
        } else {
            linhas.push(`5 ${n} ${nome} ${ancora} ${cauda}`);
        }
    }

    for (const extra of extras) linhas.push(extra);

    linhas.push('Página 2 de 2');
    linhas.push('Impressão: 10/02/2026 - 09:15');

    return linhas.join('\n');
}

module.exports = {
    montarRelatorio,
    raSintetico,
    digitoSintetico,
    nascimentoSintetico,
    NOMES,
    CABECALHO_COLUNAS_COM_ERRO,
    CABECALHO_COLUNAS_CORRETO,
};
