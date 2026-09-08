/**
 * dadosAbertos.js — indicadores agregados para o Portal da Transparência (LAI).
 *
 * O CONFLITO QUE ESTE ARQUIVO RESOLVE
 * -----------------------------------
 * A Lei de Acesso à Informação (Lei 12.527/2011) obriga o município a publicar
 * dados educacionais; a LGPD proíbe expor dado pessoal de criança. As duas
 * valem ao mesmo tempo, e o encontro delas é onde as prefeituras erram: publica-
 * se uma tabela "aprovação por turma" e, na turma de 8 alunos com 1 reprovado,
 * a comunidade inteira sabe quem é.
 *
 * ANONIMIZAR NÃO É TIRAR O NOME
 * -----------------------------
 * Retirar o identificador direto é o passo óbvio e insuficiente. O risco real é
 * a REIDENTIFICAÇÃO por cruzamento: célula pequena o bastante identifica a
 * pessoa mesmo sem nome. Por isso todo recorte publicado aqui passa por
 * `agruparPequenos`, que aplica supressão com limiar (k-anonimato, k=5).
 *
 * E POR QUE NÃO BASTA APAGAR A CÉLULA PEQUENA
 * -------------------------------------------
 * Se a soma total continua publicada, esconder UMA célula não esconde nada:
 * subtrai-se o resto e o valor volta. É a supressão complementar clássica. Aqui
 * as células pequenas são somadas num balde "Outros"; se esse balde ainda ficar
 * abaixo do limiar, a menor célula pública é puxada para dentro dele até que o
 * balde deixe de identificar alguém. É por isso que a função é iterativa e não
 * um `filter`.
 *
 * O QUE NUNCA SAI DAQUI
 * ---------------------
 * Nenhuma função deste módulo devolve `_id` de aluno, nome, RA, data de
 * nascimento ou qualquer campo de saúde. A saída é contagem e média. Se um dia
 * alguém precisar do dado individual para a Secretaria, isso é outra rota, com
 * outro perfil e outro registro de auditoria — não é dado aberto.
 */

const Aluno = require('../../models/Aluno');
const Nota = require('../../models/Nota');
const { COR_RACA } = require('./educacenso');
const { avaliarTurmas } = require('./monitorEvasao');
const { PERCENTUAL_MINIMO_FREQUENCIA } = require('./frequenciaLdb');

/**
 * k=5: recorte com menos de 5 estudantes não é publicado. É o limiar que a
 * literatura de dados abertos e os manuais de microdados educacionais adotam
 * como piso; abaixo disso a chance de reidentificação por quem conhece a turma
 * é alta demais para um dado que fica público para sempre.
 */
const LIMIAR_ANONIMATO = 5;

/**
 * Aplica supressão complementar a uma distribuição.
 *
 * @param {Array<{chave: string, valor: number}>} itens
 * @param {number} [limiar=5]
 * @returns {{itens: Array, suprimidos: number, limiar: number}}
 *   `itens` já contém, quando necessário, a linha agregada "Outros".
 */
function agruparPequenos(itens, limiar = LIMIAR_ANONIMATO) {
    const validos = (itens || []).filter((i) => i && Number(i.valor) > 0);
    const publicos = validos.filter((i) => i.valor >= limiar).sort((a, b) => b.valor - a.valor);
    const pequenos = validos.filter((i) => i.valor < limiar);

    let residual = pequenos.reduce((soma, i) => soma + i.valor, 0);
    let suprimidos = pequenos.length;

    // Enquanto o balde "Outros" sozinho identificar alguém, ele absorve a menor
    // célula pública. Sem isso, "Outros = 3" é tão revelador quanto a célula
    // original que a gente escondeu.
    while (residual > 0 && residual < limiar && publicos.length > 0) {
        const menor = publicos.pop();
        residual += menor.valor;
        suprimidos += 1;
    }

    const resultado = publicos.map((i) => ({ chave: i.chave, valor: i.valor, agregado: false }));
    if (residual > 0) {
        resultado.push({
            chave: `Outros (${suprimidos} grupo(s) com menos de ${limiar} estudantes)`,
            valor: residual,
            agregado: true,
        });
    }
    return { itens: resultado, suprimidos, limiar };
}

/** Contagem simples de uma coleção de documentos por um campo derivado. */
function distribuir(documentos, extrairChave, rotuloVazio = 'Não declarado') {
    const contagem = new Map();
    for (const doc of documentos) {
        const chave = extrairChave(doc) || rotuloVazio;
        contagem.set(chave, (contagem.get(chave) || 0) + 1);
    }
    return Array.from(contagem, ([chave, valor]) => ({ chave, valor }));
}

/** Normaliza `etnia` (texto livre) para o rótulo do domínio do INEP. */
function rotuloCorRaca(aluno) {
    const bruto = String(aluno.etnia || '').trim();
    if (!bruto) return null;
    const casado = Object.values(COR_RACA).find(
        (rotulo) => rotulo.toLowerCase() === bruto.toLowerCase()
    );
    return casado || 'Outra/Não classificada';
}

