/**
 * ModeracaoController — a fila de revisão humana e os canais do usuário.
 *
 * DUAS COISAS QUE ESTE ARQUIVO NUNCA PODE DEIXAR ESCAPAR
 * ======================================================
 * 1. **Escola.** Toda consulta herda `req.escolaId` (P4). Coordenação da escola
 *    A não pode ver ocorrência da escola B, e o `admin` de plataforma só entra
 *    depois de dizer de qual escola está falando — quem cobra isso é o
 *    `authorize.estrito` na rota, e o `escopo()` aqui é o que aplica.
 *
 * 2. **Conteúdo.** A ocorrência não guarda o texto ofensivo (§6.1) e este
 *    controller não vai buscá-lo para "enriquecer" a resposta. O painel mostra
 *    metadados: quem, quando, qual severidade, qual camada. Ver o conteúdo
 *    original é abrir a mensagem — e isso é acesso a dado pessoal de terceiro,
 *    que passa por `MODERACAO_VISUALIZAR` no AuditLog.
 */

const ModeracaoOcorrencia = require('../models/ModeracaoOcorrencia');
const Usuario = require('../models/Usuario');
const ModeracaoService = require('../services/moderacao/ModeracaoService');
const { logAction } = require('../utils/auditHelper');
const logger = require('../utils/logger');

// A identidade e a vigência do Termo moram em utils/termoAudioImagem.js: além
// deste controller, o middleware que EXIGE o aceite no upload precisa da mesma
// regra (Issue #118). Duas cópias divergiriam no dia em que a versão mudasse —
// que é exatamente o dia em que a divergência custa caro.
const { TERMO_ID, TERMO_VERSAO, aceiteVigente } = require('../utils/termoAudioImagem');

/** Perfis que enxergam ocorrência CRÍTICA (§7.1) — coordenação fica de fora. */
const PERFIS_CASOS_CRITICOS = new Set(['admin', 'diretor']);

/**
 * O filtro de tenant de toda consulta.
 *
 * `filtrarPorEscola` já resolveu `req.escolaId`; para `admin` o
 * `authorize.estrito` garantiu que veio `?escolaId=`. Quando o sistema ainda
 * não tem escola nenhuma cadastrada (pré-migração e boa parte dos testes),
 * `escolaId` é `undefined` e o filtro sai vazio — mesmo comportamento das
 * demais áreas do sistema, e não uma exceção inventada aqui.
 */
function escopo(req) {
    const escolaId = req.escolaId || req.query?.escolaId || req.body?.escolaId;
    return escolaId ? { escolaId: String(escolaId) } : {};
}

function perfilDe(req) {
    return String(req.user?.perfil || '').toLowerCase();
}

function idDe(req) {
    return String(req.user?.id || req.user?._id || '');
}

/**
 * Projeção segura para o painel — o que pode sair daqui sem expor conteúdo.
 * `termosDetectados` entra porque o dicionário já é público no repositório
 * (§6.2); `conteudoHash` fica de fora porque não serve a quem revisa e só dá
 * superfície para correlação.
 */
function paraPainel(doc) {
    return {
        id: String(doc._id),
        escolaId: doc.escolaId,
        mensagemId: doc.mensagemId,
        gridfsId: doc.gridfsId,
        tipoConteudo: doc.tipoConteudo,
        remetenteId: doc.remetenteId,
        remetentePerfil: doc.remetentePerfil,
        destinatarioId: doc.destinatarioId,
        camada: doc.camada,
        severidade: doc.severidade,
        categorias: doc.categorias || {},
        termosDetectados: doc.termosDetectados || [],
        decisaoAutomatica: doc.decisaoAutomatica,
        statusAtual: doc.statusAtual,
        revisao: doc.revisao || null,
        contestacao: doc.contestacao || null,
        criadoEm: doc.criadoEm,
    };
}

/**
 * GET /api/moderacao/fila
 * O que está esperando decisão humana nesta escola.
 */
