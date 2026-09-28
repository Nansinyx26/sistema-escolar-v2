/**
 * SuperAdminController — gestão de escolas do administrador global (Issue #463).
 *
 * Tudo aqui é da REDE, não de uma escola: as rotas são montadas sem
 * `filtrarPorEscola` (routes/api.js) e por isso não há `req.escolaId`. O
 * escopo de cada operação é a escola do `:id`, e cada escrita vai para o
 * AuditLog com esse id em `escolaId` — é o que permite à própria escola ver,
 * depois, quem a bloqueou e quando.
 */
const mongoose = require('mongoose');
const Escola = require('../models/Escola');
const Usuario = require('../models/Usuario');
const Aluno = require('../models/Aluno');
const AuditLog = require('../models/AuditLog');
const escolaBloqueio = require('../services/escolaBloqueio');
const { logAction } = require('../utils/auditHelper');
const escapeRegex = require('../utils/escapeRegex');
const logger = require('../utils/logger');
const obs = require('../observability');
const { gerarCodigo } = require('../services/codigoEscolaService');

const LIMITE_PADRAO = 12;
const LIMITE_MAXIMO = 50;
const MOTIVO_MIN = 5;
const MOTIVO_MAX = 500;
const ACOES_DE_STATUS = [
    'ESCOLA_BLOQUEADA',
    'ESCOLA_DESBLOQUEADA',
    'ESCOLA_LIBERADA',
    'ESCOLA_RETIRADA_DE_USO',
];
const FILTROS_STATUS = ['ativa', 'bloqueada', 'aguardando'];

// Campos que a gestão mostra. `codigoSecreto` fica de fora (é `select: false`
// e dá direito a criar conta de professor — tem tela própria).
const CAMPOS_ESCOLA =
    'nome tipo bairro municipio ativo status motivoBloqueio bloqueadaEm bloqueadaPor desbloqueadaEm desbloqueadaPor criadoEm';

function idDoUsuario(req) {
    return String(req.user?.id || req.user?._id || '');
}

function idValido(id) {
    return mongoose.Types.ObjectId.isValid(String(id || ''));
}

function erroInterno(res, err, acao) {
    logger.error('[superadmin] falha na gestão de escolas', { err, action: acao });
    obs.captureException(err, { rota: acao });
    return res
        .status(500)
        .json({ success: false, error: 'Erro ao processar a gestão de escolas.' });
}

/** Contagem por escola numa coleção com `escolaId` string. */
async function contarPorEscola(Model, ids, filtroExtra = {}) {
    if (!ids.length) return new Map();
    const linhas = await Model.aggregate([
        { $match: { escolaId: { $in: ids }, ...filtroExtra } },
        { $group: { _id: '$escolaId', total: { $sum: 1 } } },
    ]);
    return new Map(linhas.map((l) => [String(l._id), l.total]));
}

/** Nome de quem bloqueou/desbloqueou — só o nome, nenhum outro dado da conta. */
async function nomesDosAutores(escolas) {
    const ids = new Set();
    for (const e of escolas) {
        if (e.bloqueadaPor) ids.add(String(e.bloqueadaPor));
        if (e.desbloqueadaPor) ids.add(String(e.desbloqueadaPor));
    }
    if (!ids.size) return new Map();
    const contas = await Usuario.find({ _id: { $in: [...ids] } })
        .select('nome')
        .lean();
    return new Map(contas.map((c) => [String(c._id), c.nome]));
}

function autor(id, nomes) {
    if (!id) return null;
    return { id: String(id), nome: nomes.get(String(id)) || null };
}

