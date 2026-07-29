'use strict';

/**
 * criarProjetoMaker — registra um projeto da oficina maker.
 *
 * Aberta ao professor além da gestão: quem propõe projeto maker é quem conduz
 * a oficina. O recorte de turma vale igual — só dá para envolver turmas que a
 * pessoa alcança.
 */

const ProjetoMaker = require('../../../models/ProjetoMaker');
const Turma = require('../../../models/Turma');
const { filtroDaEscola, turmasPermitidas, ErroPermissao } = require('../PermissionGuard');

const AREAS = ['robotica', 'programacao', 'impressao3d', 'marcenaria', 'eletronica', 'sustentabilidade', 'outro'];
const SITUACOES = ['planejamento', 'em_andamento', 'concluido', 'suspenso'];

const normalizar = (t) => String(t || '').replace('º', '').trim().toUpperCase();

function lerData(valor) {
    if (!valor) return null;
    const texto = String(valor).trim();
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
    if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const solta = new Date(texto);
    return Number.isNaN(solta.getTime()) ? null : solta;
}

module.exports = {
    name: 'criarProjetoMaker',
    description: 'Registra um projeto da oficina maker (robótica, programação, impressão 3D, marcenaria, eletrônica, sustentabilidade). Use quando pedirem para criar/cadastrar um projeto maker. Exige confirmação.',

    schema: {
        type: 'object',
        properties: {
            titulo: { type: 'string', description: 'Nome do projeto.' },
            area: { type: 'string', enum: AREAS, description: 'Área do projeto. Padrão: outro.' },
            turmas: {
                type: 'array',
                items: { type: 'string' },
                description: 'Turmas envolvidas, como ["6A", "6B"].'
            },
            descricao: { type: 'string', description: 'O que o projeto propõe.' },
            materiais: {
                type: 'array',
                items: { type: 'string' },
                description: 'Materiais necessários.'
            },
            dataInicio: { type: 'string', description: 'Início previsto, no formato AAAA-MM-DD.' },
            dataPrevistaFim: { type: 'string', description: 'Término previsto, no formato AAAA-MM-DD.' },
            situacao: { type: 'string', enum: SITUACOES, description: 'Situação inicial. Padrão: planejamento.' }
        },
        required: ['titulo']
    },

    cargosPermitidos: ['diretor', 'secretaria', 'professor'],
    mutates: true,

    async handler(params, ctx) {
        const titulo = String(params.titulo || '').trim();
        if (!titulo) {
            throw new ErroPermissao('Preciso do nome do projeto. Pergunte à pessoa.');
        }

        const area = AREAS.includes(String(params.area || '').toLowerCase())
            ? String(params.area).toLowerCase()
            : 'outro';

        const situacao = SITUACOES.includes(String(params.situacao || '').toLowerCase())
            ? String(params.situacao).toLowerCase()
            : 'planejamento';

        // Turmas: precisam existir na escola e estar ao alcance da pessoa.
        const pedidas = (Array.isArray(params.turmas) ? params.turmas : [])
            .map(t => String(t).trim()).filter(Boolean);

        let turmasFinais = [];
        if (pedidas.length > 0) {
            const daEscola = await Turma.find({ ...filtroDaEscola(ctx), ativo: { $ne: false } })
                .select('nome id').lean();
            const mapa = new Map(daEscola.map(t => [normalizar(t.nome || t.id), t.nome || t.id]));

            const desconhecidas = pedidas.filter(t => !mapa.has(normalizar(t)));
            if (desconhecidas.length > 0) {
                throw new ErroPermissao(
                    `Não encontrei estas turmas nesta escola: ${desconhecidas.join(', ')}. Confirme os nomes com a pessoa.`
                );
            }

            const permitidas = turmasPermitidas(ctx);
            if (permitidas !== null) {
                const minhas = new Set(permitidas.map(normalizar));
                const fora = pedidas.filter(t => !minhas.has(normalizar(t)));
                if (fora.length > 0) {
                    throw new ErroPermissao(
                        `Estas turmas não estão entre as suas: ${fora.join(', ')}. Explique o limite com cordialidade.`
                    );
                }
            }

            turmasFinais = pedidas.map(t => mapa.get(normalizar(t)));
        }

        const inicio = lerData(params.dataInicio);
        const fim = lerData(params.dataPrevistaFim);
        if (inicio && fim && fim < inicio) {
            throw new ErroPermissao('O término previsto é anterior ao início. Confirme as datas com a pessoa.');
        }

        const materiais = (Array.isArray(params.materiais) ? params.materiais : [])
            .map(m => String(m).trim()).filter(Boolean).slice(0, 30);

        const parametros = {
            titulo,
            area,
            situacao,
            turmas: turmasFinais,
            materiais,
            descricao: params.descricao ? String(params.descricao).trim() : undefined,
            dataInicio: inicio ? inicio.toISOString() : undefined,
            dataPrevistaFim: fim ? fim.toISOString() : undefined
        };

        return {
            resumo: `Criar projeto maker "${titulo}" (${area})`
                + (turmasFinais.length > 0 ? ` com as turmas ${turmasFinais.join(', ')}` : ' sem turma definida')
                + `, situação: ${situacao}`,
            parametros
        };
    },

    async confirmar(parametros, ctx) {
        const projeto = await ProjetoMaker.create({
            escolaId: ctx.escolaId,
            titulo: parametros.titulo,
            descricao: parametros.descricao,
            turmas: parametros.turmas,
            area: parametros.area,
            situacao: parametros.situacao,
            materiais: parametros.materiais,
            dataInicio: parametros.dataInicio ? new Date(parametros.dataInicio) : undefined,
            dataPrevistaFim: parametros.dataPrevistaFim ? new Date(parametros.dataPrevistaFim) : undefined,
            responsavelId: ctx.usuarioId,
            responsavelNome: ctx.nome,
            criadoPor: ctx.usuarioId,
            criadoPorNome: ctx.nome,
            ativo: true
        });

        return {
            recursoId: String(projeto._id),
            mensagem: `Projeto maker "${projeto.titulo}" registrado.`,
            projeto: {
                titulo: projeto.titulo,
                area: projeto.area,
                situacao: projeto.situacao,
                turmas: projeto.turmas
            }
        };
    }
};