/**
 * Média por turma só é publicável com turma grande o bastante — média de 3
 * alunos, com as notas individuais conhecidas por quem convive com eles, é
 * dado pessoal disfarçado de estatística.
 */
function mediasPorTurma(linhas, limiar = LIMIAR_ANONIMATO) {
    return linhas
        .filter((l) => l.estudantes >= limiar)
        .map((l) => ({
            turma: l._id || 'Sem turma',
            estudantes: l.estudantes,
            media: Math.round(l.media * 10) / 10,
        }))
        .sort((a, b) => String(a.turma).localeCompare(String(b.turma)));
}

/**
 * Monta o painel de dados abertos de uma escola/rede.
 *
 * @param {object} opcoes
 * @param {object} [opcoes.filtroEscola={}] match de tenant.
 * @param {number} [opcoes.anoLetivo]
 * @param {number} [opcoes.diasLetivosPrevistos]
 * @returns {Promise<object>} indicadores agregados, sem nenhum identificador.
 */
async function montarPainel({ filtroEscola = {}, anoLetivo, diasLetivosPrevistos } = {}) {
    const ano = Number(anoLetivo) || new Date().getFullYear();

    const alunos = await Aluno.find({ ...filtroEscola, ativo: true })
        .select('turma situacao etnia pcd')
        .lean();

    const [notasPorTurma, frequencias] = await Promise.all([
        Nota.aggregate([
            { $match: { ...filtroEscola, nota: { $type: 'number' } } },
            {
                $group: {
                    _id: '$turmaId',
                    media: { $avg: '$nota' },
                    estudantes: { $addToSet: '$alunoId' },
                },
            },
            { $project: { media: 1, estudantes: { $size: '$estudantes' } } },
        ]),
        avaliarTurmas({ filtroEscola, anoLetivo: ano, diasLetivosPrevistos }),
    ]);

    // Faixas de frequência: o corte em 75% é o da LDB; o de 50% separa a
    // infrequência grave (busca ativa) da falta pontual.
    const faixas = {
        'Frequência igual ou acima de 75%': 0,
        'Entre 50% e 75%': 0,
        'Abaixo de 50%': 0,
    };
    for (const f of frequencias) {
        if (f.frequenciaPct === null) continue;
        if (f.frequenciaPct >= PERCENTUAL_MINIMO_FREQUENCIA)
            faixas['Frequência igual ou acima de 75%'] += 1;
        else if (f.frequenciaPct >= 50) faixas['Entre 50% e 75%'] += 1;
        else faixas['Abaixo de 50%'] += 1;
    }

    const comFrequencia = frequencias.filter((f) => f.frequenciaPct !== null);
    const mediaRede =
        comFrequencia.length > 0
            ? Math.round(
                  (comFrequencia.reduce((s, f) => s + f.frequenciaPct, 0) / comFrequencia.length) *
                      10
              ) / 10
            : null;

    return {
        metadados: {
            anoLetivo: ano,
            geradoEm: new Date().toISOString(),
            baseLegal:
                'Lei 12.527/2011 (LAI), art. 8º — publicação proativa de informações de ' +
                'interesse coletivo, observada a LGPD (Lei 13.709/2018, art. 14) quanto a ' +
                'dados de crianças e adolescentes.',
            anonimizacao: {
                tecnica: 'supressão complementar com limiar (k-anonimato)',
                limiar: LIMIAR_ANONIMATO,
                observacao:
                    'Recortes com menos de ' +
                    LIMIAR_ANONIMATO +
                    ' estudantes são somados em "Outros". Nenhum identificador pessoal ' +
                    'é exposto nesta resposta.',
            },
        },
        matriculas: {
            totalAtivos: alunos.length,
            porTurma: agruparPequenos(distribuir(alunos, (a) => a.turma, 'Sem turma')),
            porSituacao: agruparPequenos(distribuir(alunos, (a) => a.situacao, 'Não informada')),
        },
        perfil: {
            porCorRaca: agruparPequenos(distribuir(alunos, rotuloCorRaca)),
            porDeficiencia: agruparPequenos(
                distribuir(alunos, (a) => (a.pcd ? 'Com deficiência declarada' : 'Sem declaração'))
            ),
        },
        frequencia: {
            estudantesAvaliados: comFrequencia.length,
            mediaDaRede: mediaRede,
            porFaixa: agruparPequenos(
                Object.entries(faixas).map(([chave, valor]) => ({ chave, valor }))
            ),
        },
        desempenho: {
            mediaPorTurma: mediasPorTurma(notasPorTurma),
            observacao: `Turmas com menos de ${LIMIAR_ANONIMATO} estudantes avaliados não são publicadas.`,
        },
    };
}

module.exports = { LIMIAR_ANONIMATO, agruparPequenos, montarPainel };
