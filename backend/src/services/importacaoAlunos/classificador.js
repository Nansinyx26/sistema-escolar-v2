/**
 * classificador.js — normaliza, valida e classifica cada linha lida do arquivo.
 *
 * Função PURA: recebe os registros crus dos parsers mais um retrato do que já
 * existe no banco, e devolve as linhas classificadas. Não consulta o banco —
 * quem faz isso é o controller, que monta os índices e passa para cá. Isso é o
 * que torna toda a regra de classificação testável sem Mongo.
 */

const {
    colapsarEspacos,
    normalizarNome,
    validarNome,
    normalizarRa,
    validarRa,
    validarDigitoRa,
    normalizarUfRa,
    parseDataBr,
    chaveData,
    validarNascimento,
    normalizarSituacao,
    normalizarSimNao,
    normalizarTranstornos,
    normalizarNumeroChamada,
    normalizarSerie,
} = require('./normalizacao');

/** Estados possíveis de uma linha na pré-visualização (§5.6). */
const STATUS = {
    NOVO: 'novo',
    EXISTENTE: 'existente',
    JA_NA_TURMA: 'ja_na_turma',
    DIVERGENTE: 'divergente',
    ERRO: 'erro',
    DUPLICADO_NO_ARQUIVO: 'duplicado_no_arquivo',
};

/** Status que entram marcados por padrão na tela de pré-visualização. */
const STATUS_MARCADOS_POR_PADRAO = new Set([STATUS.NOVO, STATUS.EXISTENTE, STATUS.DIVERGENTE]);

/** Status que o servidor aceita gravar. */
const STATUS_IMPORTAVEIS = new Set([STATUS.NOVO, STATUS.EXISTENTE, STATUS.DIVERGENTE]);

/**
 * Normaliza um registro cru para o formato que vai ao banco.
 * @returns {{dados: object, erros: string[], avisos: string[]}}
 */
function normalizarRegistro(registro, referenciaData = new Date()) {
    const erros = [];
    const avisos = [];

    const nome = validarNome(registro.nome);
    if (!nome.ok) erros.push(nome.motivo);

    const ra = validarRa(registro.ra);
    if (!ra.ok) erros.push(ra.motivo);

    // O dígito do RA vem vazio em planilha montada à mão com frequência. Falta
    // dele não invalida o aluno — ele é anotado como pendência, não como erro,
    // porque bloquear a importação inteira por causa de um caractere ausente
    // devolve a secretaria para a digitação manual.
    const digito = validarDigitoRa(registro.raDigito);
    if (!digito.ok && colapsarEspacos(registro.raDigito)) erros.push(digito.motivo);
    else if (!digito.ok) avisos.push('Dígito do RA não informado.');

    const nascimento = validarNascimento(registro.dataNascimento, referenciaData);
    if (!nascimento.ok) erros.push(nascimento.motivo);
    else avisos.push(...(nascimento.avisos || []));

    const dados = {
        nome: nome.ok ? nome.valor : colapsarEspacos(registro.nome),
        nomeNormalizado: normalizarNome(registro.nome),
        ra: normalizarRa(registro.ra),
        raDigito: digito.ok ? digito.valor : '',
        raUf: normalizarUfRa(registro.raUf),
        dataNascimento: nascimento.ok ? nascimento.valor : null,
        situacao: normalizarSituacao(registro.situacao),
        dataMovimentacao: parseDataBr(registro.dataMovimentacao),
        possuiDeficiencia: normalizarSimNao(registro.deficiencia),
        transtornos: normalizarTranstornos(registro.transtornos),
        serie: normalizarSerie(registro.serie),
        numeroChamada: normalizarNumeroChamada(registro.numeroChamada),
    };

    // Transtorno preenchido com a deficiência marcada como "Não" costuma ser
    // erro de leitura de coluna, não dado real. Avisa para o usuário conferir.
    if (!dados.possuiDeficiencia && dados.transtornos.length > 0) {
        avisos.push(
            'Há texto na coluna de transtornos, mas a deficiência está marcada como "Não". Confira.'
        );
    }

    return { dados, erros, avisos };
}

