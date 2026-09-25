/**
 * AdminPedidosTitularController.js
 *
 * Painel administrativo e governança para atendimento de direitos do titular (LGPD).
 * Monitora pedidos de exclusão, exportação e retificação com prazos legais (Issue #413).
 */
const PedidoTitular = require('../models/PedidoTitular');
const UserController = require('./UserController');
const { logAction } = require('../utils/auditHelper');
const escapeRegex = require('../utils/escapeRegex');
const logger = require('../utils/logger');

const STATUS_VALIDOS = ['pendente', 'em_analise', 'concluido', 'rejeitado'];
const TIPOS_VALIDOS = ['exclusao', 'exportacao', 'retificacao', 'informacao'];

/**
 * GET /api/admin/pedidos-titular
 * Lista todos os pedidos registrados pelos titulares com filtros de status e busca.
 */
exports.listarPedidos = async (req, res) => {
    try {
        const { status, tipo, busca } = req.query;
        const filtro = {};

        if (status && STATUS_VALIDOS.includes(status)) {
            filtro.status = status;
        }

        if (tipo && TIPOS_VALIDOS.includes(tipo)) {
            filtro.tipo = tipo;
        }

        if (busca && typeof busca === 'string' && busca.trim()) {
            const regexBusca = new RegExp(escapeRegex(busca.trim()), 'i');
            filtro.$or = [
                { protocolo: regexBusca },
                { usuarioEmail: regexBusca },
                { usuarioNome: regexBusca },
            ];
        }

        if (req.escolaId) {
            filtro.$or = [{ escolaId: String(req.escolaId) }, { escolaId: { $exists: false } }];
        }

        const pedidos = await PedidoTitular.find(filtro).sort({ createdAt: -1 }).lean();

        const agora = new Date();
        const dataFormatada = pedidos.map((p) => {
            const diffMs = new Date(p.prazoAtendimento) - agora;
            const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
            return {
                ...p,
                id: String(p._id),
                diasRestantes,
                atrasado: diasRestantes < 0 && ['pendente', 'em_analise'].includes(p.status),
            };
        });

        return res.json({
            success: true,
            data: dataFormatada,
            total: dataFormatada.length,
        });
    } catch (err) {
        logger.error('[AdminPedidosTitular] Falha ao listar pedidos', {
            err,
            action: 'adminPedidosTitular.listar',
        });
        return res
            .status(500)
            .json({ success: false, error: 'Erro ao listar pedidos do titular.' });
    }
};

/**
 * GET /api/admin/pedidos-titular/:id
 * Retorna os detalhes completos de uma solicitação específica.
 */
exports.obterPedido = async (req, res) => {
    try {
        const pedido = await PedidoTitular.findById(req.params.id).lean();
        if (!pedido) {
            return res.status(404).json({ success: false, error: 'Pedido não encontrado.' });
        }

        const agora = new Date();
        const diffMs = new Date(pedido.prazoAtendimento) - agora;
        const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

        return res.json({
            success: true,
            data: {
                ...pedido,
                id: String(pedido._id),
                diasRestantes,
                atrasado: diasRestantes < 0 && ['pendente', 'em_analise'].includes(pedido.status),
            },
        });
    } catch (err) {
        logger.error('[AdminPedidosTitular] Falha ao obter pedido', {
            err,
            action: 'adminPedidosTitular.obter',
        });
        return res.status(500).json({ success: false, error: 'Erro ao obter pedido.' });
    }
};

/**
 * PATCH /api/admin/pedidos-titular/:id
 * Atualiza o status, anotação interna ou resposta formal ao titular.
 * Permite também acionar a rotina de anonimização do usuário quando concluído.
 */
exports.atualizarStatus = async (req, res) => {
    try {
        const { status, observacao, respostaAdmin, anonimizarUsuario } = req.body;

        if (status && !STATUS_VALIDOS.includes(status)) {
            return res.status(400).json({
                success: false,
                error: `Status inválido. Valores aceitos: ${STATUS_VALIDOS.join(', ')}`,
            });
        }

        const pedido = await PedidoTitular.findById(req.params.id);
        if (!pedido) {
            return res.status(404).json({ success: false, error: 'Pedido não encontrado.' });
        }

        const adminIdentificador = req.user?.email || req.user?.nome || 'Administrador';
        const novoStatus = status || pedido.status;

        const novoHistorico = {
            status: novoStatus,
            alteradoEm: new Date(),
            alteradoPor: adminIdentificador,
            observacao: observacao
                ? String(observacao).trim()
                : `Status alterado para ${novoStatus}`,
        };

        pedido.historico.push(novoHistorico);
        pedido.status = novoStatus;

        if (respostaAdmin !== undefined) {
            pedido.respostaAdmin = String(respostaAdmin).trim();
        }

        if (novoStatus === 'concluido' || novoStatus === 'rejeitado') {
            pedido.decididoEm = new Date();
            pedido.decididoPor = adminIdentificador;
        }

        let usuarioAnonimizado = false;
        if (anonimizarUsuario && novoStatus === 'concluido' && pedido.tipo === 'exclusao') {
            const fakeReq = {
                params: { id: pedido.usuarioId },
                user: req.user,
                headers: req.headers || {},
                ip: req.ip,
            };
            const fakeRes = {
                status: (code) => ({
                    json: (data) => ({ statusCode: code, ...data }),
                }),
                json: (data) => data,
            };

            try {
                await UserController.anonymize(fakeReq, fakeRes);
                usuarioAnonimizado = true;
                pedido.historico.push({
                    status: 'concluido',
                    alteradoEm: new Date(),
                    alteradoPor: adminIdentificador,
                    observacao: 'Dados do titular foram anonimizados no banco de dados.',
                });
            } catch (anonErr) {
                logger.error('[AdminPedidosTitular] Erro ao anonimizar titular', {
                    err: anonErr,
                    usuarioId: pedido.usuarioId,
                });
            }
        }

        await pedido.save();

        await logAction(req, 'LGPD_PEDIDO_TITULAR_ATUALIZADO', 'PedidoTitular', {
            recursoId: pedido._id,
            protocolo: pedido.protocolo,
            statusAnterior: pedido.status,
            novoStatus,
            usuarioAnonimizado,
            descricao: `Pedido [${pedido.protocolo}] atualizado para '${novoStatus}' por ${adminIdentificador}.`,
        });

        return res.json({
            success: true,
            data: pedido,
            usuarioAnonimizado,
            message: 'Pedido atualizado com sucesso.',
        });
    } catch (err) {
        logger.error('[AdminPedidosTitular] Falha ao atualizar pedido', {
            err,
            action: 'adminPedidosTitular.atualizar',
        });
        return res.status(500).json({ success: false, error: 'Erro ao atualizar pedido.' });
    }
};
