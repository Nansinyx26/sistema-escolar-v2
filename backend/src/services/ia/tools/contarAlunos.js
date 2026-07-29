'use strict';

/**
 * contarAlunos — quantos alunos matriculados, opcionalmente por turma.
 *
 * Escopo: gestão vê a escola inteira; professor vê apenas as próprias turmas.
 * Responsável NÃO tem acesso — o número total de alunos da escola não é
 * informação dele, e é justamente o caso de "recusa educada" do aceite da fase.
 */

const Aluno = require('../../../models/Aluno');
const { filtroDaEscola, restringirPorTurma, ehGestao } = require('../PermissionGuard');

module.exports = {
    name: 'contarAlunos',
    description: 'Conta quantos alunos estão matriculados na escola. Use quando perguntarem "quantos alunos temos", "quantos alunos na turma X" ou algo equivalente. Pode filtrar por turma.',

    schema: {
        type: 'object',
        properties: {
            turma: {
                type: 'string',
                description: 'Identificador da turma, como "1A" ou "6ºB". Omita para contar a escola inteira.'
            },
            apenasAtivos: {
                type: 'boolean',
                description: 'Contar somente alunos ativos. Padrão: true.'
            }
        }
    },

    cargosPermitidos: ['diretor', 'secretaria', 'professor'],
    mutates: false,

    async handler({ turma, apenasAtivos = true }, ctx) {
        let filtro = { ...filtroDaEscola(ctx) };

        if (apenasAtivos) filtro.ativo = { $ne: false };

        if (turma) {
            const t = String(turma).trim();
            // O banco tem as duas grafias ("1A" e "1ºA") por herança histórica.
            const variantes = [t, t.replace('º', ''), t.length >= 2 ? `${t[0]}º${t.replace('º', '').slice(1)}` : t];
            filtro.$or = [
                { turma: { $in: variantes } },
                { turmaId: { $in: variantes } }
            ];
        }

        // Professor só conta dentro das turmas dele, mesmo que peça outra.
        filtro = restringirPorTurma(filtro, ctx);

        const total = await Aluno.countDocuments(filtro);

        return {
            total,
            escopo: turma ? `turma ${turma}` : (ehGestao(ctx) ? 'escola inteira' : 'suas turmas'),
            turmasConsideradas: ehGestao(ctx) ? undefined : ctx.allowedTurmas
        };
    }
};
