/**
 * TrocaEmailController.js — a própria pessoa troca o e-mail da conta
 * (Issue #609, épico #608). A regra, e o porquê dela, estão em
 * services/trocaEmail.js.
 *
 *   POST /api/auth/email/solicitar-troca  { novoEmail, senhaAtual }
 *   POST /api/auth/email/confirmar-troca  { token }
 *
 * As duas exigem sessão. A confirmação só vale na conta que pediu.
 */
const bcrypt = require('bcryptjs');
const Usuario = require('../models/Usuario');
const trocaEmail = require('../services/trocaEmail');
const {
    invalidarCacheDeVerificacao,
    exigeVerificacao,
    aguardaConfirmacao,
} = require('../services/verificacaoEmail');
const { mascarar } = require('../services/EnvioEmail');
const { notificarPedidoTrocaEmail, notificarEmailTrocado } = require('../utils/emailNotifications');
const { logAction } = require('../utils/auditHelper');
const { emitirTokenSessao } = require('../utils/sessionToken');
const { encerrarConexoesDaConta } = require('../utils/realtime');
const escapeRegex = require('../utils/escapeRegex');
const logger = require('../utils/logger');

const SEM_PEDIDO = { emailTrocaPendente: 1, emailTrocaTokenHash: 1, emailTrocaExpiry: 1 };

// Resposta igual com e sem o link enviado: quem pede não descobre por aqui
// quais endereços já têm conta.
const RESPOSTA_DO_PEDIDO = {
    success: true,
    message: `Se esse endereço puder ser usado, o link de confirmação chega nele em instantes. Abra o link com esta conta conectada, em até ${trocaEmail.VALIDADE_HORAS} horas.`,
};

const LINK_INVALIDO = {
    success: false,
    codigo: 'LINK_INVALIDO',
    error: 'Este link não vale para a conta conectada: ele venceu, já foi usado ou foi pedido em outra conta.',
};

const idDaSessao = (req) => String(req.user?.id || req.user?._id || '');

/** Outra conta já usa o endereço? Sem diferença de caixa: há cadastro antigo com maiúsculas. */
function enderecoEmUso(email, excetoId) {
    return Usuario.exists({
        _id: { $ne: excetoId },
        email: new RegExp(`^${escapeRegex(email)}$`, 'i'),
    });
}

