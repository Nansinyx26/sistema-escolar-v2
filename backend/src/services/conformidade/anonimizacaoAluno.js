/**
 * anonimizacaoAluno.js — o direito ao esquecimento sem apagar o que a lei manda guardar.
 *
 * O CONFLITO
 * ----------
 * A LGPD (art. 18, VI) dá ao titular o direito à eliminação dos dados quando o
 * tratamento não é mais necessário — e o aluno que saiu da rede é exatamente
 * esse caso. Mas a LDB obriga a escola a manter o histórico escolar e os dados
 * de escrituração, e o INEP precisa da série estatística. Apagar o registro
 * inteiro é ilegal; deixá-lo intacto para sempre também.
 *
 * A saída que a própria LGPD desenha (art. 12) é a ANONIMIZAÇÃO: o dado deixa
 * de ser pessoal quando não permite mais identificar a pessoa. Some o nome,
 * some o CPF, some o endereço — ficam as notas, as faltas, a turma e a
 * situação, que continuam contando a história pedagógica sem dizer de quem.
 *
 * POR QUE O PLANO É UMA FUNÇÃO PURA
 * ---------------------------------
 * `planoDeAnonimizacao` devolve o `$set`/`$unset` sem tocar no banco. Isso
 * torna testável a única coisa que realmente importa aqui: a LISTA de campos.
 * Um campo esquecido na lista é dado pessoal que sobrevive à anonimização — e o
 * defeito é invisível, porque a operação "funciona" e a tela mostra o
 * pseudônimo enquanto o CPF continua no documento.
 *
 * É IRREVERSÍVEL, E ISSO É O PONTO
 * --------------------------------
 * Não existe desfazer. Uma anonimização reversível não anonimiza nada — se a
 * aplicação consegue restaurar o nome, o dado nunca deixou de ser pessoal. Por
 * isso o controller exige confirmação explícita e a operação fica com a gestão
 * da unidade, nunca com o professor.
 *
 * O QUE ESTE MÓDULO NÃO FAZ
 * -------------------------
 * Não emite o histórico escolar. A escola precisa ter emitido e arquivado o
 * documento ANTES — depois da anonimização não há mais de quem emitir. O
 * controller cobra essa confirmação de quem opera; o sistema não tem como
 * verificá-la sozinho, e fingir que tem seria pior.
 */

const crypto = require('node:crypto');

/**
 * Situações em que a anonimização é legítima. Aluno `ativo` fica de fora: a
 * escola ainda tem dever de guarda e de contato com a família dele, e anonimizar
 * quem está matriculado quebraria a chamada, o boletim e a comunicação.
 * `remanejado` também fica de fora — remanejamento é movimentação DENTRO da
 * rede, e o aluno continua sendo aluno de alguém.
 */
const SITUACOES_ELEGIVEIS = ['transferido', 'abandono', 'nao_compareceu', 'outros'];

/**
 * Campos que carregam identificação direta ou indireta. Cada linha aqui é uma
 * decisão sobre dado de criança; a lista é longa de propósito — é mais seguro
 * revisar um campo a mais do que descobrir um a menos depois.
 */
const CAMPOS_IDENTIFICADORES = [
    // Identificação direta
    'sobrenome',
    'matricula',
    'raDigito',
    'raUf',
    'cpfAluno',
    'codigoInep',
    'codigoSecreto',
    'nascimento',
    'sexo',
    'religiao',
    'foto',
    // Contato e localização — o que permite chegar até a pessoa
    'endereco',
    'telefone',
    'responsavel',
    'responsavelDados',
    'responsaveis',
    'pessoasAutorizadasRetirada',
    'guardaLegal',
    'autorizacoesEscolares',
    // Dado sensível de saúde (LGPD, art. 11) — nunca é necessário para estatística
    'alergiasAlimentos',
    'alergiasRemedio',
    'planoSaude',
    'deficiencia',
    'transtornos',
    'documentos',
    'lgpdConsentimento',
    // Texto livre: é onde nome de irmão, apelido e endereço reaparecem
    'observacoes',
    'observacoesBimestre',
    'descricao',
    'condicaoOutro',
];

