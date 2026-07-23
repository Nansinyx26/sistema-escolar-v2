const ChatDireto = require('../models/ChatDireto');
const Usuario = require('../models/Usuario');
const logger = require('../utils/logger');

const PERFIS_GESTAO = ['admin', 'diretor', 'secretaria'];

/**
 * Verifica se dois usuários podem trocar mensagens diretas.
 *
 * Antes, `enviarMensagem` aceitava qualquer destinatarioId — sem validar
 * vínculo, perfil ou escola —, então qualquer conta autenticada mandava
 * mensagem para qualquer outra da rede inteira.
 *
 * Regra: precisam estar na mesma escola. Responsável só fala com a equipe
 * escolar (professor/diretor/secretaria), nunca com outro responsável.
 */
async function podeConversar(remetente, destinatarioId) {
    const destinatario = await Usuario.findById(String(destinatarioId))
        .select('perfil escolaId ativo')
        .lean();

    if (!destinatario || destinatario.ativo === false) {
        return { ok: false, status: 404, error: 'Destinatário não encontrado.' };
    }

    const perfilRemetente = String(remetente.perfil || '').toLowerCase();
    const perfilDestino = String(destinatario.perfil || '').toLowerCase();

    if (perfilRemetente !== 'admin') {
        const escolaRemetente = remetente.escolaId ? String(remetente.escolaId) : null;
        const escolaDestino = destinatario.escolaId ? String(destinatario.escolaId) : null;
        if (escolaRemetente && escolaDestino && escolaRemetente !== escolaDestino) {
            return { ok: false, status: 403, error: 'Este usuário pertence a outra escola.' };
        }
    }

    const equipe = ['professor', ...PERFIS_GESTAO];
    if (perfilRemetente === 'responsavel' && !equipe.includes(perfilDestino)) {
        return { ok: false, status: 403, error: 'Responsáveis só podem falar com a equipe escolar.' };
    }
    if (perfilDestino === 'responsavel' && !equipe.includes(perfilRemetente)) {
        return { ok: false, status: 403, error: 'Apenas a equipe escolar pode iniciar conversa com responsáveis.' };
    }

    return { ok: true, destinatario };
}

exports.enviarMensagem = async (req, res) => {
    try {
        const { destinatarioId, mensagem, turmaId, alunoId, contexto } = req.body;
        const remetenteId = req.user.id;

        if (!destinatarioId || !mensagem) {
            return res.status(400).json({ success: false, error: 'Destinatário e mensagem são obrigatórios.' });
        }

        const permissao = await podeConversar(
            { ...req.user, escolaId: req.escolaId },
            destinatarioId
        );
        if (!permissao.ok) {
            return res.status(permissao.status).json({ success: false, error: permissao.error });
        }

        const novaMensagem = await ChatDireto.create({
            remetenteId,
            destinatarioId,
            turmaId,
            alunoId,
            contexto,
            mensagem,
            escolaId: req.escolaId ? String(req.escolaId) : undefined
        });

        res.json({ success: true, data: novaMensagem });
    } catch (error) {
        logger.error(`[ChatDireto] Erro: ${error.message}`);
        res.status(500).json({ success: false, error: 'Erro ao enviar mensagem.' });
    }
};

exports.getHistorico = async (req, res) => {
    try {
        const { outroUsuarioId } = req.params;
        const meuId = req.user.id;

        // O filtro já é próprio: só conversas em que o usuário é uma das pontas
        const mensagens = await ChatDireto.find({
            $or: [
                { remetenteId: meuId, destinatarioId: String(outroUsuarioId) },
                { remetenteId: String(outroUsuarioId), destinatarioId: meuId }
            ]
        }).sort({ createdAt: 1 }).lean();

        res.json({ success: true, data: mensagens });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

exports.marcarComoLida = async (req, res) => {
    try {
        const { mensagemId } = req.params;

        // SEGURANÇA: só o DESTINATÁRIO marca como lida. O findByIdAndUpdate
        // solto permitia a qualquer usuário alterar o estado de leitura de
        // qualquer mensagem do sistema.
        const atualizada = await ChatDireto.findOneAndUpdate(
            { _id: String(mensagemId), destinatarioId: req.user.id },
            { lida: true },
            { new: true }
        );

        if (!atualizada) {
            return res.status(404).json({ success: false, error: 'Mensagem não encontrada.' });
        }

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
