'use strict';

/**
 * consultarNotas — boletim de um aluno.
 *
 * Sempre por aluno: nota é o dado mais sensível do sistema, e devolver a lista
 * de uma turma inteira num chat facilitaria a exposição em tela compartilhada.
 * Quem precisa do panorama da turma usa o BI Pedagógico, que tem controles
 * próprios de exibição.
 */

const Nota = require('../../../models/Nota');
const { exigirAcessoAoAluno, filtroDaEscola } = require('../PermissionGuard');

module.exports = {
    name: 'consultarNotas',
    description: 'Consulta as notas de um aluno específico, opcionalmente por bimestre. Use buscarAluno antes, para obter o alunoId. Serve para "como está o boletim", "quais as notas", "está indo bem em matemática".',

    schema: {
        type: 'object',
        properties: {
            alunoId: {
                type: 'string',
                description: 'Id do aluno, obtido com a ferramenta buscarAluno.'
            },
            bimestre: {
                type: 'number',
                description: 'Bimestre (1 a 4). Omita para trazer o ano todo.'
            },
            materia: {
                type: 'string',
                description: 'Filtrar por matéria. Omita para trazer todas.'
            }
        },
        required: ['alunoId']
    },

    cargosPermitidos: ['diretor', 'secretaria', 'professor', 'responsavel'],
    mutates: false,

    async handler({ alunoId, bimestre, materia }, ctx) {
        const aluno = await exigirAcessoAoAluno(ctx, alunoId);

        const filtro = {
            ...filtroDaEscola(ctx),
            alunoId: { $in: [String(aluno._id), aluno.id].filter(Boolean) }
        };
        if (bimestre) filtro.bimestre = Number(bimestre);
        if (materia) filtro.materiaId = String(materia).trim();

        const notas = await Nota.find(filtro)
            .select('materiaId bimestre tipo nota descricao data')
            .sort({ bimestre: 1, data: 1 })
            .lean();

        // Média por matéria, ignorando lançamentos sem valor numérico
        // (o campo aceita String por herança do modelo antigo).
        const porMateria = new Map();
        for (const n of notas) {
            const valor = Number(n.nota);
            if (!Number.isFinite(valor)) continue;
            const chave = n.materiaId || 'sem matéria';
            if (!porMateria.has(chave)) porMateria.set(chave, []);
            porMateria.get(chave).push(valor);
        }

        const medias = [...porMateria.entries()].map(([materiaNome, valores]) => ({
            materia: materiaNome,
            media: Number((valores.reduce((s, v) => s + v, 0) / valores.length).toFixed(2)),
            lancamentos: valores.length
        })).sort((a, b) => a.materia.localeCompare(b.materia));

        return {
            aluno: { nome: aluno.nome, turma: aluno.turma || aluno.turmaId },
            bimestre: bimestre || 'ano todo',
            totalLancamentos: notas.length,
            mediaGeral: medias.length > 0
                ? Number((medias.reduce((s, m) => s + m.media, 0) / medias.length).toFixed(2))
                : null,
            porMateria: medias,
            lancamentos: notas.slice(0, 30).map(n => ({
                materia: n.materiaId,
                bimestre: n.bimestre,
                tipo: n.tipo,
                nota: n.nota,
                data: n.data
            }))
        };
    }
};