exports.listarFila = async (req, res) => {
    try {
        const filtro = { ...escopo(req), statusAtual: 'pendente' };

        // Caso CRÍTICO não aparece na fila comum da coordenação (§7.3): vai
        // direto à direção, com notificação ativa. Filtrar aqui, e não só
        // esconder na tela, é o que impede a coordenação de alcançá-lo pela API.
        if (!PERFIS_CASOS_CRITICOS.has(perfilDe(req))) {
            filtro.severidade = { $ne: 'critica' };
        }

        const limite = Math.min(Number.parseInt(req.query.limite, 10) || 50, 200);

        const ocorrencias = await ModeracaoOcorrencia.find(filtro)
            .sort({ severidade: -1, criadoEm: 1 })
            .limit(limite)
            .lean();

        res.json({
            success: true,
            data: ocorrencias.map(paraPainel),
            total: ocorrencias.length,
        });
    } catch (erro) {
        logger.error('[Moderacao] Falha ao listar fila', { erro: erro.message });
        res.status(500).json({
            success: false,
            error: 'Não foi possível carregar a fila de moderação.',
        });
    }
};

/**
 * GET /api/moderacao/ocorrencia/:id
 *
 * Abrir uma ocorrência É acesso a dado pessoal de terceiro por um funcionário.
 * Grava `MODERACAO_VISUALIZAR` ANTES de responder — se gravasse depois, uma
 * falha na resposta apagaria o rastro de um acesso que já aconteceu.
 */
exports.obterOcorrencia = async (req, res) => {
    try {
        const ocorrencia = await ModeracaoOcorrencia.findOne({
            _id: req.params.id,
            ...escopo(req),
        }).lean();

        if (!ocorrencia) {
            return res.status(404).json({ success: false, error: 'Ocorrência não encontrada.' });
        }

        if (ocorrencia.severidade === 'critica' && !PERFIS_CASOS_CRITICOS.has(perfilDe(req))) {
            return res.status(403).json({
                success: false,
                error: 'Esta ocorrência é tratada diretamente pela direção.',
            });
        }

        await logAction(req, 'MODERACAO_VISUALIZAR', 'moderacao_ocorrencias', {
            recursoId: String(ocorrencia._id),
            descricao: `Abriu ocorrência ${ocorrencia.severidade} (${ocorrencia.camada}).`,
        });

        res.json({ success: true, data: paraPainel(ocorrencia) });
    } catch (erro) {
        logger.error('[Moderacao] Falha ao obter ocorrência', { erro: erro.message });
        res.status(500).json({ success: false, error: 'Não foi possível abrir a ocorrência.' });
    }
};

/**
 * POST /api/moderacao/ocorrencia/:id/decidir
 * Body: { decisao: 'aprovar' | 'manter_bloqueio', justificativa }
 */
exports.decidir = async (req, res) => {
    try {
        const { decisao, justificativa } = req.body || {};

        if (decisao !== 'aprovar' && decisao !== 'manter_bloqueio') {
            return res.status(400).json({
                success: false,
                error: "Decisão inválida. Use 'aprovar' ou 'manter_bloqueio'.",
            });
        }

        // Justificativa obrigatória: é ela que sustenta a resposta à contestação
        // da cláusula 9 do Termo. Decisão sem motivo registrado vira "porque
        // sim" na hora em que o responsável perguntar.
        if (!justificativa || String(justificativa).trim().length < 3) {
            return res.status(400).json({
                success: false,
                error: 'Informe a justificativa da decisão.',
            });
        }

        const ocorrencia = await ModeracaoOcorrencia.findOne({
            _id: req.params.id,
            ...escopo(req),
        });

        if (!ocorrencia) {
            return res.status(404).json({ success: false, error: 'Ocorrência não encontrada.' });
        }

        if (ocorrencia.severidade === 'critica' && !PERFIS_CASOS_CRITICOS.has(perfilDe(req))) {
            return res.status(403).json({
                success: false,
                error: 'Esta ocorrência é tratada diretamente pela direção.',
            });
        }

        if (ocorrencia.statusAtual !== 'pendente') {
            return res.status(409).json({
                success: false,
                codigo: 'JA_DECIDIDA',
                error: 'Esta ocorrência já foi decidida.',
            });
        }

        ocorrencia.statusAtual = decisao === 'aprovar' ? 'revertida' : 'mantida';
        ocorrencia.revisao = {
            moderadorId: idDe(req),
            moderadorPerfil: perfilDe(req),
            decididoEm: new Date(),
            decisao,
            justificativa: String(justificativa).trim(),
        };
        await ocorrencia.save();

        await logAction(req, 'MODERACAO_DECIDIR', 'moderacao_ocorrencias', {
            recursoId: String(ocorrencia._id),
            valorNovo: decisao,
            descricao: `Decidiu ${decisao} na ocorrência ${ocorrencia.severidade}.`,
        });

        res.json({ success: true, data: paraPainel(ocorrencia.toObject()) });
    } catch (erro) {
        logger.error('[Moderacao] Falha ao decidir ocorrência', { erro: erro.message });
        res.status(500).json({ success: false, error: 'Não foi possível registrar a decisão.' });
    }
};

