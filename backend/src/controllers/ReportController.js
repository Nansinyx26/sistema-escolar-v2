/**
 * ReportController — relatórios diários da turma.
 *
 * POR QUE ESTE ARQUIVO MUDOU DE FORMA (Issue #132)
 * ------------------------------------------------
 * Ele era um CRUD genérico (list/create/get/update/delete) que NÃO ESTAVA
 * MONTADO em rota nenhuma: `routes/relatorios.js` só expunha o boletim. Ou
 * seja, a aba "Relatórios Diários" chamava `/api/relatorios` e caía no 404
 * global — o `db.getByIndex` do front engole o erro e devolve `[]`, então a
 * tela parecia funcionar e não salvava nada.
 *
 * O `create` também não servia ao caso: o front precisava DESCOBRIR se já
 * existia registro daquele dia, e fazia isso baixando a lista inteira antes de
 * cada gravação. Dois salvamentos rápidos do mesmo dia liam "não existe" os
 * dois e criavam DUAS linhas para a mesma data.
 *
 * `salvarDiario` fecha essa corrida onde ela pode ser fechada: um
 * `findOneAndUpdate(..., { upsert: true })` sobre a chave natural do registro
 * (turma + matéria + dia). Duas chamadas simultâneas resultam em um documento
 * só, sem o front precisar saber se está criando ou atualizando.
 */

const Relatorio = require('../models/Relatorio');
const logger = require('../utils/logger');

const PERIODO_DIARIO = 'diario';

/**
 * Normaliza uma data para o INÍCIO do dia em UTC.
 *
 * A chave do registro é o dia, não o instante. Sem isso, "2026-08-29" e
 * "2026-08-29T14:32:10Z" seriam documentos diferentes, e o upsert deixaria de
 * ser idempotente exatamente onde ele precisa ser.
 */
function inicioDoDia(valor) {
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) return null;
    return new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()));
}

/**
 * GET /api/relatorios?turma=&materia=&de=&ate=
 *
 * `de`/`ate` existem para a tela carregar só a quinzena aberta: sem eles, cada
 * troca de quinzena baixaria o histórico inteiro da turma.
 */
exports.listar = async (req, res) => {
    try {
        const { turma, materia, periodo, de, ate } = req.query;

        const filtro = {};
        if (turma) filtro.turma = String(turma);
        if (materia) filtro.materia = String(materia);
        filtro.periodo = periodo ? String(periodo) : PERIODO_DIARIO;

        const inicio = de ? inicioDoDia(de) : null;
        const fim = ate ? inicioDoDia(ate) : null;
        if (inicio || fim) {
            filtro.data = {};
            if (inicio) filtro.data.$gte = inicio;
            // `$lte` sobre o início do dia: o upsert grava sempre 00:00 UTC.
            if (fim) filtro.data.$lte = fim;
        }

        const docs = await Relatorio.find(filtro).sort({ data: 1 }).lean();

        res.json({
            success: true,
            data: docs.map((d) => ({ ...d, id: d.id || d._id })),
        });
    } catch (erro) {
        logger.error('[Relatorios] Falha ao listar relatórios diários', { erro: erro.message });
        res.status(500).json({ success: false, error: 'Não foi possível carregar os relatórios.' });
    }
};

/**
 * PUT /api/relatorios/diario
 *
 * Idempotente por (turma, matéria, dia). É o que garante o critério "um dia
 * salvo duas vezes seguidas continua com um único registro".
 */
exports.salvarDiario = async (req, res) => {
    try {
        const { turma, materia, data, conteudo } = req.body || {};

        if (!turma || !data) {
            return res.status(400).json({
                success: false,
                error: 'Informe a turma e a data do relatório.',
                code: 'DADOS_INCOMPLETOS',
            });
        }

        const dia = inicioDoDia(data);
        if (!dia) {
            return res.status(400).json({
                success: false,
                error: 'Data inválida.',
                code: 'DATA_INVALIDA',
            });
        }

        const chave = {
            turma: String(turma),
            materia: String(materia || ''),
            periodo: PERIODO_DIARIO,
            data: dia,
        };

        // O autor vem da SESSÃO, nunca do corpo: aceitar `autor` do cliente
        // deixaria qualquer pessoa assinar o relatório com o nome de outra.
        const autor = String(req.user?.id || req.user?._id || '');

        const doc = await Relatorio.findOneAndUpdate(
            chave,
            { $set: { conteudo: String(conteudo ?? ''), autor }, $setOnInsert: chave },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        ).lean();

        res.json({ success: true, data: { ...doc, id: doc.id || doc._id } });
    } catch (erro) {
        logger.error('[Relatorios] Falha ao salvar relatório diário', { erro: erro.message });
        res.status(500).json({ success: false, error: 'Não foi possível salvar o relatório.' });
    }
};
