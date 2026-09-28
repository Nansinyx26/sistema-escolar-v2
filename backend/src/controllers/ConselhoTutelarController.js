/**
 * ConselhoTutelarController — registro da comunicação ao Conselho Tutelar
 * nas denúncias de violência, assédio e automutilação (Issue #511).
 *
 * Base legal: ECA, arts. 13, 56-I e 245 (a omissão do dirigente é infração);
 * Lei 14.344/2022; Lei 13.819/2019, art. 6º (notificação compulsória e
 * sigilosa da violência autoprovocada); LDB, art. 12, VIII, na redação da
 * Lei 15.231/2025.
 *
 * O sistema não envia nada ao Conselho — não existe canal eletrônico
 * padronizado. Ele guarda a PROVA de que a escola comunicou: quando, por qual
 * meio e com qual protocolo. E mostra à gestão o que ainda está pendente.
 *
 * NADA DE CONTEÚDO. A fila e a resposta não trazem o relato nem quem
 * denunciou; o AuditLog não guarda a justificativa (texto livre é onde nome
 * de criança reaparece). O mesmo `escopo` da moderação isola as escolas.
 */
const ModeracaoOcorrencia = require('../models/ModeracaoOcorrencia');
const {
    CATEGORIAS_CONSELHO_TUTELAR,
    CATEGORIAS_SIGILOSAS,
} = require('../services/moderacao/ModeracaoService');
const { logAction } = require('../utils/auditHelper');
const logger = require('../utils/logger');
const obs = require('../observability');

const MEIOS = ['oficio', 'email', 'telefone', 'presencial', 'sistema_do_conselho'];

/**
 * Decidir que a comunicação não é devida é decisão do dirigente (ECA, art.
 * 56): a secretaria registra que comunicou, mas não dispensa.
 */
const PERFIS_QUE_DISPENSAM = new Set(['diretor', 'admin']);

const JUSTIFICATIVA_MINIMA = 20;
const TOLERANCIA_RELOGIO_MS = 5 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

function escopo(req) {
    const escolaId = req.escolaId || req.query?.escolaId || req.body?.escolaId;
    return escolaId ? { escolaId: String(escolaId) } : {};
}

function perfilDe(req) {
    return String(req.user?.perfil || '').toLowerCase();
}

/**
 * Situação da comunicação, inclusive para denúncia gravada antes desta Issue:
 * ela não tem o campo, mas a categoria já dizia que a comunicação era devida.
 */
function situacaoDe(doc) {
    const atual = doc.conselhoTutelar || {};
    const exigidaPelaCategoria = CATEGORIAS_CONSELHO_TUTELAR.includes(doc.categoriaDenuncia);
    return {
        exigida: Boolean(atual.exigida || exigidaPelaCategoria),
        sigilosa: Boolean(atual.sigilosa || CATEGORIAS_SIGILOSAS.includes(doc.categoriaDenuncia)),
        situacao: atual.situacao || 'pendente',
        comunicadoEm: atual.comunicadoEm || null,
        meio: atual.meio || null,
        protocolo: atual.protocolo || null,
        registradoEm: atual.registradoEm || null,
    };
}

/** GET /api/moderacao/conselho-tutelar/pendentes */
exports.listarPendentes = async (req, res) => {
    try {
        const filtro = {
            ...escopo(req),
            $or: [
                { 'conselhoTutelar.exigida': true, 'conselhoTutelar.situacao': 'pendente' },
                {
                    categoriaDenuncia: { $in: CATEGORIAS_CONSELHO_TUTELAR },
                    conselhoTutelar: { $exists: false },
                },
            ],
        };
        const docs = await obs.withSpan('conselhoTutelar.pendentes', {}, () =>
            ModeracaoOcorrencia.find(filtro)
                .select('categoriaDenuncia conselhoTutelar statusAtual criadoEm')
                .sort({ criadoEm: 1 })
                .limit(200)
                .lean()
        );

        const agora = Date.now();
        const data = docs.map((d) => ({
            id: String(d._id),
            categoria: d.categoriaDenuncia || null,
            statusApuracao: d.statusAtual,
            criadoEm: d.criadoEm,
            diasDesdeDenuncia: Math.floor((agora - new Date(d.criadoEm).getTime()) / DIA_MS),
            sigilosa: situacaoDe(d).sigilosa,
        }));

        return res.json({ success: true, data, total: data.length });
    } catch (err) {
        logger.error('[ConselhoTutelar] Falha ao listar pendentes', {
            err,
            action: 'conselhoTutelar.pendentes',
        });
        obs.captureException(err, { rota: 'GET /api/moderacao/conselho-tutelar/pendentes' });
        return res.status(500).json({
            success: false,
            error: 'Não foi possível carregar as comunicações pendentes.',
        });
    }
};