/**
 * GET /api/moderacao/metricas
 * Números agregados — §9.2. Nenhum conteúdo, nenhum nome.
 */
exports.metricas = async (req, res) => {
    try {
        const base = escopo(req);

        const [porSeveridade, porStatus, pendentes, total] = await Promise.all([
            ModeracaoOcorrencia.aggregate([
                { $match: base },
                { $group: { _id: '$severidade', total: { $sum: 1 } } },
            ]),
            ModeracaoOcorrencia.aggregate([
                { $match: base },
                { $group: { _id: '$statusAtual', total: { $sum: 1 } } },
            ]),
            ModeracaoOcorrencia.countDocuments({ ...base, statusAtual: 'pendente' }),
            ModeracaoOcorrencia.countDocuments(base),
        ]);

        const decididas = porStatus
            .filter((linha) => linha._id === 'mantida' || linha._id === 'revertida')
            .reduce((soma, linha) => soma + linha.total, 0);
        const revertidas = porStatus.find((linha) => linha._id === 'revertida')?.total || 0;

        // > 15% de reversão significa limiar mal calibrado (§9.2). O número sai
        // pronto aqui para o painel não ter que saber dessa regra.
        const taxaReversao = decididas > 0 ? revertidas / decididas : 0;

        res.json({
            success: true,
            data: {
                total,
                pendentes,
                porSeveridade: Object.fromEntries(porSeveridade.map((l) => [l._id, l.total])),
                porStatus: Object.fromEntries(porStatus.map((l) => [l._id, l.total])),
                taxaReversao: Number(taxaReversao.toFixed(4)),
                limiarMalCalibrado: taxaReversao > 0.15,
                // Alerta operacional de §7.4.
                filaAcumulada: pendentes > 20,
            },
        });
    } catch (erro) {
        logger.error('[Moderacao] Falha ao calcular métricas', { erro: erro.message });
        res.status(500).json({ success: false, error: 'Não foi possível calcular as métricas.' });
    }
};

/**
 * POST /api/moderacao/denunciar
 * Body: { mensagemId, motivo }
 */
exports.denunciar = async (req, res) => {
    try {
        const { mensagemId, motivo } = req.body || {};

        if (!mensagemId) {
            return res
                .status(400)
                .json({ success: false, error: 'Informe a mensagem denunciada.' });
        }

        const veredito = await ModeracaoService.registrarDenuncia({
            mensagemId,
            motivo,
            contexto: {
                escolaId: req.escolaId,
                remetenteId: idDe(req),
                remetentePerfil: perfilDe(req),
            },
        });

        if (!veredito.ocorrencia) {
            return res
                .status(500)
                .json({ success: false, error: 'Não foi possível registrar a denúncia.' });
        }

        // Resposta deliberadamente sem detalhe do veredito: quem denuncia não
        // precisa saber o que a moderação decidiu sobre outra pessoa.
        res.status(201).json({
            success: true,
            message: 'Denúncia registrada. A equipe da escola vai analisar.',
        });
    } catch (erro) {
        logger.error('[Moderacao] Falha ao registrar denúncia', { erro: erro.message });
        res.status(500).json({ success: false, error: 'Não foi possível registrar a denúncia.' });
    }
};

