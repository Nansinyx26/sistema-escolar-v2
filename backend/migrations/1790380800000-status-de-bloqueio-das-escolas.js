/**
 * Migração: preencher `status: 'ativa'` nas escolas existentes (Issue #463).
 *
 * O campo nasceu com a gestão de escolas do super admin. O schema já tem
 * `default: 'ativa'`, mas default do mongoose só vale para documento CRIADO
 * depois dele — as escolas que já estão no banco ficam sem o campo, e o
 * filtro "Ativas" da gestão (`status: 'ativa'`) as deixaria de fora.
 *
 * `ativo` (cadeado da landing) NÃO é consultado: escola ainda não liberada
 * continua "não liberada", mas não está BLOQUEADA — são decisões diferentes.
 *
 * IDEMPOTENTE: só toca escola sem `status`, então rodar duas vezes não muda
 * nada e nunca desbloqueia uma escola bloqueada entre uma execução e outra.
 */

/** Escolas que ainda não têm o campo — exportado para o teste. */
const FILTRO_SEM_STATUS = { status: { $exists: false } };

module.exports = {
    version: '1.6',
    FILTRO_SEM_STATUS,

    async up() {
        const mongoose = require('mongoose');
        const resultado = await mongoose.connection.db
            .collection('escolas')
            .updateMany(FILTRO_SEM_STATUS, { $set: { status: 'ativa' } });

        console.log(`  … ${resultado.modifiedCount} escola(s) marcada(s) como ativa`);
        return { message: "status 'ativa' preenchido nas escolas existentes", atualizadas: resultado.modifiedCount };
    },

    /**
     * ROLLBACK: remove os campos de bloqueio de TODAS as escolas. O código
     * anterior não conhece o bloqueio — uma escola que ficasse com
     * `status: 'bloqueada'` depois do rollback seguiria acessível, então o
     * campo sai inteiro em vez de mentir. O histórico continua no AuditLog.
     */
    async down() {
        const mongoose = require('mongoose');
        const resultado = await mongoose.connection.db.collection('escolas').updateMany(
            {},
            {
                $unset: {
                    status: '',
                    motivoBloqueio: '',
                    bloqueadaEm: '',
                    bloqueadaPor: '',
                    desbloqueadaEm: '',
                    desbloqueadaPor: '',
                },
            }
        );
        return { message: 'campos de bloqueio removidos', revertidas: resultado.modifiedCount };
    },
};
