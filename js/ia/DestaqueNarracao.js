/**
 * DestaqueNarracao.js — marca, dentro da bolha da resposta, a frase que está
 * sendo narrada neste instante.
 *
 * É o que fecha a promessa de "a narração acompanha o texto": sem a marca, o
 * áudio e a tela andam juntos mas ninguém consegue apontar ONDE. Com ela, quem
 * está lendo sabe em que ponto a voz está, e quem está só ouvindo consegue
 * voltar para o texto sem se perder.
 *
 * POR QUE A CSS CUSTOM HIGHLIGHT API, E NÃO UM `<span>`
 * -----------------------------------------------------
 * Envolver o trecho num elemento significaria mexer no HTML que o
 * MarkdownRenderer acabou de produzir — e a bolha é REPINTADA a cada ~30ms
 * enquanto a resposta chega. Cada repintura desfaria o span, e cada marca
 * refeita brigaria com a seleção de texto e com a árvore de acessibilidade.
 *
 * `CSS.highlights` pinta um Range sem tocar no DOM: a repintura simplesmente
 * invalida a marca, que é recalculada por cima do HTML novo. Onde a API não
 * existe (Firefox antigo, Safari < 17.2) tudo aqui vira no-op — a narração
 * segue inteira, só sem a marca. É enfeite útil, nunca requisito.
 *
 * COMO O TRECHO É REENCONTRADO
 * ----------------------------
 * O trecho falado nasce do Markdown de origem; o que está na tela é o HTML
 * renderizado. Os índices de um NÃO valem no outro (a marcação sumiu, listas
 * viraram itens, links viraram só o rótulo). Então a busca é feita pelo
 * PRÓPRIO TEXTO, com espaços normalizados, e ancorada em duas pontas: o começo
 * do trecho e o fim dele. Se qualquer uma das âncoras não aparecer — o caso
 * típico é um trecho que continha um bloco de código, que não é narrado — a
 * marca é apagada em vez de cair no lugar errado.
 */

const NOME_DESTAQUE = 'ia-narracao';

/** Tamanho das âncoras de início e fim, em caracteres. */
const TAM_ANCORA = 48;

/** A API existe neste navegador? */
export function suportaDestaque() {
    return (
        typeof CSS !== 'undefined' &&
        typeof CSS.highlights !== 'undefined' &&
        typeof window.Highlight === 'function'
    );
}

/**
 * Achata os nós de texto de um elemento numa única string normalizada, junto
 * com o mapa que devolve cada posição dessa string ao par (nó, deslocamento).
 *
 * Normalizar aqui é obrigatório: o Markdown renderizado quebra linha e indenta
 * conforme a estrutura, então o mesmo parágrafo tem espaçamento diferente na
 * origem e na tela. Sem colapsar os brancos, nenhuma frase de mais de uma linha
 * seria encontrada.
 *
 * @param {HTMLElement} raiz
 */
function achatar(raiz) {
    const caminhador = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
    let texto = '';
    /** @type {Array<{no: Text, dentro: number}>} */
    const mapa = [];
    let ultimoFoiEspaco = true; // corta também o branco inicial

    let no = caminhador.nextNode();
    while (no) {
        const bruto = no.nodeValue || '';
        for (let i = 0; i < bruto.length; i++) {
            const c = bruto[i];
            if (/\s/.test(c)) {
                if (ultimoFoiEspaco) continue;
                ultimoFoiEspaco = true;
                texto += ' ';
            } else {
                ultimoFoiEspaco = false;
                texto += c;
            }
            mapa.push({ no, dentro: i });
        }
        no = caminhador.nextNode();
    }

    return { texto, mapa };
}

/** Mesma normalização de `achatar`, para o lado do texto procurado. */
function normalizar(texto) {
    return String(texto || '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Some com a marca. Seguro de chamar em navegador sem a API. */
export function limparDestaque() {
    if (!suportaDestaque()) return;
    CSS.highlights.delete(NOME_DESTAQUE);
}

/**
 * Marca `fala` dentro de `raiz`.
 *
 * @param {HTMLElement|null} raiz bolha da resposta
 * @param {string} fala trecho narrado, já sem marcação
 * @param {number} [aPartirDe=0] posição mínima da busca no texto achatado.
 *   A narração só anda para a frente, então buscar a partir do fim do trecho
 *   anterior evita casar com uma repetição lá atrás — e é mais barato.
 * @returns {number} posição final do trecho marcado, para alimentar o
 *   `aPartirDe` da próxima chamada; 0 quando não deu para marcar
 */
export function destacar(raiz, fala, aPartirDe = 0) {
    if (!suportaDestaque() || !raiz) return 0;

    const alvo = normalizar(fala);
    if (alvo.length < 4) {
        limparDestaque();
        return 0;
    }

    const { texto, mapa } = achatar(raiz);
    const inicioBusca = Math.min(Math.max(0, aPartirDe), texto.length);

    const ancoraInicio = alvo.slice(0, Math.min(TAM_ANCORA, alvo.length));
    let inicio = texto.indexOf(ancoraInicio, inicioBusca);
    // Segunda tentativa desde o começo: a bolha pode ter sido repintada com um
    // HTML novo (um bloco de código que fechou, uma tabela que se formou) e as
    // posições de antes deixaram de valer.
    if (inicio === -1 && inicioBusca > 0) inicio = texto.indexOf(ancoraInicio);
    if (inicio === -1) {
        limparDestaque();
        return 0;
    }

    const ancoraFim = alvo.slice(-Math.min(TAM_ANCORA, alvo.length));
    const posFim = texto.indexOf(ancoraFim, inicio);
    const fim =
        posFim === -1 ? Math.min(texto.length, inicio + alvo.length) : posFim + ancoraFim.length;

    if (fim <= inicio || !mapa[inicio] || !mapa[fim - 1]) {
        limparDestaque();
        return 0;
    }

    try {
        const faixa = document.createRange();
        faixa.setStart(mapa[inicio].no, mapa[inicio].dentro);
        faixa.setEnd(mapa[fim - 1].no, mapa[fim - 1].dentro + 1);
        CSS.highlights.set(NOME_DESTAQUE, new window.Highlight(faixa));
    } catch (e) {
        // Nó saiu do documento entre o achatamento e a marca (repintura no meio).
        console.warn('[IA] Não foi possível marcar o trecho narrado:', e?.message);
        limparDestaque();
        return 0;
    }

    return fim;
}