function formatarEscola(e, { usuarios, alunos, nomes }) {
    const status = e.status === 'bloqueada' ? 'bloqueada' : 'ativa';
    // Data da última mudança de status: a mais recente entre bloqueio e desbloqueio.
    const datas = [e.bloqueadaEm, e.desbloqueadaEm].filter(Boolean).map((d) => new Date(d));
    const ultimaAlteracao = datas.length ? new Date(Math.max(...datas)) : null;
    return {
        _id: String(e._id),
        nome: e.nome,
        tipo: e.tipo,
        bairro: e.bairro || '',
        municipio: e.municipio || '',
        // `ativo` = escola já liberada no sistema (cadeado da landing), não o bloqueio.
        disponivel: !!e.ativo,
        status,
        motivoBloqueio: status === 'bloqueada' ? e.motivoBloqueio || '' : null,
        bloqueadaEm: e.bloqueadaEm || null,
        bloqueadaPor: autor(e.bloqueadaPor, nomes),
        desbloqueadaEm: e.desbloqueadaEm || null,
        desbloqueadaPor: autor(e.desbloqueadaPor, nomes),
        ultimaAlteracaoStatusEm: ultimaAlteracao,
        usuarios: usuarios.get(String(e._id)) || 0,
        alunos: alunos.get(String(e._id)) || 0,
    };
}

/**
 * GET /api/superadmin/escolas?busca=&status=todas|ativa|bloqueada|aguardando&pagina=1&limite=12
 *
 * `aguardando` = escola ainda não liberada para uso (`ativo` diferente de true),
 * independentemente do bloqueio.
 */
exports.listar = async (req, res) => {
    try {
        const busca =
            typeof req.query.busca === 'string' ? req.query.busca.trim().slice(0, 80) : '';
        const status = FILTROS_STATUS.includes(req.query.status) ? req.query.status : 'todas';
        const pagina = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
        const limite = Math.min(
            LIMITE_MAXIMO,
            Math.max(1, Number.parseInt(req.query.limite, 10) || LIMITE_PADRAO)
        );

        const filtroBusca = {};
        if (busca) {
            const termo = new RegExp(escapeRegex(busca), 'i');
            filtroBusca.$or = [{ nome: termo }, { municipio: termo }, { bairro: termo }];
        }
        // `$ne: 'bloqueada'` e não `'ativa'`: escola gravada antes da migração
        // (sem o campo) não está bloqueada, e não pode sumir do filtro "Ativas".
        const filtrosPorStatus = {
            bloqueada: { status: 'bloqueada' },
            // Ativa = liberada para uso e não bloqueada; a que ainda espera
            // liberação fica só em "Aguardando" (Issue #533).
            ativa: { status: { $ne: 'bloqueada' }, ativo: true },
            aguardando: { ativo: { $ne: true } },
        };
        const filtroStatus = filtrosPorStatus[status] || {};
        const filtro = { ...filtroBusca, ...filtroStatus };

        const resultado = await obs.withSpan(
            'superadmin.escolas.listar',
            { 'escolas.filtro.status': status, 'escolas.pagina': pagina },
            async () => {
                const [total, ativas, bloqueadas, aguardando, totalBusca, escolas] =
                    await Promise.all([
                        Escola.countDocuments(filtroBusca),
                        Escola.countDocuments({ ...filtroBusca, ...filtrosPorStatus.ativa }),
                        Escola.countDocuments({ ...filtroBusca, status: 'bloqueada' }),
                        Escola.countDocuments({ ...filtroBusca, ativo: { $ne: true } }),
                        Escola.countDocuments(filtro),
                        Escola.find(filtro)
                            .select(CAMPOS_ESCOLA)
                            .sort({ nome: 1 })
                            .skip((pagina - 1) * limite)
                            .limit(limite)
                            .lean(),
                    ]);
                const ids = escolas.map((e) => String(e._id));
                const [usuarios, alunos, nomes] = await Promise.all([
                    contarPorEscola(Usuario, ids),
                    contarPorEscola(Aluno, ids, { ativo: { $ne: false } }),
                    nomesDosAutores(escolas),
                ]);
                return {
                    total,
                    ativas,
                    bloqueadas,
                    aguardando,
                    totalBusca,
                    escolas,
                    usuarios,
                    alunos,
                    nomes,
                };
            }
        );

        return res.json({
            success: true,
            data: resultado.escolas.map((e) => formatarEscola(e, resultado)),
            paginacao: {
                pagina,
                limite,
                total: resultado.totalBusca,
                totalPaginas: Math.max(1, Math.ceil(resultado.totalBusca / limite)),
            },
            // Contadores do filtro (respeitam a busca, não o status).
            resumo: {
                todas: resultado.total,
                ativas: resultado.ativas,
                bloqueadas: resultado.bloqueadas,
                aguardando: resultado.aguardando,
            },
        });
    } catch (err) {
        return erroInterno(res, err, 'superadmin.escolas.listar');
    }
};

