/**
 * Leva a chave por escola da #496 para a autorização por professor (Issue #727).
 *
 * Até aqui, `Escola.professorVeAutorizacoes: true` liberava a consulta da
 * situação das autorizações para TODOS os professores da escola. Agora a
 * consulta exige a ferramenta "gestao.autorizacoes-pais" autorizada para cada
 * professor. Para ninguém perder o acesso que já tinha, cada professor atual
 * dessas escolas recebe a autorização, com um registro no AuditLog.
 *
 * Idempotente: quem já tem a autorização não é tocado nem auditado de novo.
 * Escola com a chave desligada ou sem decisão não recebe nada.
 */
const Escola = require('../src/models/Escola');
const PermissaoFerramenta = require('../src/models/PermissaoFerramenta');
const AuditLog = require('../src/models/AuditLog');
const { professoresDaEscola } = require('../src/services/ferramentas/permissaoFerramenta');

const FERRAMENTA = 'gestao.autorizacoes-pais';

module.exports = {
    version: '1.12',

    async up() {
        const escolas = await Escola.find({ professorVeAutorizacoes: true }).select('_id').lean();

        let autorizados = 0;
        let jaTinham = 0;
        for (const escola of escolas) {
            const escolaId = String(escola._id);
            for (const professor of await professoresDaEscola(escolaId)) {
                const filtro = { escolaId, professorId: professor.id, ferramentaId: FERRAMENTA };
                const anterior = await PermissaoFerramenta.findOneAndUpdate(
                    filtro,
                    {
                        $set: {
                            autorizado: true,
                            autorizadoPor: null,
                            autorizadoEm: new Date(),
                            alteradoPor: null,
                        },
                    },
                    { upsert: true, returnDocument: 'before' }
                ).lean();

                if (anterior?.autorizado === true) {
                    jaTinham++;
                    continue;
                }
                autorizados++;
                await AuditLog.create({
                    usuarioId: null,
                    usuarioNome: 'Sistema/Migração',
                    usuarioEmail: 'Desconhecido',
                    perfil: 'sistema',
                    acao: 'FERRAMENTA_AUTORIZADA',
                    recurso: 'PermissaoFerramenta',
                    recursoId: `${professor.id}:${FERRAMENTA}`,
                    escolaId,
                    detalhes: {
                        valorAnterior: {
                            professorId: professor.id,
                            ferramentaId: FERRAMENTA,
                            autorizado: false,
                        },
                        valorNovo: {
                            professorId: professor.id,
                            ferramentaId: FERRAMENTA,
                            autorizado: true,
                        },
                        descricao: `Autorizações dos Pais mantido para o professor ${professor.id}: a escola já liberava a consulta para todos (Issue #496 → #727).`,
                    },
                });
            }
        }

        const resultado = { escolas: escolas.length, autorizados, jaTinham };
        console.log(`  … autorizações dos pais por professor: ${JSON.stringify(resultado)}`);
        return resultado;
    },

    // Não desfaz: depois da migração a direção pode ter decidido professor a
    // professor, e apagar as autorizações revogaria decisões dela. A chave
    // antiga continua gravada na escola, sem efeito.
    async down() {
        return { desfeito: false };
    },
};