exports.solicitar = async (req, res) => {
    try {
        const novo = trocaEmail.normalizarEmail(req.body?.novoEmail);
        const senhaAtual = typeof req.body?.senhaAtual === 'string' ? req.body.senhaAtual : '';
        if (!novo) {
            return res.status(400).json({
                success: false,
                codigo: 'EMAIL_INVALIDO',
                error: 'Informe um e-mail válido.',
            });
        }
        if (!senhaAtual) {
            return res.status(400).json({
                success: false,
                codigo: 'SENHA_ATUAL_OBRIGATORIA',
                error: 'Informe sua senha atual.',
            });
        }

        const conta = await Usuario.findById(idDaSessao(req)).select(
            '+senha email nome loginGoogle'
        );
        if (!conta) return res.status(404).json({ success: false, error: 'Conta não encontrada.' });

        // O login pelo Google acha a conta pelo e-mail: com o endereço trocado,
        // o próximo login criaria outra conta, sem os filhos.
        if (conta.loginGoogle) {
            return res.status(400).json({
                success: false,
                codigo: 'CONTA_GOOGLE',
                error: 'Esta conta entra pelo Google, que reconhece você pelo e-mail. Trocar o endereço criaria outra conta no próximo login. Para mudar, procure a secretaria da escola.',
            });
        }

        const senhaConfere =
            Boolean(conta.senha) && (await bcrypt.compare(senhaAtual, conta.senha));
        if (!senhaConfere) {
            await logAction(req, 'EMAIL_TROCA_SENHA_INCORRETA', 'Usuarios', {
                recursoId: String(conta._id),
                descricao: 'Pedido de troca de e-mail com a senha atual errada.',
            });
            return res.status(400).json({
                success: false,
                codigo: 'SENHA_ATUAL_INCORRETA',
                error: 'A senha atual não confere.',
            });
        }

        if (novo === String(conta.email || '').toLowerCase()) {
            return res.status(400).json({
                success: false,
                codigo: 'EMAIL_IGUAL',
                error: 'Este já é o e-mail da conta.',
            });
        }

        // Um pedido novo substitui o anterior: o link antigo deixa de valer.
        if (await enderecoEmUso(novo, conta._id)) {
            await Usuario.updateOne({ _id: conta._id }, { $unset: SEM_PEDIDO });
            await logAction(req, 'EMAIL_TROCA_ENDERECO_EM_USO', 'Usuarios', {
                recursoId: String(conta._id),
                descricao: `Troca de e-mail pedida para ${mascarar(novo)}, que já é de outra conta. Nenhum link enviado.`,
            });
            return res.json(RESPOSTA_DO_PEDIDO);
        }

        const { token, hash } = trocaEmail.novoToken();
        await Usuario.updateOne(
            { _id: conta._id },
            {
                $set: {
                    emailTrocaPendente: novo,
                    emailTrocaTokenHash: hash,
                    emailTrocaExpiry: trocaEmail.validadeDoPedido(),
                },
            }
        );

        const envio = await notificarPedidoTrocaEmail(
            novo,
            conta.nome,
            trocaEmail.urlDeConfirmacao(token),
            trocaEmail.VALIDADE_HORAS
        );
        if (!envio?.ok) {
            await Usuario.updateOne({ _id: conta._id }, { $unset: SEM_PEDIDO });
            logger.warn('[trocaEmail] Link de confirmação não entregue', {
                usuarioId: String(conta._id),
                etapa: envio?.etapa,
                action: 'trocaEmail.envioFalhou',
            });
            return res.status(503).json({
                success: false,
                codigo: 'ENVIO_FALHOU',
                error: 'Não conseguimos enviar o link agora. Tente de novo em alguns minutos.',
            });
        }

        await logAction(req, 'EMAIL_TROCA_SOLICITADA', 'Usuarios', {
            recursoId: String(conta._id),
            descricao: `Troca de e-mail pedida para ${mascarar(novo)}. Link enviado ao endereço novo.`,
        });
        return res.json(RESPOSTA_DO_PEDIDO);
    } catch (err) {
        logger.error('[trocaEmail] Falha ao pedir a troca', { err, action: 'trocaEmail.pedido' });
        return res.status(500).json({ success: false, error: 'Erro ao pedir a troca de e-mail.' });
    }
};

