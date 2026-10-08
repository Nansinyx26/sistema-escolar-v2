/**
 * DenunciaController — as denúncias recebidas pelo canal aberto (Issue #726).
 *
 * O canal "Denunciar bullying, assédio ou discriminação" grava a denúncia em
 * `moderacao_ocorrencias` (camada `denuncia`, com `categoriaDenuncia` e
 * `relato`). Este controller é o outro lado do canal: onde a equipe da escola
 * lê o que foi relatado e registra a apuração. Sem ele, "sua denúncia vai para
 * a equipe da escola" era uma promessa sem destino.
 *
 * QUEM ENTRA: direção, secretaria e admin — a rota usa `authorize.estrito`, o
 * mesmo da moderação, então o admin precisa dizer de qual escola está falando.
 *
 * A LISTAGEM NÃO TRAZ O RELATO. Ler o relato é acesso a dado pessoal de
 * terceiro — muitas vezes de criança — e por isso é um ato separado, que grava
 * `DENUNCIA_VISUALIZAR` no AuditLog ANTES de responder (mesma regra de
 * `MODERACAO_VISUALIZAR`). Assim dá para responder depois "quem leu esta
 * denúncia". O AuditLog nunca guarda o relato nem a anotação: texto livre é
 * onde o nome da criança reaparece.
 *
 * A PESSOA DENUNCIADA NÃO É AVISADA. Nada aqui notifica ninguém; o andamento
 * fica no banco e só esta equipe o vê.
 */
const mongoose = require('mongoose');
const ModeracaoOcorrencia = require('../models/ModeracaoOcorrencia');
const Usuario = require('../models/Usuario');
const {
    CATEGORIAS_CONSELHO_TUTELAR,
    CATEGORIAS_SIGILOSAS,
} = require('../services/moderacao/ModeracaoService');
const { logAction } = require('../utils/auditHelper');
const logger = require('../utils/logger');
const obs = require('../observability');

/** As categorias do canal aberto — lidas do próprio enum do model. */
const CATEGORIAS = ModeracaoOcorrencia.schema.path('categoriaDenuncia').enumValues;

const SITUACOES = ['nova', 'em_apuracao', 'concluida'];

/** Para onde um andamento pode levar a denúncia. `nova` é só o ponto de partida. */
const SITUACOES_DE_ANDAMENTO = ['em_apuracao', 'concluida'];

/**
 * Concluir — e reabrir o que estava concluído — exige dizer o que a escola
 * apurou e fez. É o registro que sustenta a resposta à família e o relatório
 * bimestral da Lei 13.185/2015; "concluída" sem motivo não sustenta nada.
 */
const ANOTACAO_MINIMA = 10;
const ANOTACAO_MAXIMA = 1000;

/** Teto do histórico por denúncia — o documento não cresce sem limite. */
const LIMITE_ANDAMENTOS = 100;

const CAMPOS_DA_LISTA =
    'categoriaDenuncia severidade remetentePerfil apuracao.situacao apuracao.atualizadoEm conselhoTutelar criadoEm';

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

/** Só denúncia do canal aberto: a de mensagem do chat segue na fila de moderação. */
function filtroBase(req) {
    return { ...escopo(req), camada: 'denuncia', categoriaDenuncia: { $in: CATEGORIAS } };
}

/** Denúncia gravada antes da Issue #726 não tem `apuracao`: é nova. */
function situacaoDe(doc) {
    return doc.apuracao?.situacao || 'nova';
}

/** Mesma derivação da fila do Conselho Tutelar (Issue #511), sem o protocolo. */
function conselhoTutelarDe(doc) {
    const atual = doc.conselhoTutelar || {};
    const exigida = Boolean(
        atual.exigida || CATEGORIAS_CONSELHO_TUTELAR.includes(doc.categoriaDenuncia)
    );
    return exigida ? { exigida, situacao: atual.situacao || 'pendente' } : null;
}

function paraLista(doc) {
    const id = String(doc._id);
    return {
        id,
        protocolo: id,
        categoria: doc.categoriaDenuncia,
        severidade: doc.severidade,
        situacao: situacaoDe(doc),
        remetentePerfil: doc.remetentePerfil || null,
        sigilosa: Boolean(
            doc.conselhoTutelar?.sigilosa || CATEGORIAS_SIGILOSAS.includes(doc.categoriaDenuncia)
        ),
        conselhoTutelar: conselhoTutelarDe(doc),
        criadoEm: doc.criadoEm,
        atualizadoEm: doc.apuracao?.atualizadoEm || null,
    };
}

