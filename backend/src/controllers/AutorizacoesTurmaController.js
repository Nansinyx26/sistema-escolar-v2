/**
 * AutorizacoesTurmaController — situação das autorizações da turma para o
 * professor (Issue #496).
 *
 * O professor que conduz um passeio ou uma atividade física precisa saber se
 * a família autorizou. Ele vê SÓ a situação (aceita, recusada, sem resposta)
 * de cada tipo, para os alunos das turmas dele — nunca o arquivo, nem
 * detalhe como dose de medicamento ou contato de motorista, nem data.
 *
 * E só se a direção da escola decidir assim (`Escola.professorVeAutorizacoes`,
 * desligado por padrão).
 */
const Escola = require('../models/Escola');
const Aluno = require('../models/Aluno');
const Autorizacao = require('../models/Autorizacao');
const { consolidarAutorizacoesAluno } = require('./SecretariaAutorizacoesController');

const DESLIGADO = {
    success: false,
    codigo: 'AUTORIZACOES_PROFESSOR_DESLIGADO',
    error: 'A direção da escola não liberou a consulta das autorizações para professores.',
};

async function liberadoNaEscola(escolaId) {
    if (!escolaId) return false;
    const escola = await Escola.findById(String(escolaId)).select('professorVeAutorizacoes').lean();
    return escola?.professorVeAutorizacoes === true;
}

/** GET /api/turmas/autorizacoes/situacao — só professor. */
exports.situacaoDaTurma = async (req, res) => {
    try {
        if (req.user?.perfil !== 'professor' || !req.horizontalFilter) {
            return res.status(403).json({ success: false, error: 'Acesso negado.' });
        }
        if (!(await liberadoNaEscola(req.escolaId))) return res.status(403).json(DESLIGADO);

        const alunos = await Aluno.find({
            escolaId: String(req.escolaId),
            ativo: { $ne: false },
            ...req.horizontalFilter,
        })
            .select('_id nome sobrenome turma turmaId autorizacoesEscolares updatedAt createdAt')
            .sort({ turma: 1, nome: 1 })
            .lean();

        const ids = alunos.map((a) => String(a._id));
        const docs = await Autorizacao.find({ alunoId: { $in: ids } }).lean();
        const porAluno = new Map();
        for (const d of docs) {
            const chave = String(d.alunoId);
            if (!porAluno.has(chave)) porAluno.set(chave, []);
            porAluno.get(chave).push(d);
        }

        const data = alunos.map((a) => {
            const { autorizacoes } = consolidarAutorizacoesAluno(
                a,
                porAluno.get(String(a._id)) || []
            );
            return {
                alunoId: String(a._id),
                nome: [a.nome, a.sobrenome].filter(Boolean).join(' '),
                turma: a.turma || a.turmaId || '',
                // Lista fechada: tipo, título e situação. Nada de detalhe ou data.
                autorizacoes: autorizacoes.map((x) => ({
                    tipo: x.tipo,
                    titulo: x.titulo,
                    situacao: x.status,
                })),
            };
        });

        return res.json({ success: true, data });
    } catch {
        return res
            .status(500)
            .json({ success: false, error: 'Erro ao consultar as autorizações.' });
    }
};

exports.liberadoNaEscola = liberadoNaEscola;
