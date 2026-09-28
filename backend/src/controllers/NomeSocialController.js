/**
 * NomeSocialController — nome social do aluno nos registros escolares internos
 * (Resolução CNE/CP nº 1/2018; em SP, Decreto 55.588/2010 — Issue #510).
 *
 * Rota própria, e não mais um campo em `PUT /alunos/:id`, porque o registro
 * tem condição: o requerimento. Aluno maior de 18 anos pede por si; o menor,
 * por meio dos responsáveis. A secretaria confirma que o requerimento está
 * arquivado — o sistema não guarda o papel, guarda quem pediu, quando e quem
 * registrou.
 *
 * O `AuditLog` leva só o id do aluno e o tipo de requerente: o nome social é
 * exatamente o dado que a pessoa escolheu revelar só onde pediu (ver também
 * `logSemNome.regressao.test.js`).
 */
const Aluno = require('../models/Aluno');
const assertAcessoAoAluno = require('../middleware/assertAcessoAoAluno');
const { logAction } = require('../utils/auditHelper');
const logger = require('../utils/logger');
const obs = require('../observability');

const REQUERENTES = ['aluno', 'responsaveis'];
const TAMANHO_MAXIMO = 120;
const MAIORIDADE = 18;

/** Idade completa em `referencia`, ou null sem data de nascimento válida. */
function idadeEm(nascimento, referencia = new Date()) {
    const n = nascimento ? new Date(nascimento) : null;
    if (!n || Number.isNaN(n.getTime())) return null;
    let idade = referencia.getUTCFullYear() - n.getUTCFullYear();
    const antesDoAniversario =
        referencia.getUTCMonth() < n.getUTCMonth() ||
        (referencia.getUTCMonth() === n.getUTCMonth() && referencia.getUTCDate() < n.getUTCDate());
    if (antesDoAniversario) idade -= 1;
    return idade;
}

/**
 * Quem pode requerer, pela idade: o próprio aluno só a partir dos 18 anos
 * (art. 3º da Resolução CNE/CP nº 1/2018); antes disso, os responsáveis.
 * Sem data de nascimento, só o requerimento dos responsáveis é aceito — é o
 * caminho que vale para qualquer idade.
 */
function requerenteValido(requerente, nascimento) {
    if (requerente === 'responsaveis') return true;
    const idade = idadeEm(nascimento);
    return idade !== null && idade >= MAIORIDADE;
}

/** Aluno da escola de quem pede, ou a resposta de recusa já enviada. */
async function alunoDaGestao(req, res) {
    const acesso = await assertAcessoAoAluno(req, req.params.id);
    if (!acesso.ok) {
        res.status(acesso.status).json({ success: false, error: acesso.error });
        return null;
    }
    const aluno = await Aluno.findById(acesso.aluno?._id || req.params.id);
    if (!aluno) {
        res.status(404).json({ success: false, error: 'Aluno não encontrado.' });
        return null;
    }
    return aluno;
}

/** PUT /api/secretaria/alunos/:id/nome-social */
exports.definir = async (req, res) => {
    try {
        const nomeSocial = String(req.body?.nomeSocial ?? '')
            .replace(/\s+/g, ' ')
            .trim();
        const requerente = String(req.body?.requerente || '');

        if (!nomeSocial || nomeSocial.length > TAMANHO_MAXIMO) {
            return res.status(400).json({
                success: false,
                error: `Informe o nome social (até ${TAMANHO_MAXIMO} caracteres).`,
            });
        }
        if (!REQUERENTES.includes(requerente)) {
            return res.status(400).json({
                success: false,
                error: 'Informe quem fez o requerimento: "aluno" ou "responsaveis".',
            });
        }
        if (req.body?.requerimentoArquivado !== true) {
            return res.status(400).json({
                success: false,
                codigo: 'REQUERIMENTO_NAO_CONFIRMADO',
                error: 'Confirme que o requerimento escrito está arquivado na secretaria.',
            });
        }

        const aluno = await alunoDaGestao(req, res);
        if (!aluno) return;

        if (!requerenteValido(requerente, aluno.nascimento)) {
            return res.status(400).json({
                success: false,
                codigo: 'REQUERIMENTO_DOS_RESPONSAVEIS',
                error: 'Para aluno menor de 18 anos (ou sem data de nascimento), o requerimento é dos responsáveis.',
            });
        }

        const alterou = Boolean(aluno.nomeSocial);
        aluno.nomeSocial = nomeSocial;
        aluno.nomeSocialRequerimento = {
            requerente,
            registradoEm: new Date(),
            registradoPor: String(req.user?.id || req.user?._id || ''),
        };
        await obs.withSpan('aluno.nomeSocial.definir', { 'aluno.alterou': alterou }, () =>
            aluno.save()
        );

        await logAction(req, 'ALUNO_NOME_SOCIAL_DEFINIDO', 'Alunos', {
            recursoId: String(aluno._id),
            valorNovo: { requerente, alterou },
            descricao: `Nome social ${alterou ? 'alterado' : 'registrado'} no aluno ${aluno._id}.`,
        });

        return res.json({
            success: true,
            data: {
                nomeSocial: aluno.nomeSocial,
                nomeSocialRequerimento: aluno.nomeSocialRequerimento,
            },
        });
    } catch (err) {
        logger.error('[NomeSocial] Falha ao registrar', { err, action: 'nomeSocial.definir' });
        obs.captureException(err, { rota: 'PUT /api/secretaria/alunos/:id/nome-social' });
        return res.status(500).json({ success: false, error: 'Erro ao registrar o nome social.' });
    }
};

/** DELETE /api/secretaria/alunos/:id/nome-social */
exports.remover = async (req, res) => {
    try {
        const aluno = await alunoDaGestao(req, res);
        if (!aluno) return;
        if (!aluno.nomeSocial) {
            return res.status(404).json({
                success: false,
                error: 'Este aluno não tem nome social registrado.',
            });
        }

        aluno.nomeSocial = undefined;
        aluno.nomeSocialRequerimento = undefined;
        await obs.withSpan('aluno.nomeSocial.remover', {}, () => aluno.save());

        await logAction(req, 'ALUNO_NOME_SOCIAL_REMOVIDO', 'Alunos', {
            recursoId: String(aluno._id),
            descricao: `Nome social removido do aluno ${aluno._id}.`,
        });

        return res.json({ success: true });
    } catch (err) {
        logger.error('[NomeSocial] Falha ao remover', { err, action: 'nomeSocial.remover' });
        obs.captureException(err, { rota: 'DELETE /api/secretaria/alunos/:id/nome-social' });
        return res.status(500).json({ success: false, error: 'Erro ao remover o nome social.' });
    }
};