/** GET /api/superadmin/escolas/:id */
exports.detalhar = async (req, res) => {
    try {
        if (!idValido(req.params.id)) {
            return res
                .status(400)
                .json({ success: false, error: 'Identificador de escola inválido.' });
        }
        const escola = await Escola.findById(req.params.id)
            .select(`${CAMPOS_ESCOLA} codigoInep dependenciaAdministrativa endereco`)
            .lean();
        if (!escola)
            return res.status(404).json({ success: false, error: 'Escola não encontrada.' });

        const id = String(escola._id);
        const [porPerfil, alunos, nomes, historico] = await Promise.all([
            Usuario.aggregate([
                { $match: { escolaId: id } },
                { $group: { _id: '$perfil', total: { $sum: 1 } } },
            ]),
            contarPorEscola(Aluno, [id], { ativo: { $ne: false } }),
            nomesDosAutores([escola]),
            AuditLog.find({ escolaId: id, recursoId: id, acao: { $in: ACOES_DE_STATUS } })
                .select('acao usuarioNome data detalhes.descricao detalhes.valorNovo')
                .sort({ data: -1 })
                .limit(20)
                .lean(),
        ]);

        const usuariosPorPerfil = Object.fromEntries(
            porPerfil.map((p) => [p._id || 'sem_perfil', p.total])
        );
        const totalUsuarios = porPerfil.reduce((soma, p) => soma + p.total, 0);

        return res.json({
            success: true,
            data: {
                ...formatarEscola(escola, {
                    usuarios: new Map([[id, totalUsuarios]]),
                    alunos,
                    nomes,
                }),
                endereco: escola.endereco || '',
                codigoInep: escola.codigoInep || null,
                dependenciaAdministrativa: escola.dependenciaAdministrativa || null,
                usuariosPorPerfil,
                historico: historico.map((h) => ({
                    acao: h.acao,
                    por: h.usuarioNome,
                    em: h.data,
                    motivo: h.detalhes?.valorNovo?.motivoBloqueio || null,
                })),
            },
        });
    } catch (err) {
        return erroInterno(res, err, 'superadmin.escolas.detalhar');
    }
};