/** Nome de quem denunciou e de quem anotou, numa consulta só. */
async function nomesDe(ids) {
    const validos = [...new Set(ids.filter((id) => id && mongoose.isValidObjectId(id)))];
    if (validos.length === 0) return new Map();
    const usuarios = await Usuario.find({ _id: { $in: validos } })
        .select('nome')
        .lean();
    return new Map(usuarios.map((u) => [String(u._id), u.nome]));
}

async function paraDetalhe(doc) {
    const andamentos = doc.apuracao?.andamentos || [];
    const nomes = await nomesDe([doc.remetenteId, ...andamentos.map((a) => a.porId)]);
    return {
        ...paraLista(doc),
        relato: doc.relato || '',
        autor: {
            nome: nomes.get(String(doc.remetenteId)) || null,
            perfil: doc.remetentePerfil || null,
        },
        andamentos: andamentos.map((a) => ({
            situacao: a.situacao,
            anotacao: a.anotacao || '',
            porNome: nomes.get(String(a.porId)) || null,
            porPerfil: a.porPerfil || null,
            em: a.em,
        })),
    };
}

function naoEncontrada(res) {
    return res.status(404).json({ success: false, error: 'Denúncia não encontrada.' });
}

/**
 * GET /api/moderacao/denuncias?situacao=&categoria=&limite=
 * As denúncias da escola, mais recente primeiro, sem o relato.
 */
exports.listar = async (req, res) => {
    try {
        const { situacao, categoria } = req.query || {};

        if (situacao && !SITUACOES.includes(situacao)) {
            return res.status(400).json({
                success: false,
                error: `Situação inválida. Use: ${SITUACOES.join(', ')}.`,
            });
        }
        if (categoria && !CATEGORIAS.includes(categoria)) {
            return res.status(400).json({
                success: false,
                error: `Categoria inválida. Use: ${CATEGORIAS.join(', ')}.`,
            });
        }

        // O resumo segue o filtro de categoria, mas não o de situação: é ele que
        // dá o número de cada aba, e a aba precisa contar o que vai mostrar.
        const base = { ...filtroBase(req), ...(categoria ? { categoriaDenuncia: categoria } : {}) };
        const filtro = { ...base };
        if (situacao) {
            // `null` também casa com o documento SEM o campo — a denúncia antiga.
            filtro['apuracao.situacao'] = situacao === 'nova' ? { $in: ['nova', null] } : situacao;
        }

        const limite = Math.min(Number.parseInt(req.query?.limite, 10) || 50, 200);

        const [docs, porSituacao] = await obs.withSpan(
            'denuncias.listar',
            { 'denuncia.situacao': situacao || 'todas' },
            () =>
                Promise.all([
                    ModeracaoOcorrencia.find(filtro)
                        .select(CAMPOS_DA_LISTA)
                        .sort({ criadoEm: -1 })
                        .limit(limite)
                        .lean(),
                    ModeracaoOcorrencia.aggregate([
                        { $match: base },
                        {
                            $group: {
                                _id: { $ifNull: ['$apuracao.situacao', 'nova'] },
                                total: { $sum: 1 },
                            },
                        },
                    ]),
                ])
        );

        const resumo = Object.fromEntries(SITUACOES.map((s) => [s, 0]));
        for (const linha of porSituacao) {
            if (linha._id in resumo) resumo[linha._id] = linha.total;
        }

        const data = docs.map(paraLista);
        return res.json({
            success: true,
            data,
            total: data.length,
            resumo: { ...resumo, total: SITUACOES.reduce((soma, s) => soma + resumo[s], 0) },
        });
    } catch (err) {
        logger.error('[Denuncias] Falha ao listar', { err, action: 'denuncias.listar' });
        obs.captureException(err, { rota: 'GET /api/moderacao/denuncias' });
        return res
            .status(500)
            .json({ success: false, error: 'Não foi possível carregar as denúncias.' });
    }
};

/**
 * GET /api/moderacao/denuncias/:id
 * O relato, quem denunciou e o histórico da apuração.
 */
