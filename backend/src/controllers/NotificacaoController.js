const Notificacao = require('../models/Notificacao');
const Professor = require('../models/Professor');
const Aluno = require('../models/Aluno');
const { escolaMatch } = require('../middleware/filtrarPorEscola');
const { extrairPaginacao } = require('../middleware/pagination');
const escapeRegex = require('../utils/escapeRegex');
const { filtroPorId, filtroDoPerfil, paraTurmas } = require('../utils/visibilidadeNotificacao');

/** Regex ancorada e escapada para casar e-mail exato. */
function emailRegexExato(email) {
    return new RegExp(`^${escapeRegex(String(email || ''))}$`, 'i');
}

/** Turmas em que o professor dá aula (sala principal, adicionais e lista). */
async function turmasDoProfessor(userId) {
    const professor = await Professor.findOne({ idUsuario: userId }).lean();
    if (!professor) return [];
    const turmas = [];
    if (professor.salaPrincipal) turmas.push(professor.salaPrincipal);
    if (Array.isArray(professor.salasAdicionais)) turmas.push(...professor.salasAdicionais);
    if (Array.isArray(professor.turmas)) turmas.push(...professor.turmas);
    return [...new Set(turmas.filter(Boolean))];
}

/** Destinatários que alcançam os filhos do responsável: turmas e ids dos alunos. */
async function destinatariosDaFamilia(email) {
    if (!email) return [];
    const alunos = await Aluno.find({ responsavel: emailRegexExato(email) }).lean();
    const lista = [];
    for (const a of alunos) {
        lista.push(...paraTurmas([a.turma || a.turmaId]));
        lista.push(String(a._id));
        if (a.id) lista.push(String(a.id));
    }
    return lista;
}

/**
 * Filtro final do sino para a sessão: visibilidade por perfil × escola ativa.
 * O mesmo filtro serve à leitura e às escritas.
 */
async function filtroDaSessao(req) {
    const perfil = req.user?.perfil || '';
    const userId = String(req.user?._id || req.user?.id || '');
    const ctx = { perfil, userId };
    if (perfil === 'professor') ctx.turmas = await turmasDoProfessor(userId);
    if (perfil === 'responsavel') ctx.familia = await destinatariosDaFamilia(req.user?.email);

    const filtro = filtroDoPerfil(ctx);
    // Multi-escola: filtro tolerante (escola ativa + legados sem escolaId).
    const escolaFilter = escolaMatch(req.escolaId);
    const temEscola = escolaFilter && Object.keys(escolaFilter).length > 0;
    return temEscola ? { $and: [filtro, escolaFilter] } : filtro;
}

