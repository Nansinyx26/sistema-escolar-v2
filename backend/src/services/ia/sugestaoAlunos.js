'use strict';

/**
 * sugestaoAlunos.js — busca de aluno por nome digitado (autocomplete + chatbot).
 *
 * O PROBLEMA QUE ESTE MÓDULO RESOLVE
 * ----------------------------------
 * A resolução de aluno do chatbot montava `new RegExp(trecho, 'i')` e procurava
 * esse trecho em QUALQUER posição do nome, palavra por palavra da mensagem. Duas
 * consequências, as duas visíveis para quem usa:
 *
 *   1. "quais as notas do joão" — a primeira palavra que sobrava do filtro de
 *      stop-words era "as", e "as" casa "Cássia", "Vasconcelos", "Anastácia".
 *      A busca respondia com nomes reais do banco e sem nenhuma relação com o
 *      que foi digitado. É a "lista aleatória" relatada.
 *   2. O acento era normalizado numa variável (`normalizedTrecho`) que nunca
 *      era usada na consulta: quem digitava "joao" não achava "João".
 *
 * A REGRA AGORA
 * -------------
 * Igual à de um autocomplete de buscador, em duas etapas e nesta ordem:
 *
 *   1ª  nomes que COMEÇAM com o texto (`^texto`, sem acento, sem caixa) —
 *       consulta ancorada, que o índice `{escolaId, nomeNormalizado}` resolve
 *       por intervalo em vez de varrer a coleção;
 *   2ª  só se a primeira não encheu o limite, nomes que CONTÊM o texto.
 *
 * O resultado das duas é reordenado por `ordenarSugestoes` (começa com > começa
 * uma palavra > contém, e alfabética dentro de cada grupo), deduplicado por id
 * e cortado no limite. Nada entra na lista sem casar com o texto digitado.
 *
 * ESCOPO DE ACESSO
 * ----------------
 * Este módulo NÃO decide quem pode ver quem: recebe pronto o `filtro` de RBAC
 * de quem chamou (`ChatbotService.enforceRBAC`), que já recorta por escola,
 * turmas do professor ou filhos do responsável. Uma segunda regra de acesso
 * escrita aqui é uma regra a mais para divergir da original.
 */

const Aluno = require('../../models/Aluno');
const busca = require('../../utils/buscaAluno');
const { colapsarEspacos, normalizarNome } = require('../../utils/nomeAluno');

/** Sugestões devolvidas por padrão (o autocomplete mostra até 10). */
const LIMITE_PADRAO = 10;
/** Teto absoluto, mesmo que o cliente peça mais. */
const LIMITE_MAXIMO = 25;
/**
 * Documentos lidos por etapa. Mais que o limite porque a ordem final é decidida
 * em memória; menos que "tudo" porque uma letra só pode casar meia escola.
 */
const CANDIDATOS_POR_ETAPA = 60;
/** Corta a consulta antes que uma varredura ruim segure a conexão. */
const TEMPO_MAXIMO_MS = 1500;
/** Tetos da extração de nome dentro de uma frase. */
const MAX_TOKENS = 6;
const MAX_TENTATIVAS = 8;

/**
 * Palavras que nunca são nome de aluno.
 *
 * Sem esta lista, "as", "de" e "do" viram termo de busca e trazem qualquer
 * nome que os contenha. Estão sem acento porque a comparação é feita sobre o
 * texto normalizado.
 */
// Uma palavra por termo, agrupadas por categoria. Escritas em linhas de texto
// (e não como itens de array) porque o formatador quebra um array de 200
// strings em 200 linhas — e uma lista de palavras se lê melhor em frase.
const PALAVRAS_IGNORADAS = new Set(
    [
        // artigos, preposições, pronomes e conectivos
        'a as o os um uma uns umas de da do das dos em na no nas nos ao aos e ou que com sem',
        'por para pra pro sobre ate desde entre del ele ela eles elas esse essa este esta',
        'isso isto aquele aquela meu minha meus minhas seu sua seus suas dele dela me te se',
        'lhe vos',
        // verbos e advérbios frequentes na pergunta
        'esta estao era foi sao tem tenho temos ter ver quero queria preciso pode poderia',
        'gostaria saber mostrar mostra informar consultar buscar procurar diga fala faz',
        'ja so nao sim mais menos muito pouco bem mal hoje ontem amanha agora favor',
        'obrigado obrigada ola oi como qual quais quem quando onde quanto quantos quantas',
        'vc voce vcs anda vai',
        // vocabulário do domínio (o que se pergunta, não de quem)
        'nota notas media medias boletim falta faltas presenca presencas frequencia',
        'comunicado comunicados aviso avisos horario horarios grade aula aulas professor',
        'professora professores turma turmas sala salas aluno aluna alunos alunas filho',
        'filha filhos filhas escola desempenho rendimento resumo situacao bimestre prova',
        'provas materia materias disciplina disciplinas reuniao evento eventos',
    ]
        .join(' ')
        .split(' ')
);

