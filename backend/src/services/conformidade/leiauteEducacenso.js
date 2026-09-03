/**
 * leiauteEducacenso.js — o arquivo de migração do Censo Escolar.
 *
 * O QUE MUDA EM RELAÇÃO AO JSON
 * -----------------------------
 * `educacenso.js` produz um lote em JSON: estável, auditável e ótimo para a
 * secretaria conferir. Só que o sistema do INEP não importa JSON — ele importa
 * um arquivo de texto delimitado por `|`, uma linha por registro, começando
 * pelo número do registro.
 *
 * O PROBLEMA REAL: O LEIAUTE MUDA TODO ANO
 * ----------------------------------------
 * O INEP publica, a cada edição, o Caderno de Instruções e o leiaute de
 * migração — e campos entram, saem e mudam de posição entre um ano e outro.
 * Um gerador com a ordem dos campos escrita no meio da lógica precisa ser
 * caçado inteiro a cada edição, e o erro só aparece quando o sistema do INEP
 * recusa o arquivo, geralmente na semana do prazo.
 *
 * Por isso o leiaute é DADO, não código: um array por registro, com o nome do
 * campo e de onde ele sai. Atualizar para a edição do ano é editar essa
 * estrutura — não a função que escreve o arquivo.
 *
 * LEIA ISTO ANTES DE ENTREGAR O ARQUIVO AO INEP
 * ---------------------------------------------
 * A definição abaixo é uma BASE e está marcada com a versão a que corresponde.
 * Ela não substitui a conferência contra o caderno da edição corrente. O
 * `cabecalho.versaoLeiaute` do lote acompanha o arquivo justamente para que
 * ninguém entregue um arquivo montado com a referência do ano passado sem
 * perceber.
 *
 * POR QUE O GERADOR SE RECUSA A ESCREVER COM PENDÊNCIA
 * ---------------------------------------------------
 * Um arquivo gerado com aluno sem data de nascimento é aceito pelo nosso código
 * e recusado pelo INEP — no melhor caso. No pior, entra com campo vazio e a
 * matrícula é declarada errada, o que afeta o repasse do Fundeb. A recusa aqui
 * é o único momento em que ainda dá tempo de corrigir o cadastro.
 */

const { VERSAO_LEIAUTE } = require('./educacenso');

/** Delimitador do arquivo de migração do Educacenso. */
const SEPARADOR = '|';

/**
 * Ordem dos campos por registro.
 *
 * `origem` é a chave dentro do lote (`cabecalho` para o registro 00, o registro
 * do aluno para os demais); `constante` escreve um valor fixo. Campo ausente
 * vira string vazia — que é como o leiaute representa "não informado".
 */
const REGISTROS = {
    // Registro 00 — identificação da escola. Uma linha por arquivo.
    '00': [
        { nome: 'registro', constante: '00' },
        { nome: 'codigoInepEscola', origem: 'codigoInepEscola' },
        { nome: 'anoCenso', origem: 'anoCenso' },
        { nome: 'nomeInstituicao', origem: 'nomeInstituicao' },
        { nome: 'municipio', origem: 'municipio' },
        { nome: 'dependenciaAdministrativa', origem: 'dependenciaAdministrativa' },
    ],
    // Registro 30 — pessoa física (o estudante). Uma linha por aluno.
    30: [
        { nome: 'registro', constante: '30' },
        { nome: 'codigoInepPessoa', origem: 'codigoInep' },
        { nome: 'identificacaoUnica', origem: 'ra' },
        { nome: 'nome', origem: 'nome' },
        { nome: 'dataNascimento', origem: 'dataNascimento', formato: 'dataBr' },
        { nome: 'sexo', origem: 'sexo' },
        { nome: 'corRaca', origem: 'corRaca' },
        { nome: 'nacionalidade', origem: 'nacionalidade' },
        { nome: 'cpf', origem: 'cpf' },
        { nome: 'possuiDeficiencia', origem: 'possuiDeficiencia', formato: 'booleano' },
        { nome: 'tipoDeficiencia', origem: 'tipoDeficiencia' },
    ],
    // Registro 60 — vínculo do aluno com a turma. Uma linha por matrícula.
    60: [
        { nome: 'registro', constante: '60' },
        { nome: 'codigoInepPessoa', origem: 'codigoInep' },
        { nome: 'identificacaoUnica', origem: 'ra' },
        { nome: 'turma', origem: 'turma' },
        { nome: 'situacao', origem: 'situacao' },
    ],
};

