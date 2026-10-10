/**
 * listarProfessores — quadro docente da escola.
 *
 * Restrito à GESTÃO. Um professor não precisa da lista dos colegas para o
 * próprio trabalho, e para um responsável isso é dado de terceiros — nomes,
 * disciplinas e alocação de funcionários não entram no escopo dele (LGPD).
 *
 * Só entra quem tem conta de professor ativa (Issue #735) — o cadastro sem
 * conta não é professor que a direção reconheça.
 */

const Professor = require('../../../models/Professor');
const escapeRegex = require('../../../utils/escapeRegex');
const { filtroDaEscola } = require('../PermissionGuard');
const { turmasDoProfessorNaEscola } = require('../../turmasDoProfessor');
const { soComConta, chaveDaTurma } = require('../../professoresComConta');

const MAX_RESULTADOS = 60;

module.exports = {
    name: 'listarProfessores',
    description:
        'Lista os professores da escola, com disciplinas e turmas de atuação. Use para "quantos professores temos", "quem dá aula de matemática" ou "quem é o professor da turma X".',

    schema: {
        type: 'object',
        properties: {
            disciplina: {
                type: 'string',
                description:
                    'Filtrar por disciplina/matéria, como "Matemática". Omita para trazer todos.',
            },
            turma: {
                type: 'string',
                description: 'Filtrar por turma de atuação, como "1A". Omita para trazer todos.',
            },
        },
    },

    cargosPermitidos: ['diretor', 'secretaria'],
    mutates: false,

    async handler({ disciplina, turma }, ctx) {
        const escola = filtroDaEscola(ctx);

        // O vínculo com a escola no cadastro de professor vive em `vinculos[]`,
        // e não num `escolaId` de primeiro nível como nos demais modelos.
        const filtro = {
            ativo: { $ne: false },
            $or: [{ 'vinculos.escolaId': String(ctx.escolaId) }, escola],
        };

        if (disciplina) {
            const padrao = new RegExp(escapeRegex(String(disciplina).trim()), 'i');
            filtro.$and = [{ $or: [{ disciplina: padrao }, { materias: padrao }] }];
        }

        // A turma é comparada DEPOIS da consulta, pela chave normalizada: o
        // banco mistura "1ºB" e "1B", e um `$in` com a grafia pedida devolvia
        // lista vazia — que o modelo preenchia com nomes inventados (#735).
        // O quadro de uma escola cabe em memória.
        const chave = turma ? chaveDaTurma(turma) : null;

        const encontrados = await Professor.find(filtro)
            .select(
                'nome idUsuario disciplina materias turmas salaPrincipal salasAdicionais tipoAtuacao vinculos escolaId'
            )
            .sort({ nome: 1 })
            .lean();

        // Só quem tem conta de professor de verdade (Issue #735). As turmas de
        // cada um são as que ele tem NESTA escola (Issue #707): a "1A" que ele
        // dá em outra escola não faz dele professor da "1A" daqui.
        const comConta = await soComConta(encontrados);
        const todos = comConta
            .map((p) => ({ ...p, turmasAqui: turmasDoProfessorNaEscola(p, ctx.escolaId) }))
            .filter((p) => !chave || p.turmasAqui.some((t) => chaveDaTurma(t) === chave));
        const professores = todos.slice(0, MAX_RESULTADOS);

        if (professores.length === 0) {
            return {
                total: 0,
                professores: [],
                observacao: turma
                    ? `Nenhum professor com conta nesta escola está vinculado à turma ${turma}. Diga isso à pessoa e NÃO cite nenhum nome de professor.`
                    : 'Nenhum professor com conta cadastrada nesta escola atende a esse filtro. Diga isso à pessoa e NÃO cite nenhum nome de professor.',
            };
        }

        return {
            total: todos.length,
            truncado: todos.length > MAX_RESULTADOS,
            professores: professores.map((p) => ({
                nome: p.nome,
                disciplinas: [...new Set([...(p.materias || []), p.disciplina].filter(Boolean))],
                turmas: p.turmasAqui,
                atuacao: p.tipoAtuacao,
            })),
        };
    },
};
