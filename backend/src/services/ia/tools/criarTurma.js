'use strict';

/**
 * criarTurma — cria uma turma na escola da sessão.
 *
 * Ferramenta de ESCRITA: o `handler` só monta o preview; quem grava é
 * `confirmar`, chamado apenas por POST /api/ia/confirmar com token válido.
 */

const Turma = require('../../../models/Turma');
const { filtroDaEscola, ErroPermissao } = require('../PermissionGuard');

const PERIODOS = ['manha', 'tarde', 'noite', 'integral'];

/** "1ºA" e "1A" são a mesma turma para efeito de duplicidade. */
const normalizar = (t) => String(t || '').replace('º', '').trim().toUpperCase();

module.exports = {
    name: 'criarTurma',
    description: 'Cria uma nova turma na escola. Use quando pedirem para abrir/criar uma turma. A ação exige confirmação da pessoa antes de ser efetivada.',

    schema: {
        type: 'object',
        properties: {
            nome: {
                type: 'string',
                description: 'Identificador da turma, como "6C" ou "1A".'
            },
            periodo: {
                type: 'string',
                enum: PERIODOS,
                description: 'Período da turma.'
            },
            ano: {
                type: 'number',
                description: 'Ano letivo. Omita para usar o ano corrente.'
            },
            sala: { type: 'string', description: 'Sala física, se houver.' },
            capacidade: { type: 'number', description: 'Número máximo de alunos.' }
        },
        required: ['nome', 'periodo']
    },

    cargosPermitidos: ['diretor', 'secretaria'],
    mutates: true,

    /**
     * PREVIEW — valida e devolve o que será feito. Não escreve nada.
     * Validar aqui (e não só no confirmar) faz o erro aparecer ANTES de a
     * pessoa clicar em "Confirmar", que é quando ela ainda pode corrigir.
     */
    async handler({ nome, periodo, ano, sala, capacidade }, ctx) {
        const nomeLimpo = String(nome || '').trim();
        if (!nomeLimpo) {
            throw new ErroPermissao('Preciso do nome da turma. Pergunte à pessoa qual é.');
        }

        const periodoLimpo = String(periodo || '').toLowerCase().trim();
        if (!PERIODOS.includes(periodoLimpo)) {
            throw new ErroPermissao(`Período inválido. Os valores aceitos são: ${PERIODOS.join(', ')}.`);
        }

        const anoLetivo = Number(ano) || new Date().getFullYear();

        // Duplicidade checada no preview: melhor avisar agora que falhar depois
        // da confirmação.
        const existentes = await Turma.find({ ...filtroDaEscola(ctx), ativo: { $ne: false } })
            .select('nome id').lean();
        if (existentes.some(t => normalizar(t.nome || t.id) === normalizar(nomeLimpo))) {
            throw new ErroPermissao(`Já existe uma turma "${nomeLimpo}" nesta escola. Avise a pessoa.`);
        }

        const parametros = {
            nome: nomeLimpo,
            periodo: periodoLimpo,
            ano: anoLetivo,
            sala: sala ? String(sala).trim() : undefined,
            capacidade: Number(capacidade) || undefined
        };

        return {
            resumo: `Criar turma "${nomeLimpo}" — período ${periodoLimpo}, ano ${anoLetivo}`
                + (parametros.sala ? `, sala ${parametros.sala}` : ''),
            parametros
        };
    },

    /** EXECUÇÃO — só chamada após confirmação válida. */
    async confirmar(parametros, ctx) {
        const turma = await Turma.create({
            // O tenant vem do contexto do servidor, nunca dos parâmetros.
            escolaId: ctx.escolaId,
            id: parametros.nome,
            nome: parametros.nome,
            periodo: parametros.periodo,
            ano: parametros.ano,
            sala: parametros.sala,
            capacidade: parametros.capacidade,
            ativo: true
        });

        return {
            recursoId: String(turma._id),
            mensagem: `Turma "${turma.nome}" criada com sucesso.`,
            turma: {
                nome: turma.nome,
                periodo: turma.periodo,
                ano: turma.ano,
                sala: turma.sala
            }
        };
    }
};