/** aaaa-mm-dd → dd/mm/aaaa, que é o formato de data do leiaute. */
function dataBr(valor) {
    if (!valor) return '';
    const partes = String(valor).slice(0, 10).split('-');
    return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : '';
}

function formatar(valor, formato) {
    if (valor === null || valor === undefined) return '';
    if (formato === 'dataBr') return dataBr(valor);
    if (formato === 'booleano') return valor ? '1' : '0';
    return String(valor);
}

/**
 * O `|` é o separador do arquivo: um valor que o contenha quebraria o
 * alinhamento de TODAS as colunas seguintes daquela linha, e o INEP leria
 * "turma" no lugar de "nome". Nome de aluno não costuma ter `|`, mas campo de
 * texto livre (tipo de deficiência) pode ter qualquer coisa que alguém digitou.
 */
function sanitizar(texto) {
    return (
        String(texto)
            .replace(/[|\r\n]+/g, ' ')
            // Colapsa o espaço que sobra da substituição: "visão | lupa" viraria
            // "visão   lupa", com três espaços no meio de um campo de arquivo
            // oficial. Não quebra nada, mas é sujeira que ninguém consegue
            // explicar depois.
            .replace(/\s{2,}/g, ' ')
            .trim()
    );
}

function montarLinha(campos, fonte) {
    return campos
        .map((campo) =>
            sanitizar(
                campo.constante !== undefined
                    ? campo.constante
                    : formatar(fonte[campo.origem], campo.formato)
            )
        )
        .join(SEPARADOR);
}

/**
 * Gera o arquivo de migração a partir do lote de `educacenso.montarLote`.
 *
 * @param {object} lote saída de `montarLote`.
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.permitirPendencias=false] escreve mesmo com cadastro
 *   incompleto. Só use para conferência interna — ver o cabeçalho.
 * @returns {{conteudo: string, linhas: number, versaoLeiaute: string}}
 * @throws {Error} quando há pendência e `permitirPendencias` é falso.
 */
function gerarArquivo(lote, { permitirPendencias = false } = {}) {
    const pendenciasEscola = lote?.pendenciasEscola || [];
    const pendenciasAlunos = lote?.pendencias || [];

    if (!permitirPendencias && (pendenciasEscola.length > 0 || pendenciasAlunos.length > 0)) {
        const erro = new Error(
            'O lote tem pendências e o arquivo do Censo não foi gerado. ' +
                `Escola: ${pendenciasEscola.length} pendência(s); ` +
                `alunos: ${pendenciasAlunos.length} cadastro(s) incompleto(s).`
        );
        erro.codigo = 'EDUCACENSO_LOTE_INCOMPLETO';
        erro.pendenciasEscola = pendenciasEscola;
        erro.pendencias = pendenciasAlunos;
        throw erro;
    }

    const linhas = [montarLinha(REGISTROS['00'], lote.cabecalho || {})];
    for (const aluno of lote.alunos || []) {
        linhas.push(montarLinha(REGISTROS['30'], aluno));
        linhas.push(montarLinha(REGISTROS['60'], aluno));
    }

    return {
        // Termina com quebra de linha: arquivo de migração sem quebra final é
        // recusado por leitores que contam registros por linha.
        conteudo: `${linhas.join('\n')}\n`,
        linhas: linhas.length,
        versaoLeiaute: VERSAO_LEIAUTE,
    };
}

module.exports = { SEPARADOR, REGISTROS, gerarArquivo, dataBr, sanitizar };