/** PATCH /api/superadmin/escolas/:id/bloquear  { motivo } */
exports.bloquear = async (req, res) => {
    try {
        if (!idValido(req.params.id)) {
            return res
                .status(400)
                .json({ success: false, error: 'Identificador de escola inválido.' });
        }
        const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim() : '';
        if (motivo.length < MOTIVO_MIN || motivo.length > MOTIVO_MAX) {
            return res.status(400).json({
                success: false,
                codigo: 'MOTIVO_OBRIGATORIO',
                error: `Informe o motivo do bloqueio (entre ${MOTIVO_MIN} e ${MOTIVO_MAX} caracteres).`,
            });
        }

        const autorId = idDoUsuario(req);
        const agora = new Date();

        const { escola, desconectados } = await obs.withSpan(
            'superadmin.escolas.bloquear',
            { 'escola.id': req.params.id },
            async (span) => {
                // Condicional no próprio update: dois cliques simultâneos não
                // registram dois bloqueios, e bloquear o já bloqueado é 409.
                const atualizada = await Escola.findOneAndUpdate(
                    { _id: req.params.id, status: { $ne: 'bloqueada' } },
                    {
                        $set: {
                            status: 'bloqueada',
                            motivoBloqueio: motivo,
                            bloqueadaEm: agora,
                            bloqueadaPor: autorId,
                        },
                    },
                    { new: true, runValidators: true }
                )
                    .select(CAMPOS_ESCOLA)
                    .lean();
                if (!atualizada) return { escola: null, desconectados: 0 };

                // Vale já nesta instância; nas outras, no TTL do cache.
                escolaBloqueio.invalidarCache();
                const n = await escolaBloqueio.desconectarEscola(global.io, atualizada._id);
                span?.setAttribute?.('escola.sockets_desconectados', n);
                return { escola: atualizada, desconectados: n };
            }
        );

        if (!escola) {
            const existe = await Escola.exists({ _id: req.params.id });
            return existe
                ? res.status(409).json({ success: false, error: 'Esta escola já está bloqueada.' })
                : res.status(404).json({ success: false, error: 'Escola não encontrada.' });
        }

        await logAction(req, 'ESCOLA_BLOQUEADA', 'Escola', {
            recursoId: String(escola._id),
            escolaId: String(escola._id),
            valorAnterior: { status: 'ativa' },
            valorNovo: { status: 'bloqueada', motivoBloqueio: motivo },
            descricao: `Escola "${escola.nome}" bloqueada pelo super admin. ${desconectados} conexão(ões) em tempo real encerrada(s).`,
        });
        logger.info('[superadmin] escola bloqueada', {
            escolaId: String(escola._id),
            socketsDesconectados: desconectados,
            action: 'superadmin.escolas.bloquear',
        });

        const nomes = await nomesDosAutores([escola]);
        return res.json({
            success: true,
            message: `Escola "${escola.nome}" bloqueada.`,
            data: formatarEscola(escola, {
                usuarios: await contarPorEscola(Usuario, [String(escola._id)]),
                alunos: await contarPorEscola(Aluno, [String(escola._id)], {
                    ativo: { $ne: false },
                }),
                nomes,
            }),
        });
    } catch (err) {
        return erroInterno(res, err, 'superadmin.escolas.bloquear');
    }
};

/** PATCH /api/superadmin/escolas/:id/desbloquear */
exports.desbloquear = async (req, res) => {
    try {
        if (!idValido(req.params.id)) {
            return res
                .status(400)
                .json({ success: false, error: 'Identificador de escola inválido.' });
        }
        const autorId = idDoUsuario(req);
        const anterior = await Escola.findById(req.params.id)
            .select('status motivoBloqueio')
            .lean();
        if (!anterior)
            return res.status(404).json({ success: false, error: 'Escola não encontrada.' });

        const escola = await obs.withSpan(
            'superadmin.escolas.desbloquear',
            { 'escola.id': req.params.id },
            async () => {
                // `motivoBloqueio` sai do documento (fica no AuditLog): uma escola
                // ativa com motivo de bloqueio na tela confunde quem a abre depois.
                const atualizada = await Escola.findOneAndUpdate(
                    { _id: req.params.id, status: 'bloqueada' },
                    {
                        $set: {
                            status: 'ativa',
                            desbloqueadaEm: new Date(),
                            desbloqueadaPor: autorId,
                        },
                        $unset: { motivoBloqueio: '' },
                    },
                    { new: true }
                )
                    .select(CAMPOS_ESCOLA)
                    .lean();
                if (atualizada) escolaBloqueio.invalidarCache();
                return atualizada;
            }
        );

        if (!escola) {
            return res
                .status(409)
                .json({ success: false, error: 'Esta escola não está bloqueada.' });
        }

        await logAction(req, 'ESCOLA_DESBLOQUEADA', 'Escola', {
            recursoId: String(escola._id),
            escolaId: String(escola._id),
            valorAnterior: { status: 'bloqueada', motivoBloqueio: anterior.motivoBloqueio || null },
            valorNovo: { status: 'ativa' },
            descricao: `Escola "${escola.nome}" desbloqueada pelo super admin.`,
        });
        logger.info('[superadmin] escola desbloqueada', {
            escolaId: String(escola._id),
            action: 'superadmin.escolas.desbloquear',
        });

        const nomes = await nomesDosAutores([escola]);
        return res.json({
            success: true,
            message: `Escola "${escola.nome}" desbloqueada. O acesso já está liberado.`,
            data: formatarEscola(escola, {
                usuarios: await contarPorEscola(Usuario, [String(escola._id)]),
                alunos: await contarPorEscola(Aluno, [String(escola._id)], {
                    ativo: { $ne: false },
                }),
                nomes,
            }),
        });
    } catch (err) {
        return erroInterno(res, err, 'superadmin.escolas.desbloquear');
    }
};