/**
 * Compara o que veio do arquivo com o cadastro atual do aluno.
 * @returns {Array<{campo: string, rotulo: string, atual: string, arquivo: string}>}
 */
function detectarDivergencias(dados, alunoAtual) {
    const divergencias = [];

    const nomeAtual = normalizarNome(`${alunoAtual.nome || ''} ${alunoAtual.sobrenome || ''}`);
    if (nomeAtual && dados.nomeNormalizado && nomeAtual !== dados.nomeNormalizado) {
        divergencias.push({
            campo: 'nome',
            rotulo: 'Nome',
            atual: colapsarEspacos(`${alunoAtual.nome || ''} ${alunoAtual.sobrenome || ''}`),
            arquivo: dados.nome,
        });
    }

    const nascimentoAtual = chaveData(alunoAtual.nascimento);
    const nascimentoArquivo = chaveData(dados.dataNascimento);
    if (nascimentoAtual && nascimentoArquivo && nascimentoAtual !== nascimentoArquivo) {
        divergencias.push({
            campo: 'dataNascimento',
            rotulo: 'Data de nascimento',
            atual: nascimentoAtual,
            arquivo: nascimentoArquivo,
        });
    }

    return divergencias;
}

/**
 * Classifica todas as linhas de uma importação.
 *
 * @param {object} entrada
 * @param {Array<object>} entrada.registros            saída de um dos parsers
 * @param {Map<string, object>} entrada.alunosPorRa    RA → aluno já cadastrado NA ESCOLA
 * @param {Set<string>} entrada.alunosJaNaTurma        _id dos alunos já matriculados nesta turma/ano
 * @param {Map<string, object>} [entrada.turmaAtualPorAluno] _id do aluno → { turmaId, turmaNome } de OUTRA turma no mesmo ano
 * @param {Date} [entrada.referenciaData]              "hoje", injetável para teste
 * @returns {{linhas: Array<object>, resumo: object}}
 */
