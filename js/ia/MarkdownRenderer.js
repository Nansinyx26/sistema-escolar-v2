/**
 * MarkdownRenderer.js — converte o Markdown do assistente em HTML seguro.
 *
 * POR QUE UM RENDERIZADOR PRÓPRIO
 * -------------------------------
 * O repositório não tem `marked` nem `markdown-it` empacotados, e o subconjunto
 * que o copiloto realmente produz (títulos, listas, tabelas, código, links,
 * ênfase) cabe em ~200 linhas. Trazer uma dependência de ~50 KB para isso não se
 * justificava — e o destaque de sintaxe, que é o pedaço pesado de verdade,
 * entra por lazy loading na Fase 5.
 *
 * SEGURANÇA
 * ---------
 * Resposta de modelo de linguagem é conteúdo NÃO CONFIÁVEL: o texto pode ter
 * vindo, no futuro, de um comunicado ou de um nome de aluno que alguém plantou.
 * Duas barreiras, nesta ordem:
 *
 *   1. Todo o texto de entrada é escapado ANTES de qualquer conversão, então
 *      nenhuma tag do modelo sobrevive à travessia — só as que este arquivo
 *      constrói existem no resultado.
 *   2. O HTML final ainda passa por DOMPurify com allowlist estreita, o que
 *      cobre qualquer erro meu na etapa 1.
 *
 * DOMPurify já está no repositório em js/libs/purify.min.js.
 *
 * LIMITE CONHECIDO: listas aninhadas são achatadas em um nível só. O modelo
 * raramente as produz e suportá-las dobraria a complexidade do laço principal.
 */

const TAGS_PERMITIDAS = [
    'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'hr',
    'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'a', 'span'
];

const ATRIBUTOS_PERMITIDOS = ['href', 'target', 'rel', 'class', 'data-idioma'];

/**
 * Sentinela para proteger trechos de código durante a conversão inline.
 * Usa a Área de Uso Privado do Unicode: nada vindo do modelo ou de um dado do
 * banco colide com ela por acaso — um marcador textual comum colidiria.
 */
const SENTINELA = '';

