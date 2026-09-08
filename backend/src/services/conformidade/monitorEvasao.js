/**
 * monitorEvasao.js — leva os números reais da chamada ao motor da LDB.
 *
 * DIVISÃO DE TRABALHO
 * -------------------
 * `frequenciaLdb.js` sabe o que a lei exige a partir de dois números; este
 * arquivo sabe extrair esses dois números da collection `faltas`, que é bem
 * menos comportada do que a conta sugere.
 *
 * POR QUE CONTAR DIA, E NÃO REGISTRO
 * ----------------------------------
 * `Falta` guarda UM documento por aluno POR CHAMADA — e a chamada tem `materia`.
 * Uma escola que registra "Sala Principal" uma vez ao dia produz 1 documento;
 * uma que registra cinco aulas produz 5. Contar documentos faria a mesma
 * criança aparecer com 5 faltas onde a lei enxerga 1 dia, e o gatilho do
 * Conselho Tutelar (15 dias) dispararia com 3 dias de ausência.
 *
 * A ficha FICAI, o Conselho Tutelar e o art. 24 da LDB falam em DIAS. Por isso
 * o primeiro `$group` colapsa por (aluno, dia) antes de qualquer contagem:
 *
 *   • `diaDeFalta`  — o aluno não esteve presente em NENHUMA chamada do dia.
 *     É a ausência integral, a única que a secretaria pode declarar como "dia
 *     de falta" sem qualificar.
 *   • `diaParcial`  — faltou a parte do dia e esteve presente em outra. Não
 *     entra na contagem legal (não foi um dia perdido), mas vai devolvido à
 *     parte: é o primeiro sintoma de evasão, e some se a gente não olhar.
 *
 * O DENOMINADOR VEM DA CHAMADA, NÃO DO CALENDÁRIO
 * -----------------------------------------------
 * `diasLetivosRealizados` é a contagem de dias em que ESTE aluno teve chamada
 * registrada. Poderia vir do `CalendarioEscolar`, mas ali o dia letivo é um
 * evento que alguém precisa ter cadastrado — e escola que não cadastrou o
 * calendário inteiro apareceria com "0 dias letivos" e frequência indefinida
 * para a rede toda. A chamada é o registro que sempre existe quando houve aula.
 */

const Falta = require('../../models/Falta');
const Aluno = require('../../models/Aluno');
const { avaliarFrequencia, compararGravidade, DIAS_LETIVOS_PADRAO } = require('./frequenciaLdb');

/** A escola vive em São Paulo; o servidor, em UTC. Ver utils/formatarPresenca.js. */
const FUSO = 'America/Sao_Paulo';

/** Janela do ano letivo: 1º de janeiro a 31 de dezembro, no fuso da escola. */
function janelaDoAno(anoLetivo) {
    const ano = Number(anoLetivo) || new Date().getFullYear();
    return {
        ano,
        inicio: new Date(`${ano}-01-01T00:00:00-03:00`),
        fim: new Date(`${ano + 1}-01-01T00:00:00-03:00`),
    };
}

/**
 * Estágio comum das duas consultas: colapsa (aluno, dia) e classifica o dia.
 * Mantido em função porque a divergência entre o painel e a ficha individual
 * seria invisível em revisão e visível só no documento assinado.
 */
function estagiosPorDia(match) {
    return [
        { $match: match },
        {
            $group: {
                _id: {
                    aluno: '$aluno',
                    dia: { $dateToString: { format: '%Y-%m-%d', date: '$data', timezone: FUSO } },
                },
                chamadas: { $sum: 1 },
                presencas: { $sum: { $cond: ['$presente', 1, 0] } },
                ausencias: { $sum: { $cond: ['$presente', 0, 1] } },
                justificadas: {
                    $sum: {
                        $cond: [{ $and: [{ $not: ['$presente'] }, '$justificada'] }, 1, 0],
                    },
                },
            },
        },
        {
            $addFields: {
                // Ausência integral: nenhuma presença no dia e ao menos uma ausência.
                diaDeFalta: {
                    $cond: [
                        { $and: [{ $eq: ['$presencas', 0] }, { $gt: ['$ausencias', 0] }] },
                        1,
                        0,
                    ],
                },
                diaParcial: {
                    $cond: [
                        { $and: [{ $gt: ['$presencas', 0] }, { $gt: ['$ausencias', 0] }] },
                        1,
                        0,
                    ],
                },
            },
        },
    ];
}

