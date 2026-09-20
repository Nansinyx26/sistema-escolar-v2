/**
 * limpezaCamposSemFinalidade — apaga do banco os campos que saíram do cadastro
 * (Issue #408): `religiao` do aluno e `responsabilidadeFinanceira` de cada
 * responsável, inclusive dentro de `responsavelDados`.
 *
 * Tirar do schema impede novas gravações, mas não apaga o que já está lá.
 * Minimização (LGPD, art. 6º, III) é sobre o dado guardado, não só sobre o
 * formulário — por isso este serviço existe.
 *
 * Padrão é SIMULAR: sem `aplicar: true`, apenas conta. A escrita passa pela
 * coleção crua porque, fora do schema, o Mongoose descartaria os caminhos do
 * `$unset`.
 */
const Aluno = require('../../models/Aluno');
const AuditLog = require('../../models/AuditLog');

const FILTRO = {
    $or: [
        { religiao: { $exists: true } },
        { 'responsaveis.responsabilidadeFinanceira': { $exists: true } },
        { 'responsavelDados.responsabilidadeFinanceira': { $exists: true } },
    ],
};

const REMOCAO = {
    religiao: '',
    'responsaveis.$[].responsabilidadeFinanceira': '',
    'responsavelDados.responsabilidadeFinanceira': '',
};

/**
 * @param {{ aplicar?: boolean }} [opcoes]
 * @returns {Promise<{ aplicado: boolean, porCampo: Record<string, number>,
 *   documentos: number, limpos: number }>}
 */
async function limparCamposSemFinalidade({ aplicar = false } = {}) {
    const colecao = Aluno.collection;
    const porCampo = {
        religiao: await colecao.countDocuments({ religiao: { $exists: true } }),
        'responsaveis[].responsabilidadeFinanceira': await colecao.countDocuments({
            'responsaveis.responsabilidadeFinanceira': { $exists: true },
        }),
        'responsavelDados.responsabilidadeFinanceira': await colecao.countDocuments({
            'responsavelDados.responsabilidadeFinanceira': { $exists: true },
        }),
    };
    const documentos = await colecao.countDocuments(FILTRO);

    if (!aplicar || documentos === 0) {
        return { aplicado: false, porCampo, documentos, limpos: 0 };
    }

    const r = await colecao.updateMany(FILTRO, { $unset: REMOCAO });
    const limpos = r.modifiedCount || 0;

    await AuditLog.create({
        usuarioEmail: 'script@sistema',
        perfil: 'sistema',
        acao: 'CAMPOS_SEM_FINALIDADE_REMOVIDOS',
        recurso: 'Alunos',
        detalhes: {
            valorAnterior: porCampo,
            valorNovo: { documentos: limpos },
            descricao: `Campos sem finalidade removidos de ${limpos} cadastro(s).`,
        },
    });

    return { aplicado: true, porCampo, documentos, limpos };
}

module.exports = { limparCamposSemFinalidade, FILTRO, REMOCAO };
