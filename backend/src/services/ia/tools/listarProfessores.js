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

const MAX_RESULTADOS = 60;

module.exports = {
    name: 'listarProfessores',
    description: 'Lista os professores da escola, com disciplinas e turmas de atuação. Use para "quantos professores temos", "quem dá aula de matemática" ou "quem é o professor da turma X".',

    schema: {
        type: 'object',
        properties: {
            disciplina: {
                type: 'string',
                description: 'Filtrar por disciplina/matéria, como "Matemática". Omita para trazer todos.'
            },
            turma: {
                type: 'string',
                description: 'Filtrar por turma de atuação, como "1A". Omita para trazer todos.'
            }
        }
    },

    cargosPermitidos: ['diretor', 'secretaria'],
    mutates: false,

    async handler({ disciplina, turma }, ctx) {
        const escola = filtroDaEscola(ctx);

        // O vínculo com a escola no cadastro de professor vive em `vinculos[]`,
        // e não num `escolaId` de primeiro nível como nos demais modelos.
        const filtro = {
            ativo: { $ne: false },
            $or: [
                { 'vinculos.escolaId': String(ctx.escolaId) },
                escola
            ]
        };

        if (disciplina) {
            const padrao = new RegExp(escapeRegex(String(disciplina).trim()), 'i');
            filtro.$and = [{ $or: [{ disciplina: padrao }, { materias: padrao }] }];
        }

        if (turma) {
            const t = String(turma).trim();
            const variantes = [t, t.replace('º', '')];
            filtro.$and = [
                ...(filtro.$and || []),
                { $or: [
                    { turmas: { $in: variantes } },
                    { salaPrincipal: { $in: variantes } },
                    { salasAdicionais: { $in: variantes } }
                ] }
            ];
        }

        const professores = await Professor.find(filtro)
            .select('nome email disciplina materias turmas salaPrincipal salasAdicionais tipoAtuacao')
            .sort({ nome: 1 })
            .limit(MAX_RESULTADOS)
            .lean();

        return {
            total: professores.length,
            truncado: professores.length >= MAX_RESULTADOS,
            professores: professores.map(p => ({
                nome: p.nome,
                disciplinas: [...new Set([...(p.materias || []), p.disciplina].filter(Boolean))],
                turmas: [...new Set([
                    ...(p.turmas || []),
                    p.salaPrincipal,
                    ...(p.salasAdicionais || [])
                ].filter(Boolean))],
                atuacao: p.tipoAtuacao
            }))
        };
    }
};