function classificarLinhas({
    registros,
    alunosPorRa,
    alunosJaNaTurma,
    turmaAtualPorAluno,
    referenciaData = new Date(),
}) {
    const porRa =
        alunosPorRa instanceof Map ? alunosPorRa : new Map(Object.entries(alunosPorRa || {}));
    const naTurma =
        alunosJaNaTurma instanceof Set ? alunosJaNaTurma : new Set(alunosJaNaTurma || []);
    const emOutraTurma =
        turmaAtualPorAluno instanceof Map
            ? turmaAtualPorAluno
            : new Map(Object.entries(turmaAtualPorAluno || {}));

    const rasVistosNoArquivo = new Set();
    const linhas = [];

    (registros || []).forEach((registro, posicao) => {
        const { dados, erros, avisos } = normalizarRegistro(registro, referenciaData);
        const mensagens = [
            ...erros.map((texto) => ({ tipo: 'erro', texto })),
            ...avisos.map((texto) => ({ tipo: 'aviso', texto })),
        ];

        const linha = {
            indice: posicao,
            dadosBrutos: recortarBrutos(registro),
            dadosNormalizados: dados,
            status: STATUS.NOVO,
            mensagens,
            alunoExistenteId: null,
            divergencias: [],
            transferenciaDe: null,
        };

        // 1. Erro de validação vence tudo: sem RA ou sem nome não há como
        //    procurar duplicata nem gravar.
        if (erros.length > 0) {
            linha.status = STATUS.ERRO;
            linhas.push(linha);
            return;
        }

        // 2. RA repetido dentro do próprio arquivo — só a primeira ocorrência
        //    fica marcada.
        if (rasVistosNoArquivo.has(dados.ra)) {
            linha.status = STATUS.DUPLICADO_NO_ARQUIVO;
            linha.mensagens.push({
                tipo: 'aviso',
                texto: 'Este RA aparece mais de uma vez no arquivo. Só a primeira ocorrência será importada.',
            });
            linhas.push(linha);
            return;
        }
        rasVistosNoArquivo.add(dados.ra);

        // 3. Confronto com o que já existe na escola.
        const alunoAtual = porRa.get(dados.ra);
        if (!alunoAtual) {
            linha.status = STATUS.NOVO;
            linhas.push(linha);
            return;
        }

        linha.alunoExistenteId = String(alunoAtual._id);

        if (naTurma.has(String(alunoAtual._id))) {
            linha.status = STATUS.JA_NA_TURMA;
            linha.mensagens.push({
                tipo: 'info',
                texto: 'Já está matriculado nesta turma neste ano letivo.',
            });
            linhas.push(linha);
            return;
        }

        // Matriculado em OUTRA turma no mesmo ano letivo. Não é erro — é o caso
        // normal de remanejamento —, mas confirmar aqui vai TRANSFERIR o aluno,
        // e isso precisa estar escrito na tela antes de a pessoa clicar.
        const outraTurma = emOutraTurma.get(String(alunoAtual._id));
        if (outraTurma) {
            linha.transferenciaDe = {
                turmaId: String(outraTurma.turmaId || ''),
                turmaNome: outraTurma.turmaNome || '',
            };
            linha.mensagens.push({
                tipo: 'aviso',
                texto: `Já está matriculado na turma «${outraTurma.turmaNome || outraTurma.turmaId}» neste ano letivo. Importar aqui vai TRANSFERIR o aluno.`,
            });
        }

        const divergencias = detectarDivergencias(dados, alunoAtual);
        if (divergencias.length > 0) {
            linha.status = STATUS.DIVERGENTE;
            linha.divergencias = divergencias;
            linha.mensagens.push({
                tipo: 'aviso',
                texto: `Este RA já existe na escola com ${divergencias.map((d) => d.rotulo.toLowerCase()).join(' e ')} diferente(s). Escolha se o cadastro deve ser atualizado.`,
            });
        } else {
            linha.status = STATUS.EXISTENTE;
            linha.mensagens.push({
                tipo: 'info',
                texto: 'Aluno já cadastrado na escola — será apenas vinculado a esta turma.',
            });
        }

        linhas.push(linha);
    });

    return { linhas, resumo: resumir(linhas) };
}

/**
 * Guarda o registro cru para auditoria da importação, mas SÓ os campos que o
 * parser reconhece. Evita que texto arbitrário do arquivo entre no documento.
 */
const CAMPOS_BRUTOS = [
    'serie',
    'numeroChamada',
    'nome',
    'ra',
    'raDigito',
    'raUf',
    'dataNascimento',
    'situacao',
    'dataMovimentacao',
    'deficiencia',
    'transtornos',
];

function recortarBrutos(registro) {
    const bruto = {};
    for (const campo of CAMPOS_BRUTOS) {
        const valor = registro[campo];
        bruto[campo] = valor === null || valor === undefined ? '' : String(valor).slice(0, 300);
    }
    return bruto;
}

/** Contagem por status, no formato consumido pela tela de pré-visualização. */
function resumir(linhas) {
    const contar = (status) => linhas.filter((linha) => linha.status === status).length;
    return {
        total: linhas.length,
        novos: contar(STATUS.NOVO),
        existentes: contar(STATUS.EXISTENTE),
        divergentes: contar(STATUS.DIVERGENTE),
        jaNaTurma: contar(STATUS.JA_NA_TURMA),
        duplicados: contar(STATUS.DUPLICADO_NO_ARQUIVO),
        comErro: contar(STATUS.ERRO),
        importaveis: linhas.filter((linha) => STATUS_IMPORTAVEIS.has(linha.status)).length,
    };
}

/**
 * Confere a quantidade lida contra o total declarado no cabeçalho (§5.4).
 *
 * É o mecanismo de segurança mais importante do parser: qualquer falha de
 * segmentação — nome partido não remontado, âncora não reconhecida, página
 * inteira perdida — aparece aqui como número que não bate. NUNCA bloqueia a
 * importação: o usuário completa à mão o que faltou.
 */
