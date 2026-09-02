'use strict';

/**
 * buscarAluno — localiza alunos por nome ou matrícula.
 *
 * É a ferramenta de resolução de identidade: o usuário diz "notas do João" e o
 * modelo usa esta busca antes de consultar notas.
 *
 * FILTRO DE ACESSO POR DOCUMENTO
 * ------------------------------
 * A consulta por nome traz candidatos da escola; cada candidato passa então
 * pelo `assertAcessoAoAluno` — o MESMO guard das rotas HTTP. É isso que faz um
 * responsável ver só os próprios filhos e um professor só os alunos das turmas
 * dele, sem reimplementar essas regras aqui.
 */

const Aluno = require('../../../models/Aluno');
const { assertAcessoAoAluno } = require('../../../middleware/assertAcessoAoAluno');
const { filtroDaEscola, ErroPermissao } = require('../PermissionGuard');
const { nomeExibicao, sugerirAlunos } = require('../sugestaoAlunos');

/** Teto de candidatos avaliados. Evita varrer a escola num termo muito curto. */
const MAX_CANDIDATOS = 40;
const MAX_RESULTADOS = 10;

module.exports = {
    name: 'buscarAluno',
    description: 'Busca alunos pelo nome (parcial) ou pela matrícula. Use SEMPRE antes de consultar notas ou frequência de um aluno citado por nome, para descobrir a turma e confirmar de quem se trata.',

    schema: {
        type: 'object',
        properties: {
            termo: {
                type: 'string',
                description: 'Nome (ou parte do nome) ou número de matrícula do aluno.'
            }
        },
        required: ['termo']
    },

    cargosPermitidos: ['diretor', 'secretaria', 'professor', 'responsavel'],
    mutates: false,

    async handler({ termo }, ctx) {
        const texto = String(termo || '').trim();
        if (texto.length < 2) {
            throw new ErroPermissao('Preciso de pelo menos 2 caracteres para buscar um aluno. Peça o nome completo à pessoa.');
        }

        // A busca por nome é a MESMA do autocomplete do chat
        // (`services/ia/sugestaoAlunos`): sem acento, sem caixa, quem começa
        // com o texto primeiro. O que existia aqui era um `RegExp(termo, 'i')`
        // sem âncora — "joao" não achava "João", e "ana" devolvia "Mariana" e
        // "Luana" como se fossem o aluno pedido.
        const { alunos: sugestoes } = await sugerirAlunos({
            texto,
            filtro: filtroDaEscola(ctx),
            limite: MAX_CANDIDATOS,
            minTermo: 2,
        });

        // Os documentos completos são recarregados porque é sobre eles que o
        // guard decide (turma, escola, vínculo do responsável); um documento
        // parcial faria o guard julgar por campos ausentes.
        const ids = sugestoes.map(a => a.id);
        const documentos = ids.length
            ? await Aluno.find({ _id: { $in: ids } })
                .select('nome sobrenome matricula turma turmaId ativo dataNascimento responsavel responsavelDados responsaveis email escolaId id')
                .lean()
            : [];
        const porId = new Map(documentos.map(doc => [String(doc._id), doc]));

        // Cada candidato é reavaliado individualmente pelo guard do sistema —
        // agora na ordem de relevância, de modo que o corte em MAX_RESULTADOS
        // preserve os nomes mais parecidos com o que foi pedido.
        const autorizados = [];
        for (const sugestao of sugestoes) {
            const aluno = porId.get(sugestao.id);
            if (!aluno) continue;
            const acesso = await assertAcessoAoAluno(ctx.req, sugestao.id, { aluno });
            if (acesso.ok) autorizados.push(aluno);
            if (autorizados.length >= MAX_RESULTADOS) break;
        }

        if (autorizados.length === 0) {
            return {
                total: 0,
                alunos: [],
                observacao: 'Nenhum aluno encontrado com esse termo entre os que você pode consultar.'
            };
        }

        return {
            total: autorizados.length,
            truncado: sugestoes.length >= MAX_CANDIDATOS,
            alunos: autorizados.map(a => ({
                // O id é o que as outras ferramentas usam nas consultas seguintes.
                id: String(a._id),
                nome: nomeExibicao(a),
                matricula: a.matricula,
                turma: a.turma || a.turmaId,
                ativo: a.ativo !== false
            }))
        };
    }
};
