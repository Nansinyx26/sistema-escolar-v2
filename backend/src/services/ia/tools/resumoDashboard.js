'use strict';

/**
 * resumoDashboard — panorama numérico da escola em uma chamada.
 *
 * Existe para evitar que o modelo encadeie cinco ferramentas só para montar um
 * "como está a escola hoje". Uma consulta agregada é mais barata e devolve
 * números coerentes entre si (todos do mesmo instante).
 *
 * Restrita à GESTÃO: é a visão administrativa da escola.
 */

const Aluno = require('../../../models/Aluno');
const Turma = require('../../../models/Turma');
const Professor = require('../../../models/Professor');
const Falta = require('../../../models/Falta');
const CalendarioEscolar = require('../../../models/CalendarioEscolar');
const { filtroDaEscola } = require('../PermissionGuard');

module.exports = {
    name: 'resumoDashboard',
    description: 'Panorama geral da escola: total de alunos, turmas, professores, faltas recentes e próximos eventos. Use para "como está a escola", "me dá um resumo", "panorama geral".',

    schema: { type: 'object', properties: {} },

    cargosPermitidos: ['diretor', 'secretaria'],
    mutates: false,

    async handler(_params, ctx) {
        const escola = filtroDaEscola(ctx);

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        const seteDiasAtras = new Date(hoje);
        seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);

        const trintaDiasAFrente = new Date(hoje);
        trintaDiasAFrente.setDate(trintaDiasAFrente.getDate() + 30);

        // Tudo em paralelo: são consultas independentes e a soma das latências
        // em série seria sentida no tempo até o primeiro token da resposta.
        const [alunos, turmas, professores, faltasSemana, proximosEventos] = await Promise.all([
            Aluno.countDocuments({ ...escola, ativo: { $ne: false } }),
            Turma.countDocuments({ ...escola, ativo: { $ne: false } }),
            Professor.countDocuments({
                ativo: { $ne: false },
                $or: [{ 'vinculos.escolaId': String(ctx.escolaId) }, escola]
            }),
            Falta.countDocuments({ ...escola, presente: false, data: { $gte: seteDiasAtras } }),
            CalendarioEscolar.find({
                ...escola,
                ativo: { $ne: false },
                dataFim: { $gte: hoje },
                dataInicio: { $lte: trintaDiasAFrente }
            }).select('titulo tipo dataInicio').sort({ dataInicio: 1 }).limit(5).lean()
        ]);

        return {
            alunosAtivos: alunos,
            turmasAtivas: turmas,
            professoresAtivos: professores,
            faltasUltimos7Dias: faltasSemana,
            mediaAlunosPorTurma: turmas > 0 ? Number((alunos / turmas).toFixed(1)) : null,
            proximosEventos: proximosEventos.map(e => ({
                titulo: e.titulo,
                tipo: e.tipo,
                data: e.dataInicio
            }))
        };
    }
};
