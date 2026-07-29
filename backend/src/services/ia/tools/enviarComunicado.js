'use strict';

/**
 * enviarComunicado — publica um aviso para a comunidade escolar.
 *
 * É a ação de maior alcance do copiloto: dispara notificação (inclusive push)
 * para muita gente de uma vez e não tem desfazer prático. Por isso:
 *   - só diretor e secretaria;
 *   - preview obrigatório com o texto INTEGRAL, para a pessoa reler antes;
 *   - a publicação reusa o NotificationService, o mesmo caminho da tela normal.
 */

const Comunicado = require('../../../models/Comunicado');
const Usuario = require('../../../models/Usuario');
const { filtroDaEscola, ErroPermissao } = require('../PermissionGuard');
const logger = require('../../../utils/logger');

/** Alvos aceitos. Espelha a convenção do ComunicadoController. */
const DESTINATARIOS = ['todos', 'professores', 'responsaveis', 'secretaria'];
const PRIORIDADES = ['Normal', 'Importante', 'Urgente'];

const MAX_CHARS_CONTEUDO = 5000;

module.exports = {
    name: 'enviarComunicado',
    description: 'Publica um comunicado/aviso para a comunidade escolar, com notificação. Use quando pedirem para avisar/comunicar algo a professores, responsáveis ou a todos. Exige confirmação antes do envio.',

    schema: {
        type: 'object',
        properties: {
            titulo: { type: 'string', description: 'Título do comunicado.' },
            conteudo: {
                type: 'string',
                description: 'Texto do comunicado, já redigido e pronto para publicação.'
            },
            destinatarios: {
                type: 'array',
                items: { type: 'string', enum: DESTINATARIOS },
                description: 'Quem recebe. Use "todos" para a comunidade inteira.'
            },
            prioridade: {
                type: 'string',
                enum: PRIORIDADES,
                description: 'Prioridade. Padrão: Normal.'
            }
        },
        required: ['titulo', 'conteudo', 'destinatarios']
    },

    cargosPermitidos: ['diretor', 'secretaria'],
    mutates: true,

    async handler({ titulo, conteudo, destinatarios, prioridade }, ctx) {
        const tituloLimpo = String(titulo || '').trim();
        const conteudoLimpo = String(conteudo || '').trim();

        if (!tituloLimpo) {
            throw new ErroPermissao('Preciso do título do comunicado. Pergunte à pessoa.');
        }
        if (!conteudoLimpo) {
            throw new ErroPermissao('Preciso do texto do comunicado. Pergunte à pessoa o que deve ser comunicado.');
        }
        if (conteudoLimpo.length > MAX_CHARS_CONTEUDO) {
            throw new ErroPermissao(`O comunicado está muito longo (máximo de ${MAX_CHARS_CONTEUDO} caracteres).`);
        }

        const alvos = (Array.isArray(destinatarios) ? destinatarios : [destinatarios])
            .map(d => String(d || '').toLowerCase().trim())
            .filter(d => DESTINATARIOS.includes(d));

        if (alvos.length === 0) {
            throw new ErroPermissao(
                `Preciso saber quem recebe o comunicado. Opções: ${DESTINATARIOS.join(', ')}.`
            );
        }

        const prioridadeLimpa = PRIORIDADES.includes(prioridade) ? prioridade : 'Normal';

        return {
            // O preview leva o texto INTEIRO: o objetivo da confirmação é a
            // pessoa reler o que vai sair no nome dela.
            resumo: `Enviar comunicado "${tituloLimpo}" para ${alvos.join(', ')} `
                + `(prioridade ${prioridadeLimpa})`,
            parametros: {
                titulo: tituloLimpo,
                conteudo: conteudoLimpo,
                destinatarios: alvos,
                prioridade: prioridadeLimpa
            }
        };
    },

    async confirmar(parametros, ctx) {
        filtroDaEscola(ctx);

        const autor = await Usuario.findById(ctx.usuarioId).lean();
        if (!autor) {
            throw new ErroPermissao('Não encontrei seu cadastro para assinar o comunicado.');
        }

        const comunicado = await Comunicado.create({
            escolaId: ctx.escolaId,
            titulo: parametros.titulo,
            conteudo: parametros.conteudo,
            // Mesmos campos de autoria que o ComunicadoController preenche —
            // o comunicado precisa ser indistinguível de um criado pela tela.
            diretorId: ctx.usuarioId,
            diretorNome: autor.nome,
            diretorFoto: autor.foto || autor.fotoGoogle || '',
            diretorPerfil: autor.perfil || 'Direção',
            autorId: ctx.usuarioId,
            autorNome: autor.nome,
            autorPerfil: autor.perfil,
            destinatarios: parametros.destinatarios,
            categoria: ctx.perfil === 'secretaria' ? 'Secretaria' : 'Direção',
            prioridade: parametros.prioridade,
            dataAgendada: null
        });

        // Notificação pelo MESMO serviço da tela normal. Uma falha aqui não
        // desfaz o comunicado — ele está publicado e visível no mural; o que se
        // perde é o empurrão da notificação, e isso precisa aparecer no log.
        try {
            const NotificationService = require('../../NotificationService');
            await NotificationService.notify({
                tipo: 'informativo',
                categoria: (ctx.perfil === 'secretaria' ? 'secretaria' : 'direcao'),
                prioridade: parametros.prioridade === 'Urgente' ? 'alta' : 'media',
                titulo: parametros.titulo,
                mensagem: parametros.conteudo.replace(/<[^>]*>/g, '').substring(0, 150)
                    + (parametros.conteudo.length > 150 ? '...' : ''),
                corpoHtml: parametros.conteudo,
                destinatarios: parametros.destinatarios,
                criadoPor: ctx.usuarioId,
                link: '/dashboard',
                comunicadoId: comunicado._id,
                escolaId: ctx.escolaId
            });
        } catch (e) {
            logger.error('[IA] Comunicado publicado, mas a notificação falhou', {
                err: e, action: 'ia.comunicado', comunicadoId: String(comunicado._id)
            });
        }

        return {
            recursoId: String(comunicado._id),
            mensagem: `Comunicado "${comunicado.titulo}" publicado para ${parametros.destinatarios.join(', ')}.`,
            comunicado: {
                titulo: comunicado.titulo,
                destinatarios: comunicado.destinatarios,
                prioridade: comunicado.prioridade
            }
        };
    }
};
