'use strict';

/**
 * listarComunicados — avisos e comunicados endereçados ao usuário.
 *
 * REUSO DA REGRA DE VISIBILIDADE
 * ------------------------------
 * Quem pode ler um comunicado já é decidido por
 * `ComunicadoController.podeVerComunicado`, que trata os alvos especiais
 * ('todos', 'professores', 'responsaveis', 'usuario:<id>', 'turma:<id>') e o
 * caso do responsável, cujos alvos dependem da turma dos filhos.
 *
 * Reimplementar isso aqui criaria uma segunda definição de visibilidade, que
 * divergiria da primeira no dia em que uma das duas mudasse — e a divergência
 * apareceria como comunicado interno vazando num chat. Então delegamos.
 */

const Comunicado = require('../../../models/Comunicado');
const { podeVerComunicado } = require('../../../controllers/ComunicadoController');
const { filtroDaEscola } = require('../PermissionGuard');

const MAX_CANDIDATOS = 40;
const MAX_RESULTADOS = 10;

/** Tira o HTML do corpo: o modelo recebe texto, não marcação. */
function textoPuro(html, limite = 400) {
    const texto = String(html || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
    return texto.length > limite ? texto.slice(0, limite) + '...' : texto;
}

module.exports = {
    name: 'listarComunicados',
    description: 'Lista os comunicados e avisos mais recentes endereçados a esta pessoa. Use para "tem algum aviso", "o que a direção comunicou", "quais os últimos comunicados".',

    schema: {
        type: 'object',
        properties: {
            limite: {
                type: 'number',
                description: `Quantos comunicados trazer. Padrão: 5, máximo: ${MAX_RESULTADOS}.`
            },
            prioridade: {
                type: 'string',
                description: 'Filtrar por prioridade: "Normal", "Importante" ou "Urgente".'
            }
        }
    },

    cargosPermitidos: ['diretor', 'secretaria', 'professor', 'responsavel'],
    mutates: false,

    async handler({ limite, prioridade }, ctx) {
        const quantos = Math.min(Number(limite) || 5, MAX_RESULTADOS);

        const filtro = {
            ...filtroDaEscola(ctx),
            ativo: { $ne: false },
            // Comunicado agendado para o futuro ainda não foi publicado.
            $or: [{ dataAgendada: null }, { dataAgendada: { $lte: new Date() } }]
        };
        if (prioridade) filtro.prioridade = String(prioridade).trim();

        // Busca um lote maior porque o filtro de destinatário roda em memória
        // (é a regra do controller, que faz consulta própria para responsável).
        const candidatos = await Comunicado.find(filtro)
            .select('titulo conteudo categoria prioridade autorNome dataCriacao destinatarios')
            .sort({ dataCriacao: -1 })
            .limit(MAX_CANDIDATOS)
            .lean();

        const visiveis = [];
        for (const c of candidatos) {
            if (await podeVerComunicado(c, ctx.req.user)) visiveis.push(c);
            if (visiveis.length >= quantos) break;
        }

        return {
            total: visiveis.length,
            comunicados: visiveis.map(c => ({
                titulo: c.titulo,
                resumo: textoPuro(c.conteudo),
                categoria: c.categoria,
                prioridade: c.prioridade,
                autor: c.autorNome,
                data: c.dataCriacao
            }))
        };
    }
};
