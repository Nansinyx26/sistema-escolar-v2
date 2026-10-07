'use strict';

/**
 * listarProfessores — quadro docente da escola.
 *
 * Restrito à GESTÃO. Um professor não precisa da lista dos colegas para o
 * próprio trabalho, e para um responsável isso é dado de terceiros — nomes,
 * disciplinas e alocação de funcionários não entram no escopo dele (LGPD).
 */

const Professor = require('../../../models/Professor');
const escapeRegex = require('../../../utils/escapeRegex');
const { filtroDaEscola } = require('../PermissionGuard');
const { turmasDoProfessorNaEscola } = require('../../turmasDoProfessor');

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

        const variantes = turma
            ? [String(turma).trim(), String(turma).trim().replace('º', '')]
            : null;
        if (variantes) {
            filtro.$and = [
                ...(filtro.$and || []),
                {
                    $or: [
                        { turmas: { $in: variantes } },
                        { salaPrincipal: { $in: variantes } },
                        { salasAdicionais: { $in: variantes } },
                        { 'vinculos.turmas': { $in: variantes } },
                    ],
                },
            ];
        }

        const encontrados = await Professor.find(filtro)
            .select(
                'nome email disciplina materias turmas salaPrincipal salasAdicionais tipoAtuacao vinculos escolaId'
            )
            .sort({ nome: 1 })
            .limit(MAX_RESULTADOS)
            .lean();

        // As turmas de cada um são as que ele tem NESTA escola (Issue #707):
        // a consulta acha candidatos, e a "1A" que ele dá em outra escola não
        // faz dele professor da "1A" daqui.
        const professores = encontrados
            .map((p) => ({ ...p, turmasAqui: turmasDoProfessorNaEscola(p, ctx.escolaId) }))
            .filter((p) => !variantes || p.turmasAqui.some((t) => variantes.includes(t)));

        return {
            total: professores.length,
            truncado: encontrados.length >= MAX_RESULTADOS,
            professores: professores.map((p) => ({
                nome: p.nome,
                disciplinas: [...new Set([...(p.materias || []), p.disciplina].filter(Boolean))],
                turmas: p.turmasAqui,
                atuacao: p.tipoAtuacao,
            })),
        };
    },
};