/**
 * Nome exibido do aluno. `sobrenome` existe porque a importação da SEDUC separa
 * as duas metades — ignorá-lo mostra "João" onde o cadastro diz "João Pedro".
 */
function nomeExibicao(aluno) {
    return colapsarEspacos(`${aluno.nome || ''} ${aluno.sobrenome || ''}`);
}

/** Documento do Mongo → item de sugestão. */
function paraSugestao(aluno) {
    return {
        id: String(aluno._id),
        nome: nomeExibicao(aluno),
        matricula: aluno.matricula || '',
        turma: aluno.turma || aluno.turmaId || '',
        ativo: aluno.ativo !== false,
    };
}

/**
 * Quebra a frase nas palavras que podem ser nome e devolve as janelas
 * contíguas, da mais longa para a mais curta.
 *
 * "notas do joão pedro" → ["joão pedro", "joão", "pedro"]. A janela mais longa
 * primeiro é o que faz "João Pedro" ganhar de "João" quando os dois existem.
 *
 * @param {string} texto
 * @returns {string[]}
 */
function janelasDeNome(texto) {
    const tokens = busca
        .termosDe(texto)
        // Pontuação em volta da palavra ("joão?", "pedro,") não faz parte do
        // nome — e, se sobrar, o `escapeRegex` a leva para dentro da consulta.
        .map((token) => token.replace(/[^\p{L}\p{N}'-]/gu, ''))
        .filter((token) => token && !PALAVRAS_IGNORADAS.has(normalizarNome(token)))
        .slice(0, MAX_TOKENS);

    const janelas = [];
    for (let tamanho = tokens.length; tamanho >= 1; tamanho--) {
        for (let inicio = 0; inicio + tamanho <= tokens.length; inicio++) {
            janelas.push(tokens.slice(inicio, inicio + tamanho).join(' '));
        }
    }
    return janelas;
}

/**
 * Uma consulta ao banco, já recortada pelo filtro de acesso de quem chamou.
 * `sort` por `nomeNormalizado` acompanha o índice usado pela etapa de prefixo e
 * deixa o corte de candidatos determinístico (sempre os mesmos, em ordem).
 */
async function consultar(filtro, condicao, ordenar) {
    if (!condicao) return [];
    const consulta = Aluno.find(busca.combinar(filtro || {}, condicao))
        .select('_id nome sobrenome matricula turma turmaId ativo')
        .limit(CANDIDATOS_POR_ETAPA)
        .maxTimeMS(TEMPO_MAXIMO_MS);
    if (ordenar) consulta.sort({ nomeNormalizado: 1 });
    return consulta.lean();
}

/**
 * Busca alunos por um termo já isolado (sem a frase em volta).
 *
 * @param {Object} params
 * @param {string} params.termo               texto digitado
 * @param {Object} params.filtro              filtro de acesso (RBAC + escola)
 * @param {number} [params.limite]            máximo de sugestões
 * @param {number} [params.relevanciaMaxima]  até que grau aceitar (ver RELEVANCIA)
 * @returns {Promise<Array>} sugestões ordenadas
 */
async function buscarPorTermo({ termo, filtro, limite = LIMITE_PADRAO, relevanciaMaxima }) {
    const texto = colapsarEspacos(termo);
    if (!texto) return [];

    // O teto aqui é o do que dá para ler do banco numa etapa. O teto do que um
    // CLIENTE pode pedir (LIMITE_MAXIMO) é aplicado no controller: quem chama
    // de dentro do servidor — a ferramenta `buscarAluno`, que depois ainda
    // filtra cada candidato pelo guard de acesso — precisa de folga maior.
    const teto = Math.min(Math.max(Number(limite) || LIMITE_PADRAO, 1), CANDIDATOS_POR_ETAPA);

    // 1ª etapa — quem COMEÇA com o texto. Ancorada, portanto barata.
    const porInicio = await consultar(filtro, busca.filtroDePrefixo(texto), true);
    let candidatos = porInicio.map(paraSugestao);

    let ordenadas = busca.ordenarSugestoes(candidatos, texto, { limite: teto, relevanciaMaxima });

    // 2ª etapa — só quando a primeira não encheu a lista. `filtroDeBusca` casa
    // cada termo em qualquer posição e em qualquer ordem ("silva joao" acha
    // "João da Silva"), e a reordenação abaixo mantém o começo do nome no topo.
    if (ordenadas.length < teto) {
        const porConteudo = await consultar(
            filtro,
            busca.filtroDeBusca(texto, { incluirSala: false }),
            false
        );
        candidatos = candidatos.concat(porConteudo.map(paraSugestao));
        ordenadas = busca.ordenarSugestoes(candidatos, texto, { limite: teto, relevanciaMaxima });
    }

    // Matrícula (RA). A ordenação acima pontua NOME — um número nunca casa com
    // um nome e sairia da lista, apagando a busca por RA que o chatbot sempre
    // teve. Quem digita dígitos está procurando por RA, então esses entram
    // depois dos casamentos por nome, sem competir com eles.
    if (ordenadas.length < teto && /\d/.test(texto)) {
        const chave = normalizarNome(texto);
        const jaListados = new Set(ordenadas.map((a) => a.id));
        const porMatricula = candidatos
            .filter((a) => !jaListados.has(a.id) && normalizarNome(a.matricula).startsWith(chave))
            .sort((a, b) => String(a.matricula).localeCompare(String(b.matricula)))
            .map((a) => ({ ...a, relevancia: busca.RELEVANCIA.CONTEM }));
        for (const aluno of porMatricula) {
            if (ordenadas.length >= teto) break;
            if (jaListados.has(aluno.id)) continue;
            jaListados.add(aluno.id);
            ordenadas.push(aluno);
        }
    }

    return ordenadas;
}

/**
 * Busca alunos a partir do que a pessoa escreveu — seja o nome direto ("Joã")
 * ou uma frase inteira ("quais as notas do joão pedro?").
 *
 * Tenta primeiro o texto inteiro (o caso do campo de busca) e, se não achar
 * nada, as janelas de nome extraídas da frase, da mais longa para a mais curta
 * (o caso do chat). Devolve também qual trecho produziu o resultado, para o
 * front destacar exatamente esse pedaço e substituí-lo ao escolher um aluno.
 *
 * @param {Object} params
 * @param {string} params.texto               texto digitado
 * @param {Object} params.filtro              filtro de acesso (RBAC + escola)
 * @param {number} [params.limite]            máximo de sugestões
 * @param {number} [params.minTermo]          tamanho mínimo do trecho buscado
 * @param {number} [params.relevanciaMaxima]  até que grau aceitar (ver RELEVANCIA)
 * @returns {Promise<{ termo: string, alunos: Array, buscavel: boolean }>}
 */
async function sugerirAlunos({
    texto,
    filtro,
    limite = LIMITE_PADRAO,
    minTermo = 1,
    relevanciaMaxima,
}) {
    const bruto = colapsarEspacos(texto).slice(0, 120);
    if (!bruto || bruto.length < minTermo) return { termo: bruto, alunos: [], buscavel: false };

    const janelas = janelasDeNome(bruto);
    // `buscavel` diz se sobrou alguma palavra que possa ser nome. É o que
    // separa "não achei ninguém com esse nome" de "isto não era um nome" — sem
    // essa distinção, digitar "oi" faria o campo anunciar
    // "Nenhum aluno encontrado".
    const buscavel = janelas.length > 0;
    // Nenhuma palavra sobrou: o texto é só pergunta ("quais as notas", "e as
    // faltas?"). Não há o que procurar, e cada tecla digitada numa frase
    // dessas custaria duas consultas ao banco por nada.
    if (!buscavel) return { termo: bruto, alunos: [], buscavel: false };

    const tentativas = [];
    const registrar = (candidato) => {
        const valor = colapsarEspacos(candidato);
        if (valor.length >= minTermo && !tentativas.includes(valor)) tentativas.push(valor);
    };

    registrar(bruto);
    for (const janela of janelas) registrar(janela);

    for (const termo of tentativas.slice(0, MAX_TENTATIVAS)) {
        const alunos = await buscarPorTermo({ termo, filtro, limite, relevanciaMaxima });
        if (alunos.length) return { termo, alunos, buscavel: true };
    }

    return { termo: janelas[0] || bruto, alunos: [], buscavel };
}

module.exports = {
    LIMITE_PADRAO,
    LIMITE_MAXIMO,
    janelasDeNome,
    nomeExibicao,
    sugerirAlunos,
};