exports.obter = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return naoEncontrada(res);

        const doc = await obs.withSpan('denuncias.obter', {}, () =>
            ModeracaoOcorrencia.findOne({ _id: req.params.id, ...filtroBase(req) }).lean()
        );
        if (!doc) return naoEncontrada(res);

        // ANTES de responder: se a resposta falhar depois, o acesso já
        // aconteceu e o rastro precisa existir.
        await logAction(req, 'DENUNCIA_VISUALIZAR', 'moderacao_ocorrencias', {
            recursoId: String(doc._id),
            descricao: `Abriu o relato da denúncia ${doc._id} (${doc.categoriaDenuncia}).`,
        });

        return res.json({ success: true, data: await paraDetalhe(doc) });
    } catch (err) {
        logger.error('[Denuncias] Falha ao abrir denúncia', { err, action: 'denuncias.obter' });
        obs.captureException(err, { rota: 'GET /api/moderacao/denuncias/:id' });
        return res
            .status(500)
            .json({ success: false, error: 'Não foi possível abrir a denúncia.' });
    }
};

/**
 * POST /api/moderacao/denuncias/:id/andamento
 * Body: { situacao: 'em_apuracao' | 'concluida', anotacao? }
 */
exports.registrarAndamento = async (req, res) => {
    try {
        const situacao = req.body?.situacao;
        if (!SITUACOES_DE_ANDAMENTO.includes(situacao)) {
            return res.status(400).json({
                success: false,
                error: `Situação inválida. Use: ${SITUACOES_DE_ANDAMENTO.join(', ')}.`,
            });
        }

        const anotacao = String(req.body?.anotacao ?? '').trim();
        if (anotacao.length > ANOTACAO_MAXIMA) {
            return res.status(400).json({
                success: false,
                error: `A anotação tem no máximo ${ANOTACAO_MAXIMA} caracteres.`,
            });
        }

        if (!mongoose.isValidObjectId(req.params.id)) return naoEncontrada(res);

        const filtro = { _id: req.params.id, ...filtroBase(req) };
        const doc = await ModeracaoOcorrencia.findOne(filtro).select('apuracao.situacao').lean();
        if (!doc) return naoEncontrada(res);

        const atual = situacaoDe(doc);
        const mexeNaConclusao = situacao === 'concluida' || atual === 'concluida';
        if (mexeNaConclusao && anotacao.length < ANOTACAO_MINIMA) {
            return res.status(400).json({
                success: false,
                error:
                    atual === 'concluida' && situacao !== 'concluida'
                        ? `Explique por que a apuração está sendo reaberta (mínimo ${ANOTACAO_MINIMA} caracteres).`
                        : `Registre o que a escola apurou e fez (mínimo ${ANOTACAO_MINIMA} caracteres).`,
            });
        }
        if (atual === situacao && !anotacao) {
            return res.status(400).json({
                success: false,
                codigo: 'SEM_MUDANCA',
                error: 'A denúncia já está nesta situação. Escreva uma anotação para registrar o andamento.',
            });
        }

        const em = new Date();
        const andamento = {
            situacao,
            anotacao: anotacao || undefined,
            porId: idDe(req),
            porPerfil: perfilDe(req),
            em,
        };

        const atualizado = await obs.withSpan(
            'denuncias.andamento',
            { 'denuncia.situacao': situacao },
            () =>
                ModeracaoOcorrencia.findOneAndUpdate(
                    filtro,
                    {
                        $set: { 'apuracao.situacao': situacao, 'apuracao.atualizadoEm': em },
                        $push: {
                            'apuracao.andamentos': {
                                $each: [andamento],
                                $slice: -LIMITE_ANDAMENTOS,
                            },
                        },
                    },
                    { new: true, runValidators: true }
                ).lean()
        );
        if (!atualizado) return naoEncontrada(res);

        await logAction(req, 'DENUNCIA_ANDAMENTO', 'moderacao_ocorrencias', {
            recursoId: String(atualizado._id),
            valorAnterior: atual,
            valorNovo: { situacao, temAnotacao: Boolean(anotacao) },
            descricao: `Andamento da denúncia ${atualizado._id}: ${atual} → ${situacao}.`,
        });

        return res.json({ success: true, data: await paraDetalhe(atualizado) });
    } catch (err) {
        logger.error('[Denuncias] Falha ao registrar andamento', {
            err,
            action: 'denuncias.andamento',
        });
        obs.captureException(err, { rota: 'POST /api/moderacao/denuncias/:id/andamento' });
        return res
            .status(500)
            .json({ success: false, error: 'Não foi possível registrar o andamento.' });
    }
};
