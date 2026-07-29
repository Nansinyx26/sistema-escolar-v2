'use strict';

/**
 * consultarFrequencia — faltas de um aluno, ou o panorama de uma turma.
 *
 * Dois modos, porque as perguntas reais são dessas duas formas:
 *   - por aluno  ("quantas faltas o João tem?")  → exige acesso ÀQUELE aluno;
 *   - por turma  ("como está a frequência do 6ºB?") → gestão e professor da turma.
 *
 * Responsável só usa o modo por aluno, e só para os próprios filhos — o guard
 * `exigirAcessoAoAluno` é quem impõe isso.
 */

const Falta = require('../../../models/Falta');
const Aluno = require('../../../models/Aluno');
const {
    filtroDaEscola, exigirAcessoAoAluno, restringirPorTurma, ErroPermissao, ehResponsavel
} = require('../PermissionGuard');

/** Janela padrão de análise. */
const DIAS_PADRAO = 60;

function inicioDaJanela(dias) {
    const d = new Date();
    d.setDate(d.getDate() - (Number(dias) || DIAS_PADRAO));
    d.setHours(0, 0, 0, 0);
    return d;
}

module.exports = {
    name: 'consultarFrequencia',
    description: 'Consulta faltas e presença. Informe alunoId (obtido com buscarAluno) para um aluno específico, ou turma para o panorama da turma. Use para "quantas faltas", "está faltando muito", "frequência da turma".',

    schema: {
        type: 'object',
        properties: {
            alunoId: {
                type: 'string',
                description: 'Id do aluno, obtido com a ferramenta buscarAluno.'
            },
            turma: {
                type: 'string',
                description: 'Identificador da turma, como "6B". Use no lugar de alunoId para o panorama da turma.'
            },
            dias: {
                type: 'number',
                description: `Janela em dias a analisar, contada de hoje para trás. Padrão: ${DIAS_PADRAO}.`
            }
        }
    },

    cargosPermitidos: ['diretor', 'secretaria', 'professor', 'responsavel'],
    mutates: false,

    async handler({ alunoId, turma, dias }, ctx) {
        const desde = inicioDaJanela(dias);
        const janela = Number(dias) || DIAS_PADRAO;

        // ── Modo aluno ───────────────────────────────────────────────────────
        if (alunoId) {
            const aluno = await exigirAcessoAoAluno(ctx, alunoId);

            const registros = await Falta.find({
                ...filtroDaEscola(ctx),
                aluno: { $in: [String(aluno._id), aluno.id].filter(Boolean) },
                data: { $gte: desde }
            }).select('data materia presente justificada motivo').sort({ data: -1 }).lean();

            const ausencias = registros.filter(r => r.presente === false);
            const justificadas = ausencias.filter(r => r.justificada === true);
            const totalAulas = registros.length;

            return {
                aluno: { nome: aluno.nome, turma: aluno.turma || aluno.turmaId },
                janelaDias: janela,
                totalRegistros: totalAulas,
                faltas: ausencias.length,
                faltasJustificadas: justificadas.length,
                // Sem registros no período, uma porcentagem seria inventada.
                percentualPresenca: totalAulas > 0
                    ? Number((((totalAulas - ausencias.length) / totalAulas) * 100).toFixed(1))
                    : null,
                ultimasFaltas: ausencias.slice(0, 8).map(f => ({
                    data: f.data,
                    materia: f.materia,
                    justificada: !!f.justificada,
                    motivo: f.motivo || undefined
                }))
            };
        }

        // ── Modo turma ───────────────────────────────────────────────────────
        if (!turma) {
            throw new ErroPermissao('Preciso saber de qual aluno ou de qual turma. Pergunte à pessoa e, se for um aluno, use buscarAluno primeiro.');
        }

        if (ehResponsavel(ctx)) {
            throw new ErroPermissao('Como responsável, você pode consultar a frequência dos seus filhos, mas não o panorama de uma turma inteira. Explique isso com cordialidade.');
        }

        const t = String(turma).trim();
        const variantes = [t, t.replace('º', ''), t.length >= 2 ? `${t[0]}º${t.replace('º', '').slice(1)}` : t];

        // Professor só vê a própria turma, mesmo que peça outra.
        const filtro = restringirPorTurma(
            { ...filtroDaEscola(ctx), turma: { $in: variantes }, data: { $gte: desde } },
            ctx,
            ['turma']
        );

        const registros = await Falta.find(filtro).select('aluno presente justificada').lean();

        const porAluno = new Map();
        for (const r of registros) {
            const chave = String(r.aluno);
            if (!porAluno.has(chave)) porAluno.set(chave, { aulas: 0, faltas: 0 });
            const acc = porAluno.get(chave);
            acc.aulas++;
            if (r.presente === false) acc.faltas++;
        }

        // Nomes só dos alunos que aparecem nos registros.
        const ids = [...porAluno.keys()];
        const alunos = await Aluno.find({ _id: { $in: ids } }).select('nome').lean();
        const nomes = new Map(alunos.map(a => [String(a._id), a.nome]));

        const ranking = [...porAluno.entries()]
            .map(([id, v]) => ({
                nome: nomes.get(id) || 'aluno não identificado',
                faltas: v.faltas,
                aulas: v.aulas,
                percentualPresenca: v.aulas > 0
                    ? Number((((v.aulas - v.faltas) / v.aulas) * 100).toFixed(1))
                    : null
            }))
            .sort((a, b) => b.faltas - a.faltas);

        return {
            turma: t,
            janelaDias: janela,
            alunosComRegistro: ranking.length,
            totalFaltas: ranking.reduce((s, a) => s + a.faltas, 0),
            maioresAusencias: ranking.slice(0, 10)
        };
    }
};
