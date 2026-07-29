'use strict';

/**
 * atividadesPendentesCorrecao — o que já foi entregue e ainda não foi corrigido.
 *
 * É a pergunta mais prática do professor ("o que falta corrigir?"). Por padrão
 * responde sobre as atividades DELE; a gestão pode ver a escola inteira.
 */

const Atividade = require('../../../models/Atividade');
const { filtroDaEscola, turmasPermitidas, ehGestao } = require('../PermissionGuard');

const MAX_RESULTADOS = 25;

const normalizar = (t) => String(t || '').replace('º', '').trim().toUpperCase();

module.exports = {
    name: 'atividadesPendentesCorrecao',
    description: 'Lista as atividades com entregas aguardando correção. Use para "o que falta corrigir", "tenho entregas pendentes", "quais atividades preciso avaliar".',

    schema: {
        type: 'object',
        properties: {
            turma: {
                type: 'string',
                description: 'Filtrar por uma turma específica. Omita para ver todas as suas.'
            }
        }
    },

    cargosPermitidos: ['diretor', 'secretaria', 'professor'],
    mutates: false,

    async handler({ turma }, ctx) {
        const filtro = { ...filtroDaEscola(ctx), ativo: { $ne: false } };

        if (turma) filtro.turma = new RegExp(`^${normalizar(turma)}$`, 'i');

        // Professor vê as próprias atividades. Restringir por `criadoPor` (e
        // não só por turma) evita listar a prova que o colega de outra
        // disciplina aplicou na mesma turma.
        if (!ehGestao(ctx)) {
            const permitidas = turmasPermitidas(ctx);
            filtro.$and = [
                { criadoPor: String(ctx.usuarioId) },
                { turma: { $in: permitidas } }
            ];
        }

        const atividades = await Atividade.find(filtro)
            .select('titulo turma materia tipo dataEntrega entregas criadoPorNome')
            .sort({ dataEntrega: 1 })
            .limit(MAX_RESULTADOS)
            .lean();

        const pendentes = atividades
            .map(a => {
                const entregas = a.entregas || [];
                const aguardando = entregas.filter(e => !e.corrigida).length;
                return {
                    titulo: a.titulo,
                    turma: a.turma,
                    materia: a.materia,
                    tipo: a.tipo,
                    prazo: a.dataEntrega,
                    entregas: entregas.length,
                    aguardandoCorrecao: aguardando,
                    professor: ehGestao(ctx) ? a.criadoPorNome : undefined
                };
            })
            .filter(a => a.aguardandoCorrecao > 0);

        return {
            escopo: ehGestao(ctx) ? 'escola inteira' : 'suas atividades',
            total: pendentes.length,
            totalEntregasAguardando: pendentes.reduce((s, a) => s + a.aguardandoCorrecao, 0),
            atividades: pendentes
        };
    }
};
