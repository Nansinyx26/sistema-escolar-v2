/**
 * regeneracaoCodigosAluno — troca em lote os códigos de vínculo dos alunos
 * (Issue #389).
 *
 * Usado depois que os códigos circularam por um caminho que não deveria
 * (respostas de API corrigidas na #388). Um código novo invalida o antigo na
 * hora: o antigo deixa de achar o aluno. Vínculos que JÁ existem não mudam — o
 * acesso do responsável vinculado não depende do código.
 *
 * Padrão é SIMULAR (só conta). Nada muda sem `aplicar: true`.
 * `somenteSemVinculo`: troca só o código de quem ainda não tem responsável
 * vinculado (os únicos em que um código vazado ainda abre alguma porta).
 */
const Aluno = require('../models/Aluno');
const AuditLog = require('../models/AuditLog');
const { assignSecretCodes } = require('../utils/secretCodeHelper');

function filtro({ somenteSemVinculo, escolaId }) {
    const f = { ativo: { $ne: false } };
    if (escolaId) f.escolaId = String(escolaId);
    if (somenteSemVinculo) {
        f.$or = [{ responsavel: { $exists: false } }, { responsavel: null }, { responsavel: '' }];
    }
    return f;
}

/**
 * @param {{ aplicar?: boolean, somenteSemVinculo?: boolean, escolaId?: string }} opcoes
 * @returns {Promise<{ aplicado: boolean, total: number, porEscola: Record<string, number>,
 *   trocados: number, lista: Array<{escolaId, turma, nome, matricula, codigo}> }>}
 *   `lista` só vem preenchida quando `aplicar` — é o que a secretaria redistribui.
 */
async function regenerarCodigosDeAlunos({
    aplicar = false,
    somenteSemVinculo = false,
    escolaId = null,
} = {}) {
    const consulta = filtro({ somenteSemVinculo, escolaId });
    const grupos = await Aluno.aggregate([
        { $match: consulta },
        { $group: { _id: '$escolaId', total: { $sum: 1 } } },
    ]);
    const porEscola = Object.fromEntries(
        grupos.map((g) => [String(g._id || 'sem-escola'), g.total])
    );
    const total = grupos.reduce((s, g) => s + g.total, 0);

    if (!aplicar || total === 0) {
        return { aplicado: false, total, porEscola, trocados: 0, lista: [] };
    }

    const alunos = await Aluno.find(consulta)
        .select('_id escolaId turma turmaId nome sobrenome matricula')
        .sort({ escolaId: 1, turma: 1, nome: 1 })
        .lean();
    const novos = await assignSecretCodes(alunos.map((a) => a._id));

    const lista = alunos
        .filter((a) => novos.has(String(a._id)))
        .map((a) => ({
            escolaId: a.escolaId || '',
            turma: a.turma || a.turmaId || '',
            nome: [a.nome, a.sobrenome].filter(Boolean).join(' '),
            matricula: a.matricula || '',
            codigo: novos.get(String(a._id)),
        }));

    await AuditLog.create({
        usuarioEmail: 'script@sistema',
        perfil: 'sistema',
        acao: 'CODIGOS_ALUNO_REGENERADOS',
        recurso: 'Alunos',
        detalhes: {
            valorNovo: { porEscola, trocados: lista.length, somenteSemVinculo },
            descricao: `Códigos de vínculo regenerados: ${lista.length} aluno(s).`,
        },
    });

    return { aplicado: true, total, porEscola, trocados: lista.length, lista };
}

module.exports = { regenerarCodigosDeAlunos };