/** Consolidado por aluno (sem as datas), para o painel da secretaria. */
async function consolidarPorAluno(match) {
    return Falta.aggregate([
        ...estagiosPorDia(match),
        {
            $group: {
                _id: '$_id.aluno',
                diasLetivosRealizados: { $sum: 1 },
                faltas: { $sum: '$diaDeFalta' },
                diasParciais: { $sum: '$diaParcial' },
                // Um dia de falta integral é "justificado" quando TODAS as
                // ausências daquele dia estão justificadas. Justificar uma aula
                // de cinco não justifica o dia.
                justificadas: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$diaDeFalta', 1] },
                                    { $eq: ['$justificadas', '$ausencias'] },
                                ],
                            },
                            1,
                            0,
                        ],
                    },
                },
            },
        },
    ]);
}

/**
 * Avalia a frequência de todos os alunos de um recorte e devolve a lista já
 * ordenada por urgência.
 *
 * @param {object} opcoes
 * @param {object} [opcoes.filtroEscola={}]  match de tenant (`escolaMatch(req.escolaId)`).
 * @param {number} [opcoes.anoLetivo]        ano de referência (padrão: o corrente).
 * @param {string[]} [opcoes.turmas]         restringe a estas turmas (professor vê só as suas).
 * @param {number} [opcoes.diasLetivosPrevistos=200]
 * @param {boolean} [opcoes.somenteAlertas=false] devolve só quem exige providência legal.
 * @returns {Promise<Array>} avaliações com dados de identificação do aluno.
 */
async function avaliarTurmas({
    filtroEscola = {},
    anoLetivo,
    turmas,
    diasLetivosPrevistos = DIAS_LETIVOS_PADRAO,
    somenteAlertas = false,
} = {}) {
    const { inicio, fim } = janelaDoAno(anoLetivo);
    const match = { ...filtroEscola, data: { $gte: inicio, $lt: fim } };
    if (Array.isArray(turmas) && turmas.length > 0) match.turma = { $in: turmas.map(String) };

    const consolidado = await consolidarPorAluno(match);
    if (consolidado.length === 0) return [];

    const ids = consolidado
        .map((linha) => linha._id)
        .filter((id) => id !== null && id !== undefined);
    const alunos = await Aluno.find({ ...filtroEscola, _id: { $in: ids } })
        .select('nome sobrenome turma matricula ativo situacao')
        .lean();
    const porId = new Map(alunos.map((a) => [String(a._id), a]));

    const avaliacoes = consolidado.map((linha) => {
        const aluno = porId.get(String(linha._id)) || {};
        const avaliacao = avaliarFrequencia({
            faltas: linha.faltas,
            justificadas: linha.justificadas,
            diasLetivosPrevistos,
            diasLetivosRealizados: linha.diasLetivosRealizados,
        });
        return {
            alunoId: linha._id,
            nome: [aluno.nome, aluno.sobrenome].filter(Boolean).join(' ') || 'Aluno não localizado',
            ra: aluno.matricula || null,
            turma: aluno.turma || null,
            situacao: aluno.situacao || null,
            diasParciais: linha.diasParciais,
            ...avaliacao,
        };
    });

    const visiveis = somenteAlertas
        ? avaliacoes.filter((a) => a.exigeComunicacaoConselho)
        : avaliacoes;

    return visiveis.sort(compararGravidade);
}

/**
 * Avalia UM aluno e devolve também a lista de dias faltados — a parte que a
 * ficha de encaminhamento ao Conselho Tutelar precisa discriminar.
 *
 * @returns {Promise<object|null>} null quando o aluno não existe no recorte.
 */
async function avaliarAluno({
    alunoId,
    filtroEscola = {},
    anoLetivo,
    diasLetivosPrevistos = DIAS_LETIVOS_PADRAO,
} = {}) {
    const aluno = await Aluno.findOne({ ...filtroEscola, _id: String(alunoId) }).lean();
    if (!aluno) return null;

    const { ano, inicio, fim } = janelaDoAno(anoLetivo);
    const dias = await Falta.aggregate([
        ...estagiosPorDia({
            ...filtroEscola,
            aluno: String(alunoId),
            data: { $gte: inicio, $lt: fim },
        }),
        { $sort: { '_id.dia': 1 } },
    ]);

    const diasDeFalta = dias.filter((d) => d.diaDeFalta === 1);
    const justificadas = diasDeFalta.filter((d) => d.justificadas === d.ausencias).length;

    const avaliacao = avaliarFrequencia({
        faltas: diasDeFalta.length,
        justificadas,
        diasLetivosPrevistos,
        diasLetivosRealizados: dias.length,
    });

    return {
        alunoId: String(aluno._id),
        anoLetivo: ano,
        nome: [aluno.nome, aluno.sobrenome].filter(Boolean).join(' '),
        ra: aluno.matricula || null,
        turma: aluno.turma || null,
        diasParciais: dias.filter((d) => d.diaParcial === 1).length,
        ...avaliacao,
        datasDeFalta: diasDeFalta.map((d) => ({
            data: d._id.dia,
            justificada: d.justificadas === d.ausencias,
        })),
    };
}

module.exports = { avaliarTurmas, avaliarAluno };
