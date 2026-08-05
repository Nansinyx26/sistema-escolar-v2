'use strict';

/**
 * listarEventos — calendário escolar.
 *
 * Aberta a todos os perfis: datas de prova, feriado e reunião são justamente o
 * que responsáveis e professores mais perguntam.
 *
 * Eventos com `abrangencia: 'turma'` são recortados: um responsável não precisa
 * (nem deve) ver a agenda interna de turmas que não são a do filho.
 */

const CalendarioEscolar = require('../../../models/CalendarioEscolar');
const { filtroDaEscola, ehGestao, turmasPermitidas } = require('../PermissionGuard');

const DIAS_PADRAO = 30;
const MAX_RESULTADOS = 25;

module.exports = {
    name: 'listarEventos',
    description: 'Lista eventos do calendário escolar (provas, reuniões, feriados, recessos) num intervalo de dias a partir de hoje. Use para "o que vem pela frente", "quando é a reunião", "tem prova essa semana".',

    schema: {
        type: 'object',
        properties: {
            dias: {
                type: 'number',
                description: `Quantos dias à frente considerar. Padrão: ${DIAS_PADRAO}.`
            },
            tipo: {
                type: 'string',
                description: 'Filtrar por tipo de evento, como "prova", "reuniao" ou "feriado". Omita para trazer todos.'
            }
        }
    },

    cargosPermitidos: ['diretor', 'secretaria', 'professor', 'responsavel'],
    mutates: false,

    async handler({ dias, tipo }, ctx) {
        const janela = Number(dias) || DIAS_PADRAO;

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const limite = new Date(hoje);
        limite.setDate(limite.getDate() + janela);

        const filtro = {
            ...filtroDaEscola(ctx),
            ativo: { $ne: false },
            // Pega também o evento que começou antes mas ainda está em curso.
            dataFim: { $gte: hoje },
            dataInicio: { $lte: limite }
        };
        if (tipo) filtro.tipo = new RegExp(`^${String(tipo).trim()}`, 'i');

        let eventos = await CalendarioEscolar.find(filtro)
            .select('titulo descricao tipo dataInicio dataFim abrangencia turmasIds cor')
            .sort({ dataInicio: 1 })
            .limit(MAX_RESULTADOS)
            .lean();

        // Recorte dos eventos de turma para quem não é gestão.
        if (!ehGestao(ctx)) {
            const minhas = ctx.perfil === 'professor'
                ? new Set((turmasPermitidas(ctx) || []).map(t => String(t)))
                : null;

            eventos = eventos.filter(e => {
                if (e.abrangencia !== 'turma') return true;          // evento da escola
                if (!minhas) return false;                            // responsável: só os gerais
                return (e.turmasIds || []).some(id => minhas.has(String(id)));
            });
        }

        return {
            janelaDias: janela,
            total: eventos.length,
            eventos: eventos.map(e => ({
                titulo: e.titulo,
                tipo: e.tipo,
                inicio: e.dataInicio,
                fim: e.dataFim,
                descricao: e.descricao || undefined,
                abrangencia: e.abrangencia
            }))
        };
    }
};
