/**
 * AdminIncidentesController — registro de incidentes de segurança com dado
 * pessoal (Resolução CD/ANPD nº 15/2024 — Issue #513).
 *
 * Só o admin (o encarregado opera com essa conta). Cada mudança entra no
 * `historico` do incidente e no `AuditLog` — este último só com protocolo e
 * nome do evento: o texto livre do incidente pode citar pessoa, e o AuditLog é
 * lido por mais gente.
 *
 * Encerrar exige a conclusão da resolução: ou o incidente tinha risco
 * relevante e foi comunicado à ANPD e aos titulares, ou não tinha, e a
 * justificativa fica registrada. "Aberto para sempre" é a forma mais comum de
 * não cumprir o art. 10.
 */
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const IncidenteSeguranca = require('../models/IncidenteSeguranca');
const { prazoDeComunicacao } = require('../services/conformidade/prazoIncidente');
const { logAction } = require('../utils/auditHelper');
const logger = require('../utils/logger');
const obs = require('../observability');

const TEXTO_MAXIMO = 4000;
const JUSTIFICATIVA_MINIMA = 20;
const TOLERANCIA_RELOGIO_MS = 5 * 60 * 1000;

/** Busca por id sem CastError: id malformado é "não encontrado". */
function buscar(id) {
    return mongoose.isValidObjectId(id) ? IncidenteSeguranca.findById(id) : Promise.resolve(null);
}

function quem(req) {
    return { por: String(req.user?.id || req.user?._id || ''), perfil: req.user?.perfil };
}

function dataValida(valor, { obrigatoria = false } = {}) {
    if (valor === undefined || valor === null || valor === '') {
        return obrigatoria ? { erro: true } : { data: null };
    }
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return { erro: true };
    if (data.getTime() > Date.now() + TOLERANCIA_RELOGIO_MS) return { erro: true, futura: true };
    return { data };
}

function texto(valor, maximo = TEXTO_MAXIMO) {
    return String(valor ?? '')
        .trim()
        .slice(0, maximo);
}

function lista(valor, permitidos) {
    if (!Array.isArray(valor)) return null;
    const unicos = [...new Set(valor.map(String))];
    return unicos.every((v) => permitidos.includes(v)) ? unicos : null;
}

/** Visão para a resposta: o documento mais o prazo e se está vencido. */
function comPrazo(doc) {
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    const prazoAnpd = prazoDeComunicacao(obj.cienciaEm);
    const comunicado = Boolean(obj.comunicacaoAnpd?.comunicadoEm);
    const devido = obj.risco !== 'nao_relevante';
    return {
        ...obj,
        id: String(obj._id),
        prazoAnpd,
        prazoVencido: obj.situacao === 'aberto' && devido && !comunicado && Date.now() > prazoAnpd,
    };
}