/**
 * Campos preservados, e o porquê de cada grupo:
 *
 *   • notas, faltas, faltasBimestre, nivel, nivelBimestre, mediaGeral,
 *     mediaInterna, recuperacaoBimestre — a vida escolar, que sustenta
 *     estatística pedagógica e o histórico exigido pela LDB;
 *   • turma, turmaId, escolaId, situacao, dataMovimentacao — o recorte que
 *     torna a estatística utilizável (taxa por turma, evasão por escola);
 *   • pcd (booleano) — a CONTAGEM de estudantes com deficiência é indicador
 *     obrigatório; o `deficiencia` em texto, que descreve a condição de uma
 *     pessoa específica, esse sim é apagado acima;
 *   • etnia — indicador do Censo. Sozinha, num universo anonimizado, não
 *     identifica; junto com nome e data de nascimento, identificaria — e esses
 *     dois estão na lista de cima.
 */
const CAMPOS_PRESERVADOS = [
    'notas',
    'faltas',
    'faltasBimestre',
    'nivel',
    'nivelBimestre',
    'mediaGeral',
    'mediaInterna',
    'recuperacaoBimestre',
    'turma',
    'turmaId',
    'escolaId',
    'situacao',
    'dataMovimentacao',
    'pcd',
    'etnia',
];

/** Rótulo estável e não reversível para a tela e para os relatórios. */
function pseudonimo(alunoId) {
    const digest = crypto
        .createHash('sha256')
        .update(`aluno-anonimizado:${String(alunoId)}`)
        .digest('hex')
        .slice(0, 6)
        .toUpperCase();
    return `Aluno anonimizado ${digest}`;
}

/**
 * Verifica se a anonimização pode ser executada.
 *
 * @returns {{permitido: boolean, motivo?: string}}
 */
function podeAnonimizar(aluno) {
    if (!aluno) return { permitido: false, motivo: 'Aluno não encontrado.' };
    if (aluno.anonimizadoEm) {
        return { permitido: false, motivo: 'Este cadastro já foi anonimizado.' };
    }
    const situacao = aluno.situacao || 'ativo';
    if (!SITUACOES_ELEGIVEIS.includes(situacao)) {
        return {
            permitido: false,
            motivo:
                `Só é possível anonimizar aluno com situação ${SITUACOES_ELEGIVEIS.join(', ')} — ` +
                `a situação atual é "${situacao}". Registre a movimentação antes.`,
        };
    }
    return { permitido: true };
}

/**
 * Monta a atualização que anonimiza o cadastro.
 *
 * @param {object} aluno documento de Aluno (`.lean()`).
 * @param {object} [opcoes]
 * @param {string} [opcoes.executadoPor] identificação de quem operou (auditoria).
 * @param {Date}   [opcoes.em=new Date()]
 * @returns {{$set: object, $unset: object, pseudonimo: string, camposRemovidos: string[]}}
 */
function planoDeAnonimizacao(aluno, { executadoPor, em } = {}) {
    const agora = em instanceof Date ? em : new Date();
    const nome = pseudonimo(aluno._id);

    const $unset = {};
    for (const campo of CAMPOS_IDENTIFICADORES) {
        // Só remove o que existe: `$unset` de campo ausente é ruído no
        // documento de atualização e mascara a lista real do que saiu.
        if (aluno[campo] !== undefined && aluno[campo] !== null) $unset[campo] = '';
    }

    return {
        $set: {
            nome,
            // `nomeNormalizado` é a chave de busca por nome. Deixá-la com o nome
            // real faria a secretaria encontrar a criança digitando o nome dela
            // — a anonimização teria mudado só a etiqueta da tela.
            nomeNormalizado: nome.toLowerCase(),
            ativo: false,
            anonimizadoEm: agora,
            anonimizadoPor: executadoPor || null,
        },
        $unset,
        pseudonimo: nome,
        camposRemovidos: Object.keys($unset),
    };
}

module.exports = {
    SITUACOES_ELEGIVEIS,
    CAMPOS_IDENTIFICADORES,
    CAMPOS_PRESERVADOS,
    pseudonimo,
    podeAnonimizar,
    planoDeAnonimizacao,
};
