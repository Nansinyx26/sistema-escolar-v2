'use strict';

/**
 * listarTurmas — turmas da escola, com a contagem de alunos de cada uma.
 *
 * Professor recebe apenas as próprias turmas: a lista completa da escola
 * revelaria a estrutura administrativa que não é do escopo dele.
 */

const Turma = require('../../../models/Turma');
const Aluno = require('../../../models/Aluno');
const { filtroDaEscola, turmasPermitidas, ehGestao } = require('../PermissionGuard');

/** "1ºA" e "1A" são a mesma turma para efeito de comparação. */
const normalizar = (t) => String(t || '').replace('º', '').toUpperCase();

module.exports = {
    name: 'listarTurmas',
    description: 'Lista as turmas da escola com nome, período e quantidade de alunos. Use para "quais turmas existem", "quantas turmas temos" ou quando precisar do identificador de uma turma antes de outra consulta.',

    schema: {
        type: 'object',
        properties: {
            periodo: {
                type: 'string',
                description: 'Filtrar por período, como "manha", "tarde" ou "integral". Omita para trazer todos.'
            }
        }
    },

    cargosPermitidos: ['diretor', 'secretaria', 'professor'],
    mutates: false,

    async handler({ periodo }, ctx) {
        const filtro = { ...filtroDaEscola(ctx), ativo: { $ne: false } };
        if (periodo) filtro.periodo = new RegExp(`^${String(periodo).trim()}`, 'i');

        let turmas = await Turma.find(filtro)
            .select('id nome ano periodo sala capacidade')
            .sort({ nome: 1 })
            .lean();

        // Recorte do professor aplicado DEPOIS da consulta: a lista é pequena e
        // as grafias divergem no banco, então comparar normalizado é mais
        // confiável que montar o $in com todas as variantes.
        const permitidas = turmasPermitidas(ctx);
        if (permitidas !== null) {
            const meu = new Set(permitidas.map(normalizar));
            turmas = turmas.filter(t => meu.has(normalizar(t.nome || t.id)));
        }

        // Contagem por turma em UMA agregação — evita N+1 numa escola com
        // dezenas de turmas.
        const contagens = await Aluno.aggregate([
            { $match: { ...filtroDaEscola(ctx), ativo: { $ne: false } } },
            { $group: { _id: '$turma', total: { $sum: 1 } } }
        ]);
        const porTurma = new Map(contagens.map(c => [normalizar(c._id), c.total]));

        return {
            total: turmas.length,
            escopo: ehGestao(ctx) ? 'escola inteira' : 'suas turmas',
            turmas: turmas.map(t => ({
                nome: t.nome || t.id,
                ano: t.ano,
                periodo: t.periodo,
                sala: t.sala,
                capacidade: t.capacidade,
                alunos: porTurma.get(normalizar(t.nome || t.id)) || 0
            }))
        };
    }
};
