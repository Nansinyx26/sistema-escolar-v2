/**
 * RelatorioDiarioController.js — diário de classe da aba "Relatórios Diários"
 * ============================================================================
 * O professor escreve, por dia letivo, o que foi trabalhado com a turma.
 *
 * Duas decisões moldam este controller:
 *
 * 1. **A chave é o dia civil, não um instante.** `dia` é `YYYY-MM-DD`. O campo
 *    `data` continua sendo gravado por compatibilidade com o que já existe na
 *    coleção, mas quem identifica o registro é `dia` — assim o relatório de
 *    29/08 escrito às 21h de Brasília não vira 30/08 em UTC.
 *
 * 2. **A gravação é um upsert idempotente.** Não existe "criar" e "editar"
 *    separados: `PUT /diarios` com o mesmo dia sempre converge para uma única
 *    linha. O front não precisa consultar antes de gravar, e o auto-save
 *    disparando em paralelo com o clique em "Salvar" não duplica nada.
 */

const Relatorio = require('../models/Relatorio');
const AuditoriaService = require('../services/AuditoriaService');

const PERIODO_DIARIO = 'diario';
const MATERIA_PADRAO = 'Sala Principal';
const LIMITE_CONTEUDO = 8000;
const LIMITE_JANELA_DIAS = 120;
const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Aceita só `YYYY-MM-DD` que também seja uma data real (rejeita 2026-02-31). */
function diaValido(valor) {
    if (typeof valor !== 'string' || !FORMATO_DIA.test(valor)) return false;
    const d = new Date(`${valor}T12:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

/**
 * Meio-dia UTC de propósito: qualquer fuso do Brasil lê esse instante como o
 * mesmo dia do calendário, então relatórios antigos exibidos por `data`
 * continuam caindo na casinha certa.
 */
function instanteDoDia(dia) {
    return new Date(`${dia}T12:00:00.000Z`);
}

function diferencaEmDias(de, ate) {
    return (instanteDoDia(ate) - instanteDoDia(de)) / 86400000;
}

/**
 * Professor só enxerga e só grava relatório das turmas atribuídas a ele.
 * `req.allowedTurmas` vem do `horizontalFilter`, que já normaliza as variações
 * de grafia ("1ºC" / "1C"). Diretor, secretaria e admin passam direto.
 */
function turmaBloqueada(req, turma) {
    if (!req.user || req.user.perfil !== 'professor') return false;
    return !(req.allowedTurmas || []).includes(turma);
}

function normalizar(doc) {
    return {
        id: doc._id,
        turma: doc.turma,
        materia: doc.materia,
        dia: doc.dia,
        conteudo: doc.conteudo || '',
        autor: doc.autor,
        atualizadoEm: doc.updatedAt
    };
}

// --------------------------------------------------
// GET /api/relatorios/diarios?turma=&materia=&de=&ate=
// --------------------------------------------------
exports.listar = async (req, res) => {
    try {
        const turma = req.query.turma;
        const materia = req.query.materia || MATERIA_PADRAO;
        const { de, ate } = req.query;

        if (!turma) {
            return res.status(400).json({ success: false, error: 'Informe a turma.' });
        }
        if (!diaValido(de) || !diaValido(ate)) {
            return res.status(400).json({ success: false, error: 'Informe o período em de/ate no formato AAAA-MM-DD.' });
        }

        const janela = diferencaEmDias(de, ate);
        if (janela < 0) {
            return res.status(400).json({ success: false, error: 'A data inicial não pode ser depois da final.' });
        }
        if (janela > LIMITE_JANELA_DIAS) {
            return res.status(400).json({ success: false, error: `O período não pode passar de ${LIMITE_JANELA_DIAS} dias.` });
        }
        if (turmaBloqueada(req, turma)) {
            return res.status(403).json({ success: false, error: 'Você não leciona nesta turma.' });
        }

        const filtros = {
            turma,
            materia,
            periodo: PERIODO_DIARIO,
            dia: { $gte: de, $lte: ate }
        };
        if (req.escolaId) filtros.escolaId = req.escolaId;

        const docs = await Relatorio.find(filtros).sort({ dia: 1 }).lean();
        res.json({ success: true, data: docs.map(normalizar) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

// --------------------------------------------------
// PUT /api/relatorios/diarios — grava (ou apaga) o relatório de um dia
// --------------------------------------------------
exports.salvar = async (req, res) => {
    try {
        const turma = req.body.turma;
        const materia = req.body.materia || MATERIA_PADRAO;
        const dia = req.body.dia;
        const conteudo = typeof req.body.conteudo === 'string' ? req.body.conteudo.trim() : '';

        if (!turma) {
            return res.status(400).json({ success: false, error: 'Informe a turma.' });
        }
        if (!diaValido(dia)) {
            return res.status(400).json({ success: false, error: 'Informe o dia no formato AAAA-MM-DD.' });
        }
        if (conteudo.length > LIMITE_CONTEUDO) {
            return res.status(400).json({ success: false, error: `O relatório pode ter no máximo ${LIMITE_CONTEUDO} caracteres.` });
        }
        if (turmaBloqueada(req, turma)) {
            return res.status(403).json({ success: false, error: 'Você não leciona nesta turma.' });
        }

        const chave = { turma, materia, dia, periodo: PERIODO_DIARIO };
        if (req.escolaId) chave.escolaId = req.escolaId;

        // Relatório esvaziado é relatório apagado. Guardar uma linha em branco
        // faria o dia contar como preenchido no medidor da quinzena.
        if (!conteudo) {
            const removido = await Relatorio.findOneAndDelete(chave).lean();
            if (removido) {
                await AuditoriaService.log({
                    req, acao: 'relatorio_diario_remover', recurso: 'relatorios',
                    recursoId: removido._id, detalhes: { turma, materia, dia }
                });
            }
            return res.json({ success: true, data: null, removido: Boolean(removido) });
        }

        const autor = req.user ? req.user.id || req.user._id : undefined;
        const doc = await Relatorio.findOneAndUpdate(
            chave,
            { $set: { conteudo, data: instanteDoDia(dia), autor } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        await AuditoriaService.log({
            req, acao: 'relatorio_diario_salvar', recurso: 'relatorios',
            recursoId: doc._id, detalhes: { turma, materia, dia }
        });

        res.json({ success: true, data: normalizar(doc) });
    } catch (error) {
        // Corrida no upsert: os dois lados passaram pelo "não existe" e o
        // índice único derrubou o segundo. O registro está lá — devolvê-lo é
        // a resposta correta, não um 500.
        if (error && error.code === 11000) {
            const chaveExistente = {
                turma: req.body.turma,
                materia: req.body.materia || MATERIA_PADRAO,
                dia: req.body.dia,
                periodo: PERIODO_DIARIO
            };
            if (req.escolaId) chaveExistente.escolaId = req.escolaId;
            const existente = await Relatorio.findOne(chaveExistente).lean();
            if (existente) return res.json({ success: true, data: normalizar(existente) });
        }
        res.status(500).json({ success: false, error: error.message });
    }
};