/** Escapa os quatro caracteres que dariam significado de marcação ao texto. */
function escapar(texto) {
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Converte as marcações que valem dentro de uma linha.
 * Roda sempre DEPOIS do escape — o que chega aqui já não tem HTML vivo.
 */
function inline(texto) {
    // A sentinela é reservada: se aparecer no texto de entrada, some antes de
    // poder ser confundida com um marcador nosso.
    let saida = String(texto).split(SENTINELA).join('');

    // Código inline primeiro: o conteúdo dele não deve receber negrito nem link.
    const trechosCodigo = [];
    const RE_CODIGO_INLINE = new RegExp('`([^`\\n]+)`', 'g');
    saida = saida.replace(RE_CODIGO_INLINE, (_, conteudo) => {
        trechosCodigo.push(conteudo);
        return SENTINELA + (trechosCodigo.length - 1) + SENTINELA;
    });

    // [texto](url) — só http(s), caminho absoluto e âncora. `javascript:` não passa.
    saida = saida.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (completo, rotulo, url) => {
        const limpa = url.trim();
        if (!/^(https?:\/\/|\/|#)/i.test(limpa)) return completo;
        const externo = /^https?:\/\//i.test(limpa);
        const extras = externo ? ' target="_blank" rel="noopener noreferrer"' : '';
        return '<a href="' + limpa + '"' + extras + '>' + rotulo + '</a>';
    });

    saida = saida
        .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/~~([^~]+)~~/g, '<del>$1</del>');

    const RE_RESTAURAR = new RegExp(SENTINELA + '(\\d+)' + SENTINELA, 'g');
    saida = saida.replace(RE_RESTAURAR, (_, i) => '<code>' + trechosCodigo[Number(i)] + '</code>');

    return saida;
}

/** Uma linha de tabela `| a | b |` → array de células. */
function celulas(linha) {
    return linha
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map(c => c.trim());
}

const ehSeparadorDeTabela = (linha) =>
    /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(linha) && linha.includes('-');

/**
 * Markdown → HTML (ainda não sanitizado).
 * Percorre as linhas uma vez, agrupando blocos conforme aparecem.
 */
function paraHtml(markdown) {
    const linhas = escapar(markdown).split('\n');
    const partes = [];

    let i = 0;
    let paragrafo = [];

    const fecharParagrafo = () => {
        if (paragrafo.length === 0) return;
        partes.push('<p>' + inline(paragrafo.join(' ')) + '</p>');
        paragrafo = [];
    };

    const RE_CERCA_ABRE = new RegExp('^\\s*```(\\w*)\\s*$');
    const RE_CERCA_FECHA = new RegExp('^\\s*```\\s*$');

    while (i < linhas.length) {
        const linha = linhas[i];

        // ── Bloco de código cercado ──────────────────────────────────────────
        const cerca = RE_CERCA_ABRE.exec(linha);
        if (cerca) {
            fecharParagrafo();
            const idioma = cerca[1] || '';
            const corpo = [];
            i++;
            while (i < linhas.length && !RE_CERCA_FECHA.test(linhas[i])) {
                corpo.push(linhas[i]);
                i++;
            }
            i++; // consome a cerca de fechamento (ou o fim do texto)
            const classe = idioma ? ' class="linguagem-' + idioma + '"' : '';
            // `data-idioma` alimenta o botão de copiar e o destaque da Fase 5.
            partes.push('<pre data-idioma="' + idioma + '"><code' + classe + '>' + corpo.join('\n') + '</code></pre>');
            continue;
        }

        // ── Linha horizontal ─────────────────────────────────────────────────
        if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(linha)) {
            fecharParagrafo();
            partes.push('<hr>');
            i++;
            continue;
        }

        // ── Título ───────────────────────────────────────────────────────────
        const titulo = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(linha);
        if (titulo) {
            fecharParagrafo();
            const nivel = titulo[1].length;
            partes.push('<h' + nivel + '>' + inline(titulo[2].trim()) + '</h' + nivel + '>');
            i++;
            continue;
        }

        // ── Tabela ───────────────────────────────────────────────────────────
        if (linha.includes('|') && i + 1 < linhas.length && ehSeparadorDeTabela(linhas[i + 1])) {
            fecharParagrafo();
            const cabecalho = celulas(linha);
            i += 2;
            const corpo = [];
            while (i < linhas.length && linhas[i].includes('|') && linhas[i].trim()) {
                corpo.push(celulas(linhas[i]));
                i++;
            }
            const th = cabecalho.map(c => '<th>' + inline(c) + '</th>').join('');
            const tr = corpo
                .map(l => '<tr>' + l.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>')
                .join('');
            // A rolagem horizontal do wrapper é o que impede a tabela larga de
            // empurrar a página inteira no celular.
            partes.push(
                '<div class="ia-tabela-wrap"><table><thead><tr>' + th +
                '</tr></thead><tbody>' + tr + '</tbody></table></div>'
            );
            continue;
        }

        // ── Citação ──────────────────────────────────────────────────────────
        // O `>` já virou `&gt;` no escape, por isso o teste é sobre a entidade.
        if (/^\s*&gt;\s?/.test(linha)) {
            fecharParagrafo();
            const corpo = [];
            while (i < linhas.length && /^\s*&gt;\s?/.test(linhas[i])) {
                corpo.push(linhas[i].replace(/^\s*&gt;\s?/, ''));
                i++;
            }
            partes.push('<blockquote>' + inline(corpo.join(' ')) + '</blockquote>');
            continue;
        }

        // ── Listas ───────────────────────────────────────────────────────────
        const RE_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
        const marcador = RE_ITEM.exec(linha);
        if (marcador) {
            fecharParagrafo();
            const ordenada = /\d/.test(marcador[2]);
            const itens = [];
            while (i < linhas.length) {
                const m = RE_ITEM.exec(linhas[i]);
                if (!m) break;
                if (/\d/.test(m[2]) !== ordenada) break;
                itens.push(inline(m[3].trim()));
                i++;
            }
            const tag = ordenada ? 'ol' : 'ul';
            partes.push('<' + tag + '>' + itens.map(t => '<li>' + t + '</li>').join('') + '</' + tag + '>');
            continue;
        }

        // ── Linha em branco / parágrafo ──────────────────────────────────────
        if (!linha.trim()) {
            fecharParagrafo();
        } else {
            paragrafo.push(linha.trim());
        }
        i++;
    }

    fecharParagrafo();
    return partes.join('\n');
}

/**
 * Renderiza Markdown para HTML seguro, pronto para innerHTML.
 *
 * @param {string} markdown
 * @returns {string} HTML sanitizado
 */
export function renderizarMarkdown(markdown) {
    if (!markdown) return '';

    const html = paraHtml(markdown);

    // Checagem por VALOR, não por `typeof`: um carregamento parcial pode deixar
    // o global como `null` ou como um objeto sem `sanitize`, e nesses casos o
    // `typeof` seria 'object' — a guarda passaria e o renderizador quebraria na
    // linha seguinte, justamente quando a segunda barreira não está lá.
    if (!window.DOMPurify || typeof window.DOMPurify.sanitize !== 'function') {
        // Sem a segunda barreira disponível não entregamos HTML: degradamos para
        // texto puro. Uma falha de carregamento não pode virar um XSS.
        console.error('[IA] DOMPurify não carregado — exibindo resposta como texto puro.');
        return '<p>' + escapar(markdown) + '</p>';
    }

    return window.DOMPurify.sanitize(html, {
        ALLOWED_TAGS: TAGS_PERMITIDAS,
        ALLOWED_ATTR: ATRIBUTOS_PERMITIDOS,
        // `target="_blank"` dos links externos precisa sobreviver ao sanitize.
        ADD_ATTR: ['target']
    });
}

export { escapar };

// ─────────────────────────────────────────────────────────────────────────────
// Destaque de sintaxe sob demanda
// ─────────────────────────────────────────────────────────────────────────────

/**
 * O highlight.js pesa ~120 KB e a maior parte das conversas não tem uma linha
 * de código. Por isso ele só é buscado quando o PRIMEIRO bloco de código
 * aparece na tela, e uma única vez por sessão.
 *
 * A biblioteca não está no repositório; vem do cdnjs, que já está na allowlist
 * de `script-src` da CSP. Se a rede falhar (ou a página estiver offline pelo
 * service worker), o bloco continua legível com o estilo próprio — o realce é
 * um ganho estético, nunca um requisito.
 */
const CDN_HLJS = 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js';

let promessaHljs = null;

function carregarHljs() {
    if (promessaHljs) return promessaHljs;

    promessaHljs = new Promise((resolve) => {
        if (window.hljs) return resolve(window.hljs);

        const script = document.createElement('script');
        script.src = CDN_HLJS;
        script.async = true;
        script.onload = () => resolve(window.hljs || null);
        script.onerror = () => {
            console.warn('[IA] Destaque de sintaxe indisponível — os blocos seguem sem realce.');
            resolve(null);
        };
        document.head.appendChild(script);
    });

    return promessaHljs;
}

/**
 * Aplica o realce aos blocos de código de um elemento já renderizado.
 * Idempotente: blocos já processados são ignorados.
 *
 * @param {HTMLElement} raiz
 */
export async function realcarCodigo(raiz) {
    const blocos = raiz.querySelectorAll('pre > code:not([data-realcado])');
    if (blocos.length === 0) return;

    const hljs = await carregarHljs();
    if (!hljs) return;

    for (const bloco of blocos) {
        bloco.setAttribute('data-realcado', '1');
        try {
            hljs.highlightElement(bloco);
        } catch {
            // Linguagem desconhecida: o bloco fica sem realce, e só.
        }
    }
}