/** Valida o corpo de "comunicar". Devolve o registro ou a mensagem de erro. */
function lerComunicacao(corpo) {
    const data = new Date(corpo?.comunicadoEm);
    if (!corpo?.comunicadoEm || Number.isNaN(data.getTime())) {
        return { erro: 'Informe a data em que o Conselho Tutelar foi comunicado.' };
    }
    if (data.getTime() > Date.now() + TOLERANCIA_RELOGIO_MS) {
        return { erro: 'A data da comunicação não pode estar no futuro.' };
    }
    if (!MEIOS.includes(corpo?.meio)) {
        return { erro: `Informe o meio da comunicação: ${MEIOS.join(', ')}.` };
    }
    const protocolo = String(corpo?.protocolo ?? '').trim();
    if (protocolo.length > 60) {
        return { erro: 'O protocolo tem no máximo 60 caracteres.' };
    }
    return {
        registro: {
            situacao: 'comunicado',
            comunicadoEm: data,
            meio: corpo.meio,
            protocolo: protocolo || undefined,
        },
    };
}

/**
 * POST /api/moderacao/ocorrencia/:id/conselho-tutelar
 * Body: { acao: 'comunicar', comunicadoEm, meio, protocolo? }
 *     | { acao: 'dispensar', justificativa }
 */
exports.registrar = async (req, res) => {
    try {
        const corpo = req.body || {};
        const perfil = perfilDe(req);

        let registro;
        if (corpo.acao === 'comunicar') {
            const lido = lerComunicacao(corpo);
            if (lido.erro) return res.status(400).json({ success: false, error: lido.erro });
            registro = lido.registro;
        } else if (corpo.acao === 'dispensar') {
            if (!PERFIS_QUE_DISPENSAM.has(perfil)) {
                return res.status(403).json({
                    success: false,
                    codigo: 'DISPENSA_SO_DIRECAO',
                    error: 'Só a direção decide que a comunicação ao Conselho Tutelar não é devida.',
                });
            }
            const justificativa = String(corpo.justificativa ?? '').trim();
            if (justificativa.length < JUSTIFICATIVA_MINIMA) {
                return res.status(400).json({
                    success: false,
                    error: `Explique o resultado da apuração (mínimo ${JUSTIFICATIVA_MINIMA} caracteres).`,
                });
            }
            registro = {
                situacao: 'dispensado',
                justificativaDispensa: justificativa.slice(0, 1000),
            };
        } else {
            return res
                .status(400)
                .json({ success: false, error: "Ação inválida. Use 'comunicar' ou 'dispensar'." });
        }

        const ocorrencia = await ModeracaoOcorrencia.findOne({
            _id: req.params.id,
            ...escopo(req),
        });
        if (!ocorrencia) {
            return res.status(404).json({ success: false, error: 'Ocorrência não encontrada.' });
        }

        const atual = situacaoDe(ocorrencia);
        if (atual.situacao !== 'pendente') {
            return res.status(409).json({
                success: false,
                codigo: 'COMUNICACAO_JA_REGISTRADA',
                error: 'A comunicação desta ocorrência já foi registrada.',
            });
        }

        ocorrencia.conselhoTutelar = {
            exigida: atual.exigida,
            sigilosa: atual.sigilosa,
            ...registro,
            registradoPor: String(req.user?.id || req.user?._id || ''),
            registradoPerfil: perfil,
            registradoEm: new Date(),
        };
        await obs.withSpan(
            'conselhoTutelar.registrar',
            { 'conselho.situacao': registro.situacao },
            () => ocorrencia.save()
        );

        await logAction(
            req,
            registro.situacao === 'comunicado'
                ? 'CONSELHO_TUTELAR_COMUNICADO'
                : 'CONSELHO_TUTELAR_DISPENSADO',
            'moderacao_ocorrencias',
            {
                recursoId: String(ocorrencia._id),
                valorNovo: {
                    situacao: registro.situacao,
                    meio: registro.meio,
                    temProtocolo: Boolean(registro.protocolo),
                    sigilosa: atual.sigilosa,
                },
                descricao: `Comunicação ao Conselho Tutelar ${registro.situacao} na ocorrência ${ocorrencia._id}.`,
            }
        );

        return res.json({ success: true, data: situacaoDe(ocorrencia.toObject()) });
    } catch (err) {
        logger.error('[ConselhoTutelar] Falha ao registrar comunicação', {
            err,
            action: 'conselhoTutelar.registrar',
        });
        obs.captureException(err, { rota: 'POST /api/moderacao/ocorrencia/:id/conselho-tutelar' });
        return res
            .status(500)
            .json({ success: false, error: 'Não foi possível registrar a comunicação.' });
    }
};
