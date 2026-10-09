/**
 * catalogo.js — ferramentas que o professor só usa com autorização da direção
 * (Issue #720).
 *
 * O catálogo mora no CÓDIGO, e não no banco, de propósito: uma ferramenta só é
 * controlada de verdade quando a rota dela passa por `exigirFerramenta(id)`.
 * Uma entrada cadastrada pela tela, sem rota protegida, mostraria um cadeado
 * que não tranca nada. Acrescentar uma ferramenta é, portanto, duas linhas:
 * a entrada aqui e o middleware na rota — a página da direção e a conta do
 * professor leem esta lista pela API e passam a mostrá-la sozinhas.
 *
 * `id` é a chave gravada no banco (`permissoes_ferramentas.ferramentaId`):
 * depois de publicada, NÃO muda — trocar o id apaga, na prática, todas as
 * autorizações já concedidas para ela.
 */

const CATEGORIAS = Object.freeze([
    Object.freeze({ id: 'ia', nome: 'Inteligência Artificial' }),
    Object.freeze({ id: 'gestao', nome: 'Gestão Escolar' }),
    Object.freeze({ id: 'pedagogica', nome: 'Ferramentas Pedagógicas' }),
    Object.freeze({ id: 'outras', nome: 'Outras' }),
]);

const FERRAMENTAS = Object.freeze(
    [
        {
            id: 'ia.assistente',
            nome: 'Assistente de IA',
            categoria: 'ia',
            descricao:
                'Conversa com o assistente da escola, na página do assistente e no chat das telas da equipe.',
        },
        {
            id: 'ia.atividades',
            nome: 'Geração de atividades com IA',
            categoria: 'ia',
            descricao: 'O assistente cria atividades e projetos maker para as turmas do professor.',
        },
        {
            id: 'ia.plano-aula',
            nome: 'Plano de aula com IA',
            categoria: 'ia',
            descricao: 'Sugestão de plano de aula escrita pela IA.',
        },
        {
            id: 'ia.plano-estudo',
            nome: 'Plano de estudo (PEI) com IA',
            categoria: 'ia',
            descricao: 'Sugestão de plano de estudo individual para um aluno, escrita pela IA.',
        },
        {
            id: 'gestao.autorizacoes-pais',
            nome: 'Autorizações dos Pais',
            categoria: 'gestao',
            // Mesmo recorte da Issue #496: situação, nunca documento, detalhe
            // de saúde ou data.
            descricao:
                'Situação das autorizações dos alunos das próprias turmas, sem documentos nem dados de saúde.',
        },
    ].map((f) => Object.freeze(f))
);

const POR_ID = new Map(FERRAMENTAS.map((f) => [f.id, f]));

/** @returns {object|null} a ferramenta do catálogo, ou null se não existir */
function ferramentaPorId(id) {
    return POR_ID.get(String(id || '')) || null;
}

function existeFerramenta(id) {
    return POR_ID.has(String(id || ''));
}

/** Catálogo para a API: categorias na ordem de exibição, cada uma com as suas ferramentas. */
function catalogoPorCategoria() {
    return CATEGORIAS.map((c) => ({
        id: c.id,
        nome: c.nome,
        ferramentas: FERRAMENTAS.filter((f) => f.categoria === c.id).map((f) => ({
            id: f.id,
            nome: f.nome,
            descricao: f.descricao,
        })),
    }));
}

module.exports = {
    CATEGORIAS,
    FERRAMENTAS,
    ferramentaPorId,
    existeFerramenta,
    catalogoPorCategoria,
};
