'use strict';

/**
 * criarEvento — lança um evento no calendário escolar.
 *
 * Ferramenta de ESCRITA: `handler` monta o preview, `confirmar` grava.
 */

const CalendarioEscolar = require('../../../models/CalendarioEscolar');
const { filtroDaEscola, ErroPermissao } = require('../PermissionGuard');

// Espelha o enum de models/CalendarioEscolar.js. Divergir daqui faria a
// validação do Mongoose falhar DEPOIS da confirmação, que é o pior momento.
const TIPOS = [
    'aula', 'feriado', 'recesso', 'reuniao_pais', 'conselho_classe',
    'prova', 'evento', 'formacao', 'matricula', 'outro'
];

/**
 * Aceita "2026-08-15" e "15/08/2026" — o modelo produz as duas formas
 * dependendo de como a pessoa escreveu.
 */
function lerData(valor) {
    if (!valor) return null;
    const texto = String(valor).trim();

    const brasileira = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
    if (brasileira) {
        const [, d, m, a] = brasileira;
        return new Date(Number(a), Number(m) - 1, Number(d));
    }

    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
    if (iso) {
        const [, a, m, d] = iso;
        // Construtor por componentes evita o deslocamento de fuso que
        // `new Date('2026-08-15')` produz (é interpretado como UTC).
        return new Date(Number(a), Number(m) - 1, Number(d));
    }

    const solta = new Date(texto);
    return Number.isNaN(solta.getTime()) ? null : solta;
}

const formatar = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

module.exports = {
    name: 'criarEvento',
    description: 'Cria um evento no calendário escolar (reunião, prova, feriado, formação). Use quando pedirem para marcar/agendar algo no calendário. Exige confirmação antes de ser efetivado.',

    schema: {
        type: 'object',
        properties: {
            titulo: { type: 'string', description: 'Nome do evento.' },
            tipo: {
                type: 'string',
                enum: TIPOS,
                description: 'Tipo do evento.'
            },
            dataInicio: {
                type: 'string',
                description: 'Data de início, no formato AAAA-MM-DD.'
            },
            dataFim: {
                type: 'string',
                description: 'Data de término, no formato AAAA-MM-DD. Omita para evento de um dia só.'
            },
            descricao: { type: 'string', description: 'Detalhes do evento.' }
        },
        required: ['titulo', 'tipo', 'dataInicio']
    },

    cargosPermitidos: ['diretor', 'secretaria'],
    mutates: true,

    async handler({ titulo, tipo, dataInicio, dataFim, descricao }, ctx) {
        const tituloLimpo = String(titulo || '').trim();
        if (!tituloLimpo) {
            throw new ErroPermissao('Preciso do título do evento. Pergunte à pessoa.');
        }

        const tipoLimpo = String(tipo || '').toLowerCase().trim();
        if (!TIPOS.includes(tipoLimpo)) {
            throw new ErroPermissao(`Tipo de evento inválido. Os aceitos são: ${TIPOS.join(', ')}.`);
        }

        const inicio = lerData(dataInicio);
        if (!inicio) {
            throw new ErroPermissao('Não entendi a data de início. Peça no formato dia/mês/ano.');
        }

        const fim = lerData(dataFim) || inicio;
        if (fim < inicio) {
            throw new ErroPermissao('A data de término é anterior à de início. Confirme as datas com a pessoa.');
        }

        const parametros = {
            titulo: tituloLimpo,
            tipo: tipoLimpo,
            dataInicio: inicio.toISOString(),
            dataFim: fim.toISOString(),
            descricao: descricao ? String(descricao).trim() : undefined,
            anoLetivo: inicio.getFullYear()
        };

        const periodo = inicio.getTime() === fim.getTime()
            ? `em ${formatar(inicio)}`
            : `de ${formatar(inicio)} a ${formatar(fim)}`;

        return {
            resumo: `Criar evento "${tituloLimpo}" (${tipoLimpo}) ${periodo}`,
            parametros
        };
    },

    async confirmar(parametros, ctx) {
        // `filtroDaEscola` aqui é uma reafirmação: sem escola resolvida a ação
        // não acontece, mesmo tendo passado pelo preview.
        filtroDaEscola(ctx);

        const evento = await CalendarioEscolar.create({
            escolaId: ctx.escolaId,
            titulo: parametros.titulo,
            tipo: parametros.tipo,
            descricao: parametros.descricao,
            dataInicio: new Date(parametros.dataInicio),
            dataFim: new Date(parametros.dataFim),
            anoLetivo: parametros.anoLetivo,
            abrangencia: 'escola',
            criadoPor: ctx.usuarioId,
            criadoPorNome: ctx.nome,
            ativo: true
        });

        return {
            recursoId: String(evento._id),
            mensagem: `Evento "${evento.titulo}" adicionado ao calendário.`,
            evento: {
                titulo: evento.titulo,
                tipo: evento.tipo,
                inicio: evento.dataInicio,
                fim: evento.dataFim
            }
        };
    }
};