function conferirTotais(totalDeclarado, totalLido) {
    if (totalDeclarado === null || totalDeclarado === undefined) {
        return { confere: null, mensagem: '' };
    }
    if (Number(totalDeclarado) === Number(totalLido)) {
        return { confere: true, mensagem: `${totalLido} de ${totalDeclarado} alunos lidos.` };
    }
    return {
        confere: false,
        mensagem: `O relatório declara ${totalDeclarado} alunos, mas foram identificados ${totalLido}. Revise a lista antes de confirmar.`,
    };
}

/**
 * Reduz o nome de uma turma às assinaturas "<série><letra>" que ela pode ter.
 *
 * A SED escreve "5 ANO A - MANHA"; o sistema guarda "5A". Comparar as duas
 * strings, mesmo por tokens, sempre dá diferente — e o aviso de turma trocada
 * dispararia em toda importação legítima, que é o jeito mais rápido de treinar
 * o usuário a ignorá-lo. Reduzindo as duas a "5a", elas se encontram.
 */
function assinaturasDeTurma(texto) {
    const normalizado = normalizarNome(texto || '');
    const assinaturas = new Set();
    if (!normalizado) return assinaturas;

    // Formas coladas: "5a", "5-a", "5 a" seguido de fim de palavra.
    for (const casamento of normalizado.matchAll(/(\d+)\s*-?\s*([a-z])(?![a-z])/g)) {
        assinaturas.add(casamento[1] + casamento[2]);
    }
    // Formas por extenso: "5 ano a" → número solto × letra solta.
    const numeros = normalizado.match(/\b\d+\b/g) || [];
    const letras = normalizado.match(/\b[a-z]\b/g) || [];
    for (const numero of numeros) for (const letra of letras) assinaturas.add(numero + letra);

    return assinaturas;
}

/**
 * Compara a turma de destino com o que o arquivo diz ser (§6, passo 2).
 * Aviso, não bloqueio: o nome da turma na SED e no sistema podem divergir
 * legitimamente.
 */
function conferirTurma(cabecalho, turmaDestino) {
    if (!cabecalho || !turmaDestino) return { confere: null, mensagem: '' };

    const textoArquivo = cabecalho.turma || '';
    const textoDestino = `${turmaDestino.nome || ''} ${turmaDestino.descricao || ''}`;
    if (!normalizarNome(textoArquivo) || !normalizarNome(textoDestino))
        return { confere: null, mensagem: '' };

    const doArquivo = assinaturasDeTurma(textoArquivo);
    const doDestino = assinaturasDeTurma(textoDestino);

    if (doArquivo.size > 0 && doDestino.size > 0) {
        const bate = [...doDestino].some((assinatura) => doArquivo.has(assinatura));
        if (bate) return { confere: true, mensagem: '' };
    } else {
        // Turma sem padrão "<série><letra>" (ex.: "TURMA VERDE"): cai para
        // sobreposição de palavras, que é o melhor sinal disponível.
        const tokensArquivo = new Set(
            normalizarNome(textoArquivo)
                .split(/[^a-z0-9]+/)
                .filter(Boolean)
        );
        const tokensDestino = normalizarNome(textoDestino)
            .split(/[^a-z0-9]+/)
            .filter(Boolean);
        if (tokensDestino.some((token) => tokensArquivo.has(token)))
            return { confere: true, mensagem: '' };
    }

    return {
        confere: false,
        mensagem: `Este relatório parece ser da turma «${colapsarEspacos(textoArquivo)}», mas você está importando para «${colapsarEspacos(turmaDestino.nome)}». Confirme antes de prosseguir.`,
    };
}

module.exports = {
    classificarLinhas,
    normalizarRegistro,
    detectarDivergencias,
    conferirTotais,
    conferirTurma,
    assinaturasDeTurma,
    resumir,
    STATUS,
    STATUS_IMPORTAVEIS,
    STATUS_MARCADOS_POR_PADRAO,
};