function gerarProtocolo(agora = new Date()) {
    return `INC-${agora.getUTCFullYear()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Lê do corpo os campos editáveis. Devolve `{ campos, erro }`.
 * `criacao` exige título e data de ciência.
 */
function lerCampos(corpo, { criacao = false } = {}) {
    const campos = {};

    if (criacao || corpo.titulo !== undefined) {
        const titulo = texto(corpo.titulo, 160);
        if (!titulo) return { erro: 'Informe um título curto para o incidente.' };
        campos.titulo = titulo;
    }
    if (criacao || corpo.cienciaEm !== undefined) {
        const c = dataValida(corpo.cienciaEm, { obrigatoria: true });
        if (c.erro)
            return { erro: 'Informe quando a escola soube do incidente (data não futura).' };
        campos.cienciaEm = c.data;
    }
    if (corpo.ocorridoEm !== undefined) {
        const o = dataValida(corpo.ocorridoEm);
        if (o.erro) return { erro: 'Data do incidente inválida.' };
        campos.ocorridoEm = o.data;
    }
    for (const chave of ['descricao', 'avaliacaoRisco', 'medidas', 'justificativaNaoComunicacao']) {
        if (corpo[chave] !== undefined) campos[chave] = texto(corpo[chave]);
    }
    if (corpo.categoriasDados !== undefined) {
        const v = lista(corpo.categoriasDados, IncidenteSeguranca.CATEGORIAS_DADOS);
        if (!v) return { erro: 'Categoria de dado inválida.' };
        campos.categoriasDados = v;
    }
    if (corpo.categoriasTitulares !== undefined) {
        const v = lista(corpo.categoriasTitulares, IncidenteSeguranca.CATEGORIAS_TITULARES);
        if (!v) return { erro: 'Categoria de titular inválida.' };
        campos.categoriasTitulares = v;
    }
    if (corpo.titularesEstimados !== undefined) {
        const n = Number(corpo.titularesEstimados);
        if (!Number.isInteger(n) || n < 0) return { erro: 'Quantidade de titulares inválida.' };
        campos.titularesEstimados = n;
    }
    if (corpo.risco !== undefined) {
        if (!['a_avaliar', 'relevante', 'nao_relevante'].includes(corpo.risco)) {
            return { erro: 'Risco inválido: a_avaliar, relevante ou nao_relevante.' };
        }
        campos.risco = corpo.risco;
    }
    if (corpo.comunicacaoAnpd !== undefined) {
        const c = dataValida(corpo.comunicacaoAnpd?.comunicadoEm);
        if (c.erro) return { erro: 'Data da comunicação à ANPD inválida.' };
        campos.comunicacaoAnpd = {
            comunicadoEm: c.data,
            protocolo: texto(corpo.comunicacaoAnpd?.protocolo, 80),
        };
    }
    if (corpo.comunicacaoTitulares !== undefined) {
        const c = dataValida(corpo.comunicacaoTitulares?.comunicadoEm);
        if (c.erro) return { erro: 'Data da comunicação aos titulares inválida.' };
        campos.comunicacaoTitulares = {
            comunicadoEm: c.data,
            meio: texto(corpo.comunicacaoTitulares?.meio, 80),
        };
    }
    return { campos };
}

/** GET /api/admin/incidentes */
exports.listar = async (req, res) => {
    try {
        const filtro = {};
        if (['aberto', 'encerrado'].includes(req.query.situacao))
            filtro.situacao = req.query.situacao;
        const docs = await IncidenteSeguranca.find(filtro)
            .select('-descricao -avaliacaoRisco -medidas -justificativaNaoComunicacao -historico')
            .sort({ cienciaEm: -1 })
            .limit(500)
            .lean();
        return res.json({ success: true, data: docs.map(comPrazo), total: docs.length });
    } catch (err) {
        logger.error('[Incidentes] Falha ao listar', { err, action: 'incidentes.listar' });
        obs.captureException(err, { rota: 'GET /api/admin/incidentes' });
        return res.status(500).json({ success: false, error: 'Erro ao listar incidentes.' });
    }
};

/** GET /api/admin/incidentes/:id */
exports.obter = async (req, res) => {
    try {
        const doc = await buscar(req.params.id);
        if (!doc)
            return res.status(404).json({ success: false, error: 'Incidente não encontrado.' });
        return res.json({ success: true, data: comPrazo(doc) });
    } catch (err) {
        logger.error('[Incidentes] Falha ao obter', { err, action: 'incidentes.obter' });
        obs.captureException(err, { rota: 'GET /api/admin/incidentes/:id' });
        return res.status(500).json({ success: false, error: 'Erro ao obter o incidente.' });
    }
};

/** POST /api/admin/incidentes */
exports.criar = async (req, res) => {
    try {
        const { campos, erro } = lerCampos(req.body || {}, { criacao: true });
        if (erro) return res.status(400).json({ success: false, error: erro });

        const doc = await obs.withSpan('incidente.registrar', {}, () =>
            IncidenteSeguranca.create({
                ...campos,
                escolaId: req.body?.escolaId ? String(req.body.escolaId) : undefined,
                protocolo: gerarProtocolo(),
                registradoPor: quem(req).por,
                historico: [{ evento: 'registrado', ...quem(req) }],
            })
        );

        await logAction(req, 'INCIDENTE_REGISTRADO', 'IncidenteSeguranca', {
            recursoId: String(doc._id),
            valorNovo: { protocolo: doc.protocolo },
            descricao: `Incidente ${doc.protocolo} registrado.`,
        });

        return res.status(201).json({ success: true, data: comPrazo(doc) });
    } catch (err) {
        logger.error('[Incidentes] Falha ao registrar', { err, action: 'incidentes.criar' });
        obs.captureException(err, { rota: 'POST /api/admin/incidentes' });
        return res.status(500).json({ success: false, error: 'Erro ao registrar o incidente.' });
    }
};

/** PATCH /api/admin/incidentes/:id */
exports.atualizar = async (req, res) => {
    try {
        const { campos, erro } = lerCampos(req.body || {});
        if (erro) return res.status(400).json({ success: false, error: erro });
        const alterados = Object.keys(campos);
        if (alterados.length === 0) {
            return res.status(400).json({ success: false, error: 'Nada para atualizar.' });
        }

        const doc = await buscar(req.params.id);
        if (!doc)
            return res.status(404).json({ success: false, error: 'Incidente não encontrado.' });
        if (doc.situacao === 'encerrado') {
            return res.status(409).json({
                success: false,
                codigo: 'INCIDENTE_ENCERRADO',
                error: 'Incidente encerrado não é alterado. Registre um novo, se for o caso.',
            });
        }

        doc.set(campos);
        doc.historico.push({ evento: `atualizado: ${alterados.join(', ')}`, ...quem(req) });
        await obs.withSpan('incidente.atualizar', {}, () => doc.save());

        await logAction(req, 'INCIDENTE_ATUALIZADO', 'IncidenteSeguranca', {
            recursoId: String(doc._id),
            valorNovo: { protocolo: doc.protocolo, campos: alterados },
            descricao: `Incidente ${doc.protocolo} atualizado.`,
        });

        return res.json({ success: true, data: comPrazo(doc) });
    } catch (err) {
        logger.error('[Incidentes] Falha ao atualizar', { err, action: 'incidentes.atualizar' });
        obs.captureException(err, { rota: 'PATCH /api/admin/incidentes/:id' });
        return res.status(500).json({ success: false, error: 'Erro ao atualizar o incidente.' });
    }
};

/**
 * O que falta para encerrar, conforme a avaliação de risco. Lista vazia =
 * pode encerrar.
 */
function pendenciasParaEncerrar(doc) {
    if (doc.risco === 'a_avaliar') return ['avaliar o risco (relevante ou não relevante)'];
    if (doc.risco === 'relevante') {
        const faltas = [];
        if (!doc.comunicacaoAnpd?.comunicadoEm) faltas.push('registrar a comunicação à ANPD');
        if (!doc.comunicacaoTitulares?.comunicadoEm) {
            faltas.push('registrar a comunicação aos titulares');
        }
        return faltas;
    }
    return String(doc.justificativaNaoComunicacao || '').trim().length >= JUSTIFICATIVA_MINIMA
        ? []
        : [`justificar por que não houve comunicação (mínimo ${JUSTIFICATIVA_MINIMA} caracteres)`];
}

/** POST /api/admin/incidentes/:id/encerrar */
exports.encerrar = async (req, res) => {
    try {
        const doc = await buscar(req.params.id);
        if (!doc)
            return res.status(404).json({ success: false, error: 'Incidente não encontrado.' });
        if (doc.situacao === 'encerrado') {
            return res
                .status(409)
                .json({ success: false, codigo: 'INCIDENTE_ENCERRADO', error: 'Já encerrado.' });
        }

        const pendencias = pendenciasParaEncerrar(doc);
        if (pendencias.length) {
            return res.status(409).json({
                success: false,
                codigo: 'INCIDENTE_COM_PENDENCIA',
                error: `Antes de encerrar: ${pendencias.join('; ')}.`,
                pendencias,
            });
        }

        doc.situacao = 'encerrado';
        doc.encerradoEm = new Date();
        doc.historico.push({ evento: 'encerrado', ...quem(req) });
        await obs.withSpan('incidente.encerrar', {}, () => doc.save());

        await logAction(req, 'INCIDENTE_ENCERRADO', 'IncidenteSeguranca', {
            recursoId: String(doc._id),
            valorNovo: { protocolo: doc.protocolo, risco: doc.risco },
            descricao: `Incidente ${doc.protocolo} encerrado.`,
        });

        return res.json({ success: true, data: comPrazo(doc) });
    } catch (err) {
        logger.error('[Incidentes] Falha ao encerrar', { err, action: 'incidentes.encerrar' });
        obs.captureException(err, { rota: 'POST /api/admin/incidentes/:id/encerrar' });
        return res.status(500).json({ success: false, error: 'Erro ao encerrar o incidente.' });
    }
};