exports.confirmar = async (req, res) => {
    try {
        const token =
            typeof req.body?.token === 'string' ? req.body.token.trim().toLowerCase() : '';
        const id = idDaSessao(req);
        const conta = /^[a-f0-9]{64}$/.test(token)
            ? await Usuario.findOne({
                  _id: id,
                  emailTrocaTokenHash: trocaEmail.hashDoToken(token),
                  emailTrocaExpiry: { $gt: new Date() },
              }).select(
                  '+emailTrocaPendente email nome perfil emailVerificado createdAt confirmacaoEmailObrigatoria'
              )
            : null;

        if (!conta?.emailTrocaPendente) {
            await logAction(req, 'EMAIL_TROCA_CONFIRMACAO_RECUSADA', 'Usuarios', {
                recursoId: id,
                descricao:
                    'Confirmação de troca de e-mail com link vencido, usado ou de outra conta.',
            });
            return res.status(400).json(LINK_INVALIDO);
        }

        const antigo = String(conta.email || '').toLowerCase();
        const novo = conta.emailTrocaPendente;
        // As fichas apontam para o e-mail ANTIGO. Só leva os vínculos dele para
        // o novo quem provou ser dono do antigo (Issue #412/#716): sem isto,
        // quem criava a conta com o e-mail de outra família, sem confirmar, e
        // trocava para um endereço próprio recebia os filhos dela já com o
        // e-mail novo confirmado (Issue #754).
        const provouOAntigo = !exigeVerificacao(conta) && !aguardaConfirmacao(conta);

        // Entre o pedido e a confirmação alguém pode ter criado conta com o
        // endereço. O índice único cobre a mesma grafia; a consulta, as demais.
        const tomado = async () => {
            await Usuario.updateOne({ _id: conta._id }, { $unset: SEM_PEDIDO });
            return res.status(409).json({
                success: false,
                codigo: 'EMAIL_EM_USO',
                error: 'Este endereço passou a ser usado por outra conta. Peça a troca para outro e-mail.',
            });
        };
        if (await enderecoEmUso(novo, conta._id)) return tomado();

        let atualizada;
        try {
            // A condição no hash consome o link uma vez só, mesmo com dois
            // cliques simultâneos.
            atualizada = await Usuario.findOneAndUpdate(
                { _id: conta._id, emailTrocaTokenHash: trocaEmail.hashDoToken(token) },
                {
                    $set: { email: novo, emailVerificado: true },
                    $unset: SEM_PEDIDO,
                    // Derruba as outras sessões; esta recebe um token novo abaixo.
                    $inc: { tokenVersion: 1 },
                },
                { new: true }
            );
        } catch (err) {
            if (err?.code === 11000) return tomado();
            throw err;
        }
        if (!atualizada) return res.status(400).json(LINK_INVALIDO);
        // As outras abas perdem também o tempo real; esta reconecta com o
        // token novo emitido abaixo (Issue #667).
        encerrarConexoesDaConta(String(atualizada._id));

        invalidarCacheDeVerificacao(atualizada._id);
        const { alterados, falhas } = provouOAntigo
            ? await trocaEmail.migrarVinculos({ usuarioId: atualizada._id, antigo, novo })
            : { alterados: {}, falhas: [] };
        emitirTokenSessao(res, atualizada);

        const migrados = Object.entries(alterados)
            .filter(([, n]) => n > 0)
            .map(([etapa, n]) => `${etapa}: ${n}`)
            .join(', ');
        await logAction(req, 'EMAIL_TROCADO', 'Usuarios', {
            recursoId: String(atualizada._id),
            valorAnterior: mascarar(antigo),
            valorNovo: mascarar(novo),
            descricao: [
                'E-mail da conta trocado pela própria pessoa, com o link enviado ao endereço novo.',
                provouOAntigo
                    ? `Vínculos migrados: ${migrados || 'nenhum'}.`
                    : 'Vínculos NÃO migrados: o e-mail antigo nunca foi confirmado pela conta.',
                falhas.length ? `Não migrados (conferir as fichas): ${falhas.join(', ')}.` : '',
            ]
                .filter(Boolean)
                .join(' '),
        });

        const aviso = await notificarEmailTrocado(antigo, atualizada.nome, mascarar(novo));
        if (!aviso?.ok) {
            logger.warn('[trocaEmail] Aviso ao endereço antigo não entregue', {
                usuarioId: String(atualizada._id),
                etapa: aviso?.etapa,
                action: 'trocaEmail.avisoFalhou',
            });
        }

        const { getRedirectPath } = require('./UserController');
        return res.json({
            success: true,
            message: 'Pronto: o e-mail da conta foi trocado. Use o endereço novo para entrar.',
            email: novo,
            redirect_to: getRedirectPath(atualizada),
        });
    } catch (err) {
        logger.error('[trocaEmail] Falha ao confirmar a troca', {
            err,
            action: 'trocaEmail.confirmacao',
        });
        return res
            .status(500)
            .json({ success: false, error: 'Erro ao confirmar a troca de e-mail.' });
    }
};