module.exports = {
    async getAll(req, res) {
        try {
            const userId = String(req.user?._id || req.user?.id || '');
            const filtroFinal = await filtroDaSessao(req);

            const paginacao = extrairPaginacao(req.query);
            let notificacoes;
            let totalDocs = 0;

            if (paginacao) {
                [notificacoes, totalDocs] = await Promise.all([
                    Notificacao.find(filtroFinal)
                        .sort({ dataCriacao: -1 })
                        .skip(paginacao.skip)
                        .limit(paginacao.limit)
                        .lean(),
                    Notificacao.countDocuments(filtroFinal),
                ]);
            } else {
                notificacoes = await Notificacao.find(filtroFinal).sort({ dataCriacao: -1 }).lean();
            }

            // Adiciona campo lidoPorMim para que o frontend saiba quais já foram lidas pelo usuário atual
            const formatted = notificacoes.map((n) => ({
                ...n,
                id: n.id || String(n._id),
                lidoPorMim: Array.isArray(n.lido) && userId ? n.lido.includes(userId) : false,
            }));

            if (paginacao) {
                return res.json(paginacao.formatarResposta(formatted, totalDocs));
            }

            res.json({ success: true, data: formatted });
        } catch (error) {
            console.error('Erro em NotificacaoController.getAll:', error);
            res.status(500).json({
                success: false,
                error: 'Erro ao buscar notificações',
                details: error.message,
            });
        }
    },

    async create(req, res) {
        try {
            const userPerfil = req.user?.perfil || '';
            const data = { ...req.body };
            // `id` é gerado pelo model; aceitar do corpo abria colisão no índice único.
            delete data.id;

            // Regra 6: Professores NÃO podem enviar notificações diretamente para responsáveis.
            if (
                data.paraResponsavel === true &&
                userPerfil !== 'diretor' &&
                userPerfil !== 'admin'
            ) {
                return res.status(403).json({
                    success: false,
                    error: 'Acesso negado. Apenas diretores e administradores podem enviar avisos aos responsáveis/pais.',
                });
            }

            // Atribui o nome do remetente (diretor/admin que enviou)
            data.criadoPor = req.user?.nome || req.user?.email || 'Direção';

            // Multi-escola: nova notificação pertence à escola ativa da sessão
            if (req.escolaId) data.escolaId = req.escolaId;

            const notificacao = await Notificacao.create(data);
            res.status(201).json({ success: true, data: notificacao });
        } catch (error) {
            console.error('Erro em NotificacaoController.create:', error);
            res.status(400).json({
                success: false,
                error: 'Erro ao criar notificação',
                details: error.message,
            });
        }
    },

    async delete(req, res) {
        try {
            const { id } = req.params;

            // Multi-escola: só apaga notificação da escola ativa (admin vê tudo)
            const filtro = filtroPorId(id);
            const escolaFilter = req.user?.perfil === 'admin' ? {} : escolaMatch(req.escolaId);
            const filtroFinal = Object.keys(escolaFilter).length
                ? { $and: [filtro, escolaFilter] }
                : filtro;

            const deleted = await Notificacao.findOneAndDelete(filtroFinal);

            if (!deleted) {
                return res
                    .status(404)
                    .json({ success: false, error: 'Notificação não encontrada' });
            }

            const { logAction } = require('../utils/auditHelper');
            await logAction(req, 'DELETE_NOTIFICATION', 'Notificacoes', {
                recursoId: deleted._id,
                descricao: `Notificação "${deleted.titulo || deleted.id}" removida.`,
            });

            res.json({ success: true, message: 'Notificação removida com sucesso' });
        } catch (error) {
            console.error('Erro em NotificacaoController.delete:', error);
            res.status(500).json({
                success: false,
                error: 'Erro ao deletar notificação',
                details: error.message,
            });
        }
    },

    async marcarComoLida(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user?._id || req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Não autenticado' });
            }
            // Só o que a pessoa enxerga: marcar como lida é escrita, e o escopo
            // precisa ser o mesmo da leitura.
            const notificacao = await Notificacao.findOne({
                $and: [filtroPorId(id), await filtroDaSessao(req)],
            });
            if (!notificacao) {
                return res
                    .status(404)
                    .json({ success: false, error: 'Notificação não encontrada.' });
            }
            if (!notificacao.lido) {
                notificacao.lido = [];
            }
            if (!notificacao.lido.includes(String(userId))) {
                notificacao.lido.push(String(userId));
                await notificacao.save();
            }
            res.json({ success: true, message: 'Notificação marcada como lida.' });
        } catch (error) {
            console.error('Erro em NotificacaoController.marcarComoLida:', error);
            res.status(500).json({ success: false, error: 'Erro ao marcar como lida' });
        }
    },

    async marcarTodasComoLidas(req, res) {
        try {
            const userId = req.user?._id || req.user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, error: 'Não autenticado' });
            }
            const baseFilter = await filtroDaSessao(req);
            await Notificacao.updateMany(
                { ...baseFilter, lido: { $ne: String(userId) } },
                { $push: { lido: String(userId) } }
            );
            res.json({ success: true, message: 'Todas as notificações marcadas como lidas.' });
        } catch (error) {
            console.error('Erro em NotificacaoController.marcarTodasComoLidas:', error);
            res.status(500).json({ success: false, error: 'Erro ao marcar todas como lidas' });
        }
    },
};
