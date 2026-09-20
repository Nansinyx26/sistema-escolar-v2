/**
 * VinculoResponsavelController — a secretaria decide quem entra na ficha
 * (Issue #398).
 *
 * Rotas em /api/secretaria/vinculos, com o mesmo `authorize` do resto do
 * módulo da secretaria (secretaria, direção, admin) e com a escola resolvida
 * pelo `filtrarPorEscola` do router.
 */
const Aluno = require('../models/Aluno');
const SolicitacaoVinculo = require('../models/SolicitacaoVinculo');
const vinculos = require('../services/vinculosResponsavel');
const assertAcessoAoAluno = require('../middleware/assertAcessoAoAluno');
const { logAction } = require('../utils/auditHelper');
const logger = require('../utils/logger');

const STATUS_VALIDOS = ['pendente', 'aprovada', 'recusada'];

function resumo(p, aluno) {
    return {
        id: String(p._id),
        alunoId: String(p.alunoId),
        alunoNome: aluno ? [aluno.nome, aluno.sobrenome].filter(Boolean).join(' ') : undefined,
        turma: aluno?.turma || aluno?.turmaId,
        email: p.email,
        nome: p.nome,
        parentesco: p.parentesco,
        solicitanteEmail: p.solicitanteEmail,
        status: p.status,
        criadoEm: p.createdAt,
        decididoEm: p.decididoEm,
        motivoRecusa: p.motivoRecusa,
    };
}

// GET /api/secretaria/vinculos?status=pendente
exports.listar = async (req, res) => {
    try {
        const status = STATUS_VALIDOS.includes(String(req.query.status))
            ? String(req.query.status)
            : 'pendente';
        const filtro = { status };
        if (req.escolaId) filtro.escolaId = String(req.escolaId);

        const pedidos = await SolicitacaoVinculo.find(filtro)
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();
        const alunos = await Aluno.find({ _id: { $in: pedidos.map((p) => p.alunoId) } })
            .select('nome sobrenome turma turmaId escolaId')
            .lean();
        const porId = new Map(alunos.map((a) => [String(a._id), a]));

        return res.json({
            success: true,
            data: pedidos.map((p) => resumo(p, porId.get(String(p.alunoId)))),
        });
    } catch (error) {
        logger.error('[Vínculo] Falha ao listar pedidos', { err: error, action: 'vinculo.listar' });
        return res.status(500).json({ success: false, error: 'Erro ao listar pedidos.' });
    }
};

/** Carrega o pedido pendente e confere o acesso ao aluno de quem decide. */
async function pedidoDecidivel(req, res) {
    const pedido = await SolicitacaoVinculo.findById(req.params.id).lean();
    if (!pedido || pedido.status !== 'pendente') {
        res.status(404).json({ success: false, error: 'Pedido não encontrado ou já decidido.' });
        return null;
    }
    const acesso = await assertAcessoAoAluno(req, String(pedido.alunoId));
    if (!acesso.ok) {
        res.status(acesso.status).json({ success: false, error: acesso.error });
        return null;
    }
    return { pedido, aluno: acesso.aluno };
}

// POST /api/secretaria/vinculos/:id/aprovar
exports.aprovar = async (req, res) => {
    try {
        const alvo = await pedidoDecidivel(req, res);
        if (!alvo) return;
        const { pedido, aluno } = alvo;

        const antes = [...vinculos.emailsDaFicha(aluno)];
        await vinculos.aplicarNaFicha(aluno, pedido);
        await SolicitacaoVinculo.updateOne(
            { _id: pedido._id, status: 'pendente' },
            {
                $set: {
                    status: 'aprovada',
                    decididoEm: new Date(),
                    decididoPor: String(req.user?.id || req.user?._id || ''),
                },
            }
        );

        // Log com e-mail MASCARADO: prova quem passou a ter acesso, sem gravar
        // o endereço inteiro na trilha.
        await logAction(req, 'VINCULO_RESPONSAVEL_APROVADO', 'Alunos', {
            recursoId: String(aluno._id),
            valorAnterior: { responsaveis: antes.length },
            valorNovo: {
                responsaveis: antes.length + 1,
                incluido: vinculos.mascarar(pedido.email),
            },
            descricao: `Inclusão de responsável aprovada no aluno ${aluno._id} (pedido ${pedido._id}).`,
        });

        // Quem já responde pela criança precisa saber quem passou a ver os dados.
        const avisar = vinculos.destinatariosDoAviso(aluno, pedido.email);
        if (avisar.length && process.env.NODE_ENV !== 'test') {
            const { enviarEmail } = require('../services/EnvioEmail');
            const nomeAluno = [aluno.nome, aluno.sobrenome].filter(Boolean).join(' ');
            await Promise.all(
                avisar.map((destino) =>
                    enviarEmail(
                        destino,
                        'Novo responsável com acesso — Sistema Escolar',
                        `<p>A escola aprovou a inclusão de <strong>${pedido.email}</strong> como responsável de <strong>${nomeAluno}</strong>.</p>
                         <p>Se você não reconhece esta inclusão, procure a secretaria da escola.</p>`
                    ).catch(() => null)
                )
            );
        }

        return res.json({ success: true, data: { id: String(pedido._id), status: 'aprovada' } });
    } catch (error) {
        logger.error('[Vínculo] Falha ao aprovar pedido', {
            err: error,
            action: 'vinculo.aprovar',
        });
        return res.status(500).json({ success: false, error: 'Erro ao aprovar o pedido.' });
    }
};

// POST /api/secretaria/vinculos/:id/recusar
exports.recusar = async (req, res) => {
    try {
        const alvo = await pedidoDecidivel(req, res);
        if (!alvo) return;
        const { pedido, aluno } = alvo;

        await SolicitacaoVinculo.updateOne(
            { _id: pedido._id, status: 'pendente' },
            {
                $set: {
                    status: 'recusada',
                    decididoEm: new Date(),
                    decididoPor: String(req.user?.id || req.user?._id || ''),
                    motivoRecusa: req.body?.motivo ? String(req.body.motivo).slice(0, 300) : null,
                },
            }
        );

        await logAction(req, 'VINCULO_RESPONSAVEL_RECUSADO', 'Alunos', {
            recursoId: String(aluno._id),
            valorNovo: { recusado: vinculos.mascarar(pedido.email) },
            descricao: `Inclusão de responsável recusada no aluno ${aluno._id} (pedido ${pedido._id}).`,
        });

        return res.json({ success: true, data: { id: String(pedido._id), status: 'recusada' } });
    } catch (error) {
        logger.error('[Vínculo] Falha ao recusar pedido', {
            err: error,
            action: 'vinculo.recusar',
        });
        return res.status(500).json({ success: false, error: 'Erro ao recusar o pedido.' });
    }
};