/**
 * PATCH /api/superadmin/escolas/:id/disponibilidade  { disponivel: boolean }
 *
 * Libera (ou retira) a escola para uso (Issue #533). É o `ativo` do modelo: a
 * escola nasce fora do sistema — cadeado na landing, código de professor
 * recusado — até o admin liberá-la. Não confundir com o bloqueio, que corta o
 * acesso de quem já usa.
 *
 * Liberar uma escola que ainda não tem código de cadastro de professor gera o
 * código, senão a escola liberada continuaria sem como receber a equipe.
 * Retirar do uso não desconecta ninguém: para cortar o acesso existe o bloqueio.
 */
exports.disponibilidade = async (req, res) => {
    try {
        if (!idValido(req.params.id)) {
            return res
                .status(400)
                .json({ success: false, error: 'Identificador de escola inválido.' });
        }
        const disponivel = req.body?.disponivel;
        if (typeof disponivel !== 'boolean') {
            return res
                .status(400)
                .json({ success: false, error: 'Informe disponivel: true ou false.' });
        }

        const escola = await obs.withSpan(
            'superadmin.escolas.disponibilidade',
            { 'escola.id': req.params.id, 'escola.disponivel': disponivel },
            async () => {
                // Condicional no update: repetir a mesma decisão é 409, não um
                // segundo registro na auditoria.
                const filtro = disponivel
                    ? { _id: req.params.id, ativo: { $ne: true } }
                    : { _id: req.params.id, ativo: true };
                const atualizada = await Escola.findOneAndUpdate(
                    filtro,
                    { $set: { ativo: disponivel } },
                    { new: true }
                ).select(`${CAMPOS_ESCOLA} +codigoSecreto`);
                if (atualizada && disponivel && !atualizada.codigoSecreto) {
                    atualizada.codigoSecreto = gerarCodigo();
                    await atualizada.save();
                }
                return atualizada ? atualizada.toObject() : null;
            }
        );

        if (!escola) {
            const existe = await Escola.exists({ _id: req.params.id });
            if (!existe) {
                return res.status(404).json({ success: false, error: 'Escola não encontrada.' });
            }
            return res.status(409).json({
                success: false,
                error: disponivel
                    ? 'Esta escola já está liberada para uso.'
                    : 'Esta escola ainda não foi liberada para uso.',
            });
        }

        await logAction(req, disponivel ? 'ESCOLA_LIBERADA' : 'ESCOLA_RETIRADA_DE_USO', 'Escola', {
            recursoId: String(escola._id),
            escolaId: String(escola._id),
            valorAnterior: { ativo: !disponivel },
            valorNovo: { ativo: disponivel },
            descricao: disponivel
                ? `Escola "${escola.nome}" liberada para uso pelo admin.`
                : `Escola "${escola.nome}" retirada de uso pelo admin.`,
        });
        logger.info('[superadmin] disponibilidade da escola alterada', {
            escolaId: String(escola._id),
            disponivel,
            action: 'superadmin.escolas.disponibilidade',
        });

        const nomes = await nomesDosAutores([escola]);
        return res.json({
            success: true,
            message: disponivel
                ? `Escola "${escola.nome}" liberada. A equipe já pode se cadastrar.`
                : `Escola "${escola.nome}" retirada de uso.`,
            data: formatarEscola(escola, {
                usuarios: await contarPorEscola(Usuario, [String(escola._id)]),
                alunos: await contarPorEscola(Aluno, [String(escola._id)], {
                    ativo: { $ne: false },
                }),
                nomes,
            }),
        });
    } catch (err) {
        return erroInterno(res, err, 'superadmin.escolas.disponibilidade');
    }
};

