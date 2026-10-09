/**
 * notificacoesFerramenta.js — avisos do fluxo de autorização de ferramentas
 * (Issue #733).
 *
 *   professor pede      → cada diretor da escola recebe notificação
 *   direção decide      → o professor recebe notificação
 *
 * Reaproveita o que já existe, sem sistema paralelo:
 *   - `RealtimeNotification` (Central de Notificações e sininho) com o mesmo
 *     evento `notification:new` na sala `user:<id>` que o front já escuta;
 *   - `NotificationService.pushParaUsuario` para o celular, respeitando a
 *     preferência de push da pessoa.
 * Além disso emite `ferramentas:atualizadas` (para o professor) e
 * `ferramentas:solicitacao` (para a direção), que as telas usam para se
 * atualizar sem recarregar.
 *
 * Avisar é efeito colateral: uma falha aqui é registrada e NUNCA desfaz o
 * pedido nem a decisão, que já estão no banco.
 */
const RealtimeNotification = require('../../models/RealtimeNotification');
const Usuario = require('../../models/Usuario');
const Diretor = require('../../models/Diretor');
const NotificationService = require('../NotificationService');
const { emitirParaUsuario } = require('../../utils/realtime');
const logger = require('../../utils/logger');
const obs = require('../../observability');

// Página da direção (Etapa 4 da #720). O id do pedido vai na URL para a tela
// abrir direto nele.
const PAGINA_DIRECAO = '/html/direcao/autorizacoes-ferramentas.html';

/** Contas de diretor ativas da escola: pela escola da conta ou pelo vínculo. */
async function diretoresDaEscola(escolaId) {
    const escola = String(escolaId);
    const ativa = { perfil: 'diretor', ativo: { $ne: false }, anonimizadoEm: null };
    const [daConta, comVinculo] = await Promise.all([
        Usuario.find({ ...ativa, escolaId: escola })
            .select('_id')
            .lean(),
        Diretor.find({ 'vinculos.escolaId': escola }).select('idUsuario').lean(),
    ]);
    const ids = new Set(daConta.map((u) => String(u._id)));
    const extras = comVinculo.map((d) => d.idUsuario && String(d.idUsuario)).filter(Boolean);
    const faltam = extras.filter((id) => !ids.has(id));
    if (faltam.length) {
        const confirmados = await Usuario.find({ ...ativa, _id: { $in: faltam } })
            .select('_id')
            .lean();
        for (const u of confirmados) ids.add(String(u._id));
    }
    return [...ids];
}

async function avisar(receiverId, receiverType, { titulo, mensagem, linkUrl, escolaId, tag }) {
    const notification = await RealtimeNotification.create({
        receiverId,
        receiverType,
        title: titulo,
        message: mensagem,
        type: 'alert',
        icon: 'key-round',
        linkUrl,
        escolaId: String(escolaId),
    });
    const unreadCount = await RealtimeNotification.countDocuments({ receiverId, read: false });
    emitirParaUsuario(receiverId, 'notification:new', { notification, unreadCount });
    // Push em segundo plano: celular sem inscrição ou fora do ar não atrasa nada.
    NotificationService.pushParaUsuario(receiverId, {
        title: titulo,
        body: mensagem,
        url: linkUrl,
        tag,
    }).catch(() => {});
}

function registrarFalha(e, tipo) {
    obs.captureException(e, { tipo });
    logger.error(`[Ferramentas.${tipo}] ${e.message}`);
}

/**
 * O professor pediu uma ferramenta: avisa cada diretor da escola.
 *
 * @param {object} p
 * @param {string} p.escolaId
 * @param {object} p.solicitacao  documento de SolicitacaoFerramenta
 * @param {{id: string, nome: string}} p.professor
 * @param {{id: string, nome: string}} p.ferramenta
 */
async function notificarSolicitacao({ escolaId, solicitacao, professor, ferramenta }) {
    try {
        const diretores = await diretoresDaEscola(escolaId);
        const linkUrl = `${PAGINA_DIRECAO}?solicitacao=${encodeURIComponent(String(solicitacao._id))}`;
        const resumo = {
            id: String(solicitacao._id),
            professorId: professor.id,
            ferramentaId: ferramenta.id,
            criadaEm: solicitacao.createdAt,
        };
        for (const diretorId of diretores) {
            await avisar(diretorId, 'diretor', {
                titulo: 'Pedido de autorização de ferramenta',
                mensagem: `O professor ${professor.nome} solicitou autorização para utilizar a ferramenta "${ferramenta.nome}".`,
                linkUrl,
                escolaId,
                tag: `ferramenta-pedido-${solicitacao._id}`,
            });
            emitirParaUsuario(diretorId, 'ferramentas:solicitacao', resumo);
        }
        return diretores.length;
    } catch (e) {
        registrarFalha(e, 'notificar_solicitacao');
        return 0;
    }
}

const TEXTO_DECISAO = {
    autorizado: (nome) => `A direção autorizou você a utilizar a ferramenta "${nome}".`,
    recusado: (nome) => `A direção não autorizou o uso da ferramenta "${nome}".`,
    revogado: (nome) => `A direção retirou a sua autorização para a ferramenta "${nome}".`,
};

/**
 * A direção decidiu: avisa o professor e manda o novo estado para a tela dele.
 *
 * @param {object} p
 * @param {string} p.escolaId
 * @param {string} p.professorId
 * @param {{id: string, nome: string}} p.ferramenta
 * @param {'autorizado'|'recusado'|'revogado'} p.resultado
 */
async function notificarDecisao({ escolaId, professorId, ferramenta, resultado }) {
    try {
        await avisar(professorId, 'professor', {
            titulo: resultado === 'autorizado' ? 'Ferramenta liberada' : 'Ferramenta não liberada',
            mensagem: TEXTO_DECISAO[resultado](ferramenta.nome),
            linkUrl: '/html/dashboard.html',
            escolaId,
            tag: `ferramenta-${ferramenta.id}`,
        });
        emitirParaUsuario(professorId, 'ferramentas:atualizadas', {
            ferramentaId: ferramenta.id,
            status: resultado === 'autorizado' ? 'autorizado' : 'bloqueado',
        });
    } catch (e) {
        registrarFalha(e, 'notificar_decisao');
    }
}

module.exports = { diretoresDaEscola, notificarSolicitacao, notificarDecisao };
