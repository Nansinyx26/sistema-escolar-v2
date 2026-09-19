/**
 * encerramentoSessoesEquipe — encerra sessões abertas de contas da equipe
 * (Issue #387).
 *
 * Até a #378, o login com Google emitia sessão para qualquer perfil sem passar
 * pelo segundo fator. Sessões assim podem continuar vivas até expirar. Somar 1
 * ao `tokenVersion` invalida na hora todo token já emitido para a conta (o
 * authJWT e o handshake do Socket.IO comparam a versão), e a pessoa entra de
 * novo pelo login com senha e 2FA.
 *
 * Alvo padrão: contas de equipe que já usaram o login com Google. Com
 * `todas: true`, todas as contas de equipe ativas.
 *
 * Padrão é SIMULAR: só conta e descreve. Nada muda sem `aplicar: true`.
 */
const Usuario = require('../models/Usuario');
const AuditLog = require('../models/AuditLog');

const PERFIS_EQUIPE = ['admin', 'diretor', 'secretaria', 'professor'];

function filtro({ todas }) {
    const base = { perfil: { $in: PERFIS_EQUIPE }, ativo: { $ne: false } };
    return todas ? base : { ...base, loginGoogle: true };
}

/**
 * @param {{ aplicar?: boolean, todas?: boolean }} opcoes
 * @returns {Promise<{ aplicado: boolean, alvo: string, total: number, porPerfil: Record<string, number>, alterados: number }>}
 */
async function encerrarSessoesDeEquipe({ aplicar = false, todas = false } = {}) {
    const consulta = filtro({ todas });
    const grupos = await Usuario.aggregate([
        { $match: consulta },
        { $group: { _id: '$perfil', total: { $sum: 1 } } },
    ]);
    const porPerfil = Object.fromEntries(grupos.map((g) => [g._id, g.total]));
    const total = grupos.reduce((soma, g) => soma + g.total, 0);
    const alvo = todas
        ? 'todas as contas de equipe ativas'
        : 'contas de equipe que usaram login Google';

    if (!aplicar || total === 0) {
        return { aplicado: false, alvo, total, porPerfil, alterados: 0 };
    }

    const resultado = await Usuario.updateMany(consulta, { $inc: { tokenVersion: 1 } });
    await AuditLog.create({
        usuarioEmail: 'script@sistema',
        perfil: 'sistema',
        acao: 'SESSOES_EQUIPE_ENCERRADAS',
        recurso: 'Segurança',
        detalhes: {
            valorNovo: { porPerfil, alterados: resultado.modifiedCount },
            descricao: `Sessões encerradas (${alvo}): ${resultado.modifiedCount} conta(s).`,
        },
    });
    return { aplicado: true, alvo, total, porPerfil, alterados: resultado.modifiedCount };
}

module.exports = { encerrarSessoesDeEquipe, PERFIS_EQUIPE };