/**
 * POST /api/moderacao/contestar
 * Body: { ocorrenciaId, motivo }
 *
 * Cláusula 9 do Termo. Só o PRÓPRIO autor do conteúdo contesta — contestar
 * decisão alheia seria mais um jeito de descobrir o que aconteceu na conversa
 * de outra pessoa.
 */
exports.contestar = async (req, res) => {
    try {
        const { ocorrenciaId, motivo } = req.body || {};

        if (!ocorrenciaId || !motivo || String(motivo).trim().length < 3) {
            return res
                .status(400)
                .json({ success: false, error: 'Informe a ocorrência e o motivo da contestação.' });
        }

        const ocorrencia = await ModeracaoOcorrencia.findOne({
            _id: ocorrenciaId,
            remetenteId: idDe(req),
        });

        if (!ocorrencia) {
            return res.status(404).json({ success: false, error: 'Ocorrência não encontrada.' });
        }

        if (ocorrencia.contestacao?.solicitadoEm) {
            return res.status(409).json({
                success: false,
                codigo: 'JA_CONTESTADA',
                error: 'Esta decisão já foi contestada.',
            });
        }

        ocorrencia.contestacao = {
            solicitadoEm: new Date(),
            motivoUsuario: String(motivo).trim(),
        };

        // Trava de exclusão da cláusula 8.6: enquanto há contestação em aberto,
        // a ocorrência não pode ser levada pelo TTL. Sem isto, uma contestação
        // feita perto do fim do prazo perderia a própria prova.
        ocorrencia.expiraEm = null;

        await ocorrencia.save();

        res.status(201).json({
            success: true,
            message: 'Contestação registrada. A escola vai responder.',
        });
    } catch (erro) {
        logger.error('[Moderacao] Falha ao registrar contestação', { erro: erro.message });
        res.status(500).json({
            success: false,
            error: 'Não foi possível registrar a contestação.',
        });
    }
};

/**
 * POST /api/moderacao/contestacao/:id/responder
 * Body: { resultado: 'procedente' | 'improcedente', justificativa }
 *
 * Cláusula 9.3: quem responde precisa ser DIFERENTE de quem aplicou a medida.
 */
exports.responderContestacao = async (req, res) => {
    try {
        const { resultado, justificativa } = req.body || {};

        if (resultado !== 'procedente' && resultado !== 'improcedente') {
            return res.status(400).json({
                success: false,
                error: "Resultado inválido. Use 'procedente' ou 'improcedente'.",
            });
        }

        const ocorrencia = await ModeracaoOcorrencia.findOne({
            _id: req.params.id,
            ...escopo(req),
        });

        if (!ocorrencia?.contestacao?.solicitadoEm) {
            return res.status(404).json({ success: false, error: 'Contestação não encontrada.' });
        }

        // A regra técnica da cláusula 9.3, literal. Escola com um único
        // coordenador cai aqui e a contestação sobe para a direção — que é
        // exatamente o desenho previsto, não um erro.
        if (
            ocorrencia.revisao?.moderadorId &&
            String(ocorrencia.revisao.moderadorId) === idDe(req)
        ) {
            return res.status(403).json({
                success: false,
                codigo: 'REVISOR_IGUAL_DECISOR',
                error: 'A contestação precisa ser respondida por pessoa diferente de quem aplicou a medida.',
            });
        }

        ocorrencia.contestacao.resultado = resultado;
        ocorrencia.contestacao.respondidoEm = new Date();
        ocorrencia.contestacao.respondidoPor = idDe(req);

        // `motivoUsuario` é o texto de QUEM CONTESTOU e não pode ser reescrito
        // pela resposta — é a versão da pessoa sobre o próprio caso. A
        // justificativa de quem responde vai para o AuditLog, abaixo.

        if (resultado === 'procedente') ocorrencia.statusAtual = 'revertida';

        // Contestação encerrada: o prazo de retenção volta a correr.
        ocorrencia.expiraEm = ModeracaoOcorrencia.prazoDeRetencao(Boolean(ocorrencia.gridfsId));

        await ocorrencia.save();

        await logAction(req, 'MODERACAO_CONTESTACAO_RESPONDER', 'moderacao_ocorrencias', {
            recursoId: String(ocorrencia._id),
            valorNovo: resultado,
            descricao: justificativa
                ? `Respondeu contestação como ${resultado}: ${String(justificativa).trim()}`
                : `Respondeu contestação como ${resultado}.`,
        });

        res.json({ success: true, data: paraPainel(ocorrencia.toObject()) });
    } catch (erro) {
        logger.error('[Moderacao] Falha ao responder contestação', { erro: erro.message });
        res.status(500).json({
            success: false,
            error: 'Não foi possível responder a contestação.',
        });
    }
};

