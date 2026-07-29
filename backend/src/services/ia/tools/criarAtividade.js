'use strict';

/**
 * criarAtividade — propõe uma tarefa/avaliação para uma turma.
 *
 * Diferente das demais ferramentas de escrita, esta é do PROFESSOR: propor
 * atividade para a própria turma é o trabalho dele. O recorte de turma
 * (`restringirPorTurma` via `turmasPermitidas`) impede que ele lance atividade
 * numa turma que não é sua.
 */

const Atividade = require('../../../models/Atividade');
const Turma = require('../../../models/Turma');
const { filtroDaEscola, turmasPermitidas, ErroPermissao } = require('../PermissionGuard');

const TIPOS = ['tarefa', 'prova', 'trabalho', 'projeto', 'leitura', 'outro'];

const normalizar = (t) => String(t || '').replace('º', '').trim().toUpperCase();

/** Aceita "2026-08-15" e "15/08/2026". */
function lerData(valor) {
    if (!valor) return null;
    const texto = String(valor).trim();

    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);
    if (br) return new Date(Number(br[3]), Number(br[2]) - 1, Number(br[1]));

    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
    // Por componentes, para não sofrer o deslocamento de fuso do parser ISO.
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

    const solta = new Date(texto);
    return Number.isNaN(solta.getTime()) ? null : solta;
}

const formatar = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

module.exports = {
    name: 'criarAtividade',
    description: 'Cria uma atividade (tarefa, prova, trabalho) para uma turma, com prazo de entrega. Use quando pedirem para lançar/propor/passar uma atividade. Exige confirmação antes de ser criada.',

    schema: {
        type: 'object',
        properties: {
            titulo: { type: 'string', description: 'Título da atividade.' },
            turma: { type: 'string', description: 'Turma que receberá a atividade, como "6B".' },
            tipo: { type: 'string', enum: TIPOS, description: 'Natureza da atividade. Padrão: tarefa.' },
            materia: { type: 'string', description: 'Disciplina.' },
            dataEntrega: { type: 'string', description: 'Prazo de entrega, no formato AAAA-MM-DD.' },
            descricao: { type: 'string', description: 'Enunciado ou orientações.' },
            valor: { type: 'number', description: 'Pontuação da atividade, se houver.' },
            bimestre: { type: 'number', description: 'Bimestre (1 a 4).' }
        },
        required: ['titulo', 'turma']
    },

    cargosPermitidos: ['diretor', 'secretaria', 'professor'],
    mutates: true,

    async handler({ titulo, turma, tipo, materia, dataEntrega, descricao, valor, bimestre }, ctx) {
        const tituloLimpo = String(titulo || '').trim();
        if (!tituloLimpo) {
            throw new ErroPermissao('Preciso do título da atividade. Pergunte à pessoa.');
        }

        const turmaLimpa = String(turma || '').trim();
        if (!turmaLimpa) {
            throw new ErroPermissao('Preciso saber para qual turma é a atividade.');
        }

        // Professor só lança na própria turma, mesmo que peça outra.
        const permitidas = turmasPermitidas(ctx);
        if (permitidas !== null) {
            const minhas = new Set(permitidas.map(normalizar));
            if (!minhas.has(normalizar(turmaLimpa))) {
                throw new ErroPermissao(
                    `A turma "${turmaLimpa}" não está entre as suas. Explique isso à pessoa com cordialidade.`
                );
            }
        }

        // A turma precisa existir na escola — evita atividade órfã por erro de
        // digitação ("6C" quando a escola tem "6ºC" ou nenhuma).
        const turmas = await Turma.find({ ...filtroDaEscola(ctx), ativo: { $ne: false } })
            .select('nome id').lean();
        const existente = turmas.find(t => normalizar(t.nome || t.id) === normalizar(turmaLimpa));
        if (!existente) {
            throw new ErroPermissao(`Não encontrei a turma "${turmaLimpa}" nesta escola. Confirme o nome com a pessoa.`);
        }

        const tipoLimpo = TIPOS.includes(String(tipo || '').toLowerCase())
            ? String(tipo).toLowerCase()
            : 'tarefa';

        const prazo = lerData(dataEntrega);
        if (dataEntrega && !prazo) {
            throw new ErroPermissao('Não entendi a data de entrega. Peça no formato dia/mês/ano.');
        }

        const parametros = {
            titulo: tituloLimpo,
            turma: existente.nome || existente.id,
            tipo: tipoLimpo,
            materia: materia ? String(materia).trim() : undefined,
            descricao: descricao ? String(descricao).trim() : undefined,
            dataEntrega: prazo ? prazo.toISOString() : undefined,
            valor: Number.isFinite(Number(valor)) ? Number(valor) : undefined,
            bimestre: Number(bimestre) || undefined
        };

        return {
            resumo: `Criar ${tipoLimpo} "${tituloLimpo}" para a turma ${parametros.turma}`
                + (prazo ? `, entrega em ${formatar(prazo)}` : ' (sem prazo definido)'),
            parametros
        };
    },

    async confirmar(parametros, ctx) {
        const atividade = await Atividade.create({
            escolaId: ctx.escolaId,
            titulo: parametros.titulo,
            descricao: parametros.descricao,
            turma: parametros.turma,
            materia: parametros.materia,
            tipo: parametros.tipo,
            bimestre: parametros.bimestre,
            valor: parametros.valor,
            dataEntrega: parametros.dataEntrega ? new Date(parametros.dataEntrega) : undefined,
            criadoPor: ctx.usuarioId,
            criadoPorNome: ctx.nome,
            ativo: true
        });

        return {
            recursoId: String(atividade._id),
            mensagem: `Atividade "${atividade.titulo}" criada para a turma ${atividade.turma}.`,
            atividade: {
                titulo: atividade.titulo,
                turma: atividade.turma,
                tipo: atividade.tipo,
                entrega: atividade.dataEntrega
            }
        };
    }
};
