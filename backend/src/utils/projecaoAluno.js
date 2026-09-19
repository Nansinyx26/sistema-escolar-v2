/**
 * projecaoAluno.js — o que cada perfil recebe do cadastro de um aluno (Issue #388).
 *
 * PONTO ÚNICO. Toda resposta que devolve documento de aluno passa por aqui:
 * listagem, leitura, respostas de escrita e `populate` (a chamada de faltas).
 * A autorização de ACESSO ao aluno continua em `assertAcessoAoAluno`; esta
 * camada decide QUAIS CAMPOS saem depois que o acesso foi concedido.
 *
 * LISTA FECHADA, por perfil. Campo novo no schema não sai para ninguém até
 * ser acrescentado aqui de propósito — o contrário de apagar campos proibidos,
 * que vaza tudo o que ninguém lembrou de apagar.
 *
 * `codigoSecreto` não está em lista nenhuma: é credencial de vínculo e só sai
 * pela rota da secretaria que existe para exibi-lo.
 *
 * DECISÕES INSTITUCIONAIS (padrão mais protetivo, configurável):
 *   PROFESSOR_VE_DETALHE_DEFICIENCIA=sim  → professor recebe deficiência e
 *       transtornos por extenso; sem isso, só o indicador `necessitaApoio`.
 *   PROFESSOR_VE_RETIRADA=nome            → professor recebe nome e parentesco
 *       das pessoas autorizadas à retirada (nunca o documento); padrão: nada.
 */

const IDENTIFICACAO = [
    '_id',
    'id',
    'escolaId',
    'nome',
    'sobrenome',
    'matricula',
    'raDigito',
    'turma',
    'turmaId',
    'foto',
    'ativo',
    'situacao',
];

// O que o professor lança e consulta no dia a dia da turma.
const PEDAGOGICO = [
    'nivel',
    'nivelBimestre',
    'condicao',
    'condicaoOutro',
    'observacoes',
    'observacoesBimestre',
    'recuperacaoBimestre',
    'faltasBimestre',
    'mediaInterna',
    'mediaGeral',
    'descricao',
];

// Segurança imediata da criança em sala: alergias.
const SAUDE_ESSENCIAL = ['alergiasAlimentos', 'alergiasRemedio'];

const DEFICIENCIA_DETALHADA = ['pcd', 'deficiencia', 'transtornos'];

// Ficha completa, para quem responde pelo cadastro (secretaria, direção) e para
// o responsável legal, que tem direito de acesso aos dados do próprio filho.
const FICHA = [
    ...IDENTIFICACAO,
    ...PEDAGOGICO,
    ...SAUDE_ESSENCIAL,
    ...DEFICIENCIA_DETALHADA,
    'nomeNormalizado',
    'raUf',
    'nascimento',
    'sexo',
    'nacionalidade',
    'etnia',
    'religiao',
    'codigoInep',
    'cpfAluno',
    'telefone',
    'email',
    'endereco',
    'responsavel',
    'responsavelDados',
    'responsaveis',
    'guardaLegal',
    'pessoasAutorizadasRetirada',
    'autorizacoesEscolares',
    'fichaDocumentoStatus',
    'planoSaude',
    'documentos',
    'lgpdConsentimento',
    'dataMovimentacao',
    'origemCadastro',
    'importacaoId',
    'anonimizadoEm',
    'anonimizadoPor',
    'notas',
    'faltas',
    'createdAt',
    'updatedAt',
];

const CAMPOS_POR_PERFIL = {
    admin: FICHA,
    diretor: FICHA,
    secretaria: FICHA,
    responsavel: FICHA,
    professor: [...IDENTIFICACAO, ...PEDAGOGICO, ...SAUDE_ESSENCIAL, 'createdAt', 'updatedAt'],
};

function professorVeDetalheDeficiencia() {
    return String(process.env.PROFESSOR_VE_DETALHE_DEFICIENCIA || '').toLowerCase() === 'sim';
}

function professorVeRetirada() {
    return String(process.env.PROFESSOR_VE_RETIRADA || '').toLowerCase() === 'nome';
}

function necessitaApoio(aluno) {
    return Boolean(
        aluno.pcd ||
            String(aluno.deficiencia || '').trim() ||
            (Array.isArray(aluno.transtornos) && aluno.transtornos.length)
    );
}

/** Converte documento Mongoose em objeto simples (lean passa direto). */
function simples(doc) {
    if (!doc || typeof doc !== 'object') return doc;
    if (typeof doc.toObject === 'function') return doc.toObject({ flattenMaps: true });
    return doc;
}

/**
 * Devolve só os campos que o perfil pode receber.
 * Perfil desconhecido recebe apenas a identificação (fechado por omissão).
 *
 * @param {object} aluno  documento lean ou Mongoose
 * @param {string} perfil perfil de quem recebe
 * @returns {object}
 */
function projetarAluno(aluno, perfil) {
    const origem = simples(aluno);
    if (!origem || typeof origem !== 'object') return origem;

    const chave = String(perfil || '').toLowerCase();
    const campos = CAMPOS_POR_PERFIL[chave] || IDENTIFICACAO;
    const saida = {};
    for (const campo of campos) {
        if (origem[campo] !== undefined) saida[campo] = origem[campo];
    }

    if (chave === 'professor') {
        saida.necessitaApoio = necessitaApoio(origem);
        if (professorVeDetalheDeficiencia()) {
            for (const campo of DEFICIENCIA_DETALHADA) {
                if (origem[campo] !== undefined) saida[campo] = origem[campo];
            }
        }
        if (professorVeRetirada() && Array.isArray(origem.pessoasAutorizadasRetirada)) {
            saida.pessoasAutorizadasRetirada = origem.pessoasAutorizadasRetirada.map((p) => ({
                nome: p?.nome,
                parentesco: p?.parentesco,
            }));
        }
    }

    return saida;
}

/** Atalho para listas. */
function projetarAlunos(lista, perfil) {
    return (lista || []).map((a) => projetarAluno(a, perfil));
}

module.exports = {
    projetarAluno,
    projetarAlunos,
    CAMPOS_POR_PERFIL,
};