/**
 * GET /api/moderacao/minhas-contestacoes
 */
exports.minhasContestacoes = async (req, res) => {
    try {
        const ocorrencias = await ModeracaoOcorrencia.find({
            remetenteId: idDe(req),
            'contestacao.solicitadoEm': { $exists: true },
        })
            .sort({ 'contestacao.solicitadoEm': -1 })
            .limit(50)
            .lean();

        res.json({
            success: true,
            data: ocorrencias.map((o) => ({
                id: String(o._id),
                severidade: o.severidade,
                tipoConteudo: o.tipoConteudo,
                criadoEm: o.criadoEm,
                contestacao: o.contestacao,
            })),
        });
    } catch (erro) {
        logger.error('[Moderacao] Falha ao listar contestações', { erro: erro.message });
        res.status(500).json({
            success: false,
            error: 'Não foi possível carregar suas contestações.',
        });
    }
};

/**
 * GET /api/moderacao/aceite-termo
 * Cláusula 2 do Termo: áudio e imagem só liberam após aceite expresso.
 */
exports.consultarAceite = async (req, res) => {
    try {
        const usuario = await Usuario.findById(idDe(req)).select('lgpdHistory').lean();
        const aceite = aceiteVigente(usuario?.lgpdHistory);

        res.json({
            success: true,
            data: {
                aceito: Boolean(aceite),
                versao: TERMO_VERSAO,
                aceitoEm: aceite?.aceitoEm || null,
            },
        });
    } catch (erro) {
        logger.error('[Moderacao] Falha ao consultar aceite do termo', { erro: erro.message });
        res.status(500).json({ success: false, error: 'Não foi possível consultar o aceite.' });
    }
};

/**
 * POST /api/moderacao/aceite-termo
 *
 * Grava em `lgpdHistory`, que já é o histórico imutável de assinaturas do
 * usuário — inventar um campo novo para este termo deixaria dois lugares para
 * procurar a mesma coisa na hora de responder a um titular.
 */
exports.registrarAceite = async (req, res) => {
    try {
        const registro = {
            termoId: TERMO_ID,
            versao: TERMO_VERSAO,
            aceitoEm: new Date(),
            ip: req.ip,
            browser: req.headers['user-agent'],
            os: req.headers['sec-ch-ua-platform'] || 'Desconhecido',
            loginType: 'Portal Local',
        };

        await Usuario.updateOne({ _id: idDe(req) }, { $push: { lgpdHistory: registro } });

        res.status(201).json({
            success: true,
            data: { aceito: true, versao: TERMO_VERSAO, aceitoEm: registro.aceitoEm },
        });
    } catch (erro) {
        logger.error('[Moderacao] Falha ao registrar aceite do termo', { erro: erro.message });
        res.status(500).json({ success: false, error: 'Não foi possível registrar o aceite.' });
    }
};

exports.TERMO_ID = TERMO_ID;
exports.TERMO_VERSAO = TERMO_VERSAO;
exports.PERFIS_CASOS_CRITICOS = PERFIS_CASOS_CRITICOS;