/**
 * POST /api/superadmin/escolas/:id/acessar
 *
 * Coloca a escola na sessão do super admin — o mesmo `escolaAtivaId` que a troca
 * de escola usa, então todas as telas existentes passam a mostrar os dados dela
 * sem mudança nenhuma. Diferente de `/api/escolas/trocar`, aceita escola
 * bloqueada ou ainda não liberada: é justamente para inspecioná-las.
 */
exports.acessar = async (req, res) => {
    try {
        if (!idValido(req.params.id)) {
            return res
                .status(400)
                .json({ success: false, error: 'Identificador de escola inválido.' });
        }
        const escola = await Escola.findById(req.params.id).select('nome status').lean();
        if (!escola)
            return res.status(404).json({ success: false, error: 'Escola não encontrada.' });
        if (!req.session) {
            return res
                .status(503)
                .json({ success: false, error: 'Sessão indisponível. Faça login novamente.' });
        }

        const contexto = {
            escolaId: String(escola._id),
            nome: escola.nome,
            status: escola.status === 'bloqueada' ? 'bloqueada' : 'ativa',
            desde: new Date().toISOString(),
        };
        req.session.escolaAtivaId = contexto.escolaId;
        req.session.usuarioId = idDoUsuario(req);
        req.session.superAdminContexto = contexto;

        await logAction(req, 'SUPERADMIN_ACESSOU_ESCOLA', 'Escola', {
            recursoId: contexto.escolaId,
            escolaId: contexto.escolaId,
            descricao: `Super admin entrou no contexto da escola "${escola.nome}" (${contexto.status}).`,
        });

        return res.json({ success: true, data: contexto, redirect_to: '/html/dashboard.html' });
    } catch (err) {
        return erroInterno(res, err, 'superadmin.escolas.acessar');
    }
};

/** GET /api/superadmin/contexto — alimenta a faixa "visualizando como Super Admin". */
exports.contexto = (req, res) => {
    const contexto = req.session?.superAdminContexto || null;
    // A sessão pode ter trocado de escola por outro caminho: a faixa só vale
    // enquanto a escola ativa for a que o super admin escolheu aqui.
    const valido = contexto && String(req.session.escolaAtivaId || '') === contexto.escolaId;
    return res.json({ success: true, data: valido ? contexto : null });
};

/** DELETE /api/superadmin/contexto — sai do contexto da escola. */
exports.sairContexto = async (req, res) => {
    const contexto = req.session?.superAdminContexto || null;
    if (req.session) {
        req.session.superAdminContexto = undefined;
        if (contexto && String(req.session.escolaAtivaId || '') === contexto.escolaId) {
            req.session.escolaAtivaId = undefined;
        }
    }
    if (contexto) {
        await logAction(req, 'SUPERADMIN_SAIU_ESCOLA', 'Escola', {
            recursoId: contexto.escolaId,
            escolaId: contexto.escolaId,
            descricao: `Super admin saiu do contexto da escola "${contexto.nome}".`,
        });
    }
    return res.json({ success: true, data: null });
};
