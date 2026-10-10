// biome-ignore lint/suspicious/noRedundantUseStrict: CommonJS — aqui a diretiva vale (docs/QUALITY.md)
'use strict';

/**
 * consultarGradeHoraria — horário de aula de uma turma (Issue #702).
 *
 * O chatbot antigo respondia "qual o horário da turma?"; o copiloto não tinha
 * ferramenta para isso. O recorte é o mesmo das outras consultas:
 *   - gestão: qualquer turma da escola da sessão (precisa dizer qual);
 *   - professor: só as próprias turmas;
 *   - responsável: só a turma dos FILHOS vinculados nesta escola — nunca a de
 *     outra turma, mesmo que peça pelo nome.
 * Sem turma informada, professor e responsável recebem a grade das turmas que
 * alcançam.
 */

const GradeHoraria = require('../../../models/GradeHoraria');
const Professor = require('../../../models/Professor');
const { soComConta } = require('../../professoresComConta');
const { alunosDoResponsavel } = require('../../vinculoDoResponsavel');
const { variantesDasTurmas } = require('../../publicoDoComunicado');
const {
    filtroDaEscola,
    turmasPermitidas,
    ErroPermissao,
    ehResponsavel,
} = require('../PermissionGuard');

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Teto de aulas devolvidas: a grade de várias turmas cabe com folga. */
const MAX_AULAS = 120;

/** Turmas dos filhos vinculados ao responsável, na escola da sessão. */
async function turmasDosFilhos(ctx) {
    const filhos = await alunosDoResponsavel(ctx.email, ctx.escolaId);
    return [
        ...new Set(
            filhos
                .map((a) => a.turma || a.turmaId)
                .filter(Boolean)
                .map(String)
        ),
    ];
}

module.exports = {
    name: 'consultarGradeHoraria',
    description:
        'Consulta a grade horária (dia, horário, disciplina e professor) de uma turma. Use para "qual o horário da turma", "que aula tem na segunda", "quem dá aula de matemática no 6B". Sem turma, traz a grade das turmas da própria pessoa.',

    schema: {
        type: 'object',
        properties: {
            turma: {
                type: 'string',
                description:
                    'Identificador da turma, como "6B". Omita para as turmas da própria pessoa.',
            },
            diaSemana: {
                type: 'number',
                description:
                    'Dia da semana: 1 = segunda … 5 = sexta (0 = domingo, 6 = sábado). Omita para a semana toda.',
            },
        },
    },

    cargosPermitidos: ['diretor', 'secretaria', 'professor', 'responsavel'],
    mutates: false,

    async handler({ turma, diaSemana }, ctx) {
        const daEscola = filtroDaEscola(ctx);

        // Turmas que a pessoa alcança; `null` = escola inteira (gestão).
        let alcance;
        if (ehResponsavel(ctx)) {
            alcance = await turmasDosFilhos(ctx);
            if (alcance.length === 0) {
                throw new ErroPermissao(
                    'Não encontrei filho vinculado a esta conta nesta escola, então não há grade para mostrar. ' +
                        'Oriente a pessoa a procurar a secretaria para conferir o vínculo.'
                );
            }
        } else {
            alcance = turmasPermitidas(ctx);
        }

        let turmas;
        if (turma) {
            const pedida = String(turma).trim();
            turmas = variantesDasTurmas([pedida]);
            if (alcance) {
                const permitidas = new Set(variantesDasTurmas(alcance));
                if (!turmas.some((t) => permitidas.has(t))) {
                    throw new ErroPermissao(
                        ehResponsavel(ctx)
                            ? 'Como responsável, você consulta a grade da turma dos seus filhos, não a de outras turmas. Explique isso com cordialidade.'
                            : 'Essa turma não está entre as suas. Explique com cordialidade que a consulta é só das próprias turmas.'
                    );
                }
            }
        } else if (alcance) {
            turmas = variantesDasTurmas(alcance);
        } else {
            throw new ErroPermissao(
                'Preciso saber de qual turma. Pergunte à pessoa qual turma ela quer consultar.'
            );
        }

        const filtro = { ...daEscola, turmaId: { $in: turmas }, ativo: { $ne: false } };
        const dia = Number(diaSemana);
        if (
            diaSemana !== undefined &&
            diaSemana !== null &&
            Number.isInteger(dia) &&
            dia >= 0 &&
            dia <= 6
        ) {
            filtro.diaSemana = dia;
        }

        const aulas = await GradeHoraria.find(filtro)
            .select('turmaId disciplina diaSemana horaInicio horaFim professorId')
            .sort({ turmaId: 1, diaSemana: 1, horaInicio: 1 })
            .limit(MAX_AULAS)
            .lean();

        // Só o NOME do professor, nunca e-mail ou telefone — o mesmo que a
        // tela de grade mostra ao responsável (Issue #675). E só de quem tem
        // conta de professor (Issue #735): aula ligada a cadastro sem conta
        // sai sem nome, em vez de citar alguém que não existe no sistema.
        const ids = [...new Set(aulas.map((a) => String(a.professorId || '')).filter(Boolean))];
        const professores = ids.length
            ? await soComConta(
                  await Professor.find({ _id: { $in: ids } })
                      .select('nome idUsuario')
                      .lean()
              )
            : [];
        const nomes = new Map(professores.map((p) => [String(p._id), p.nome]));

        const consultadas = turma ? [String(turma).trim()] : alcance;
        if (aulas.length === 0) {
            return {
                turmas: consultadas,
                total: 0,
                aulas: [],
                observacao: 'A grade desta turma ainda não foi cadastrada no sistema.',
            };
        }

        return {
            turmas: consultadas,
            total: aulas.length,
            truncado: aulas.length >= MAX_AULAS,
            aulas: aulas.map((a) => ({
                turma: a.turmaId,
                dia: DIAS[a.diaSemana],
                inicio: a.horaInicio,
                fim: a.horaFim,
                disciplina: a.disciplina,
                professor: nomes.get(String(a.professorId)) || undefined,
            })),
        };
    },
};
