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
const escapeRegex = require('../../../utils/escapeRegex');
const { assertAcessoAoAluno } = require('../../../middleware/assertAcessoAoAluno');
const { filtroDaEscola, ErroPermissao } = require('../PermissionGuard');

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
        const busca = String(termo || '').trim();
        if (busca.length < 2) {
            throw new ErroPermissao('Preciso de pelo menos 2 caracteres para buscar um aluno. Peça o nome completo à pessoa.');
        }

        // `escapeRegex` impede que um nome com metacaracteres (ou um termo
        // hostil vindo do texto do usuário) vire uma regex custosa.
        const padrao = new RegExp(escapeRegex(busca), 'i');

        const candidatos = await Aluno.find({
            ...filtroDaEscola(ctx),
            $or: [{ nome: padrao }, { matricula: busca }]
        })
            .select('nome matricula turma turmaId ativo dataNascimento responsavel responsavelDados responsaveis email escolaId id')
            .limit(MAX_CANDIDATOS)
            .lean();

        // Cada candidato é reavaliado individualmente pelo guard do sistema.
        const autorizados = [];
        for (const aluno of candidatos) {
            const acesso = await assertAcessoAoAluno(ctx.req, String(aluno._id), { aluno });
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
            truncado: candidatos.length >= MAX_CANDIDATOS,
            alunos: autorizados.map(a => ({
                // O id é o que as outras ferramentas usam nas consultas seguintes.
                id: String(a._id),
                nome: a.nome,
                matricula: a.matricula,
                turma: a.turma || a.turmaId,
                ativo: a.ativo !== false
            }))
        };
    }
};
