/**
 * SegmentadorFala.js — corta a resposta que está chegando token a token em
 * trechos que já podem ser narrados.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * A narração antes esperava a resposta inteira: o texto terminava de aparecer
 * na tela, só então saía UMA chamada de TTS com tudo, e só depois o áudio
 * começava. Numa resposta de 1200 caracteres isso é fácil de 6 a 10 segundos
 * de silêncio depois que a última palavra já está escrita — a voz nunca
 * acompanhava a leitura, ela recomeçava do zero quando a leitura tinha
 * acabado.
 *
 * Cortando em frases, a fala começa quando a PRIMEIRA frase fica pronta e daí
 * em diante caminha junto com o texto que continua sendo escrito.
 *
 * O CUSTO QUE MANDA NO TAMANHO DOS TRECHOS
 * ----------------------------------------
 * Cada trecho é uma requisição a `/api/tts/speak`, e essa rota é limitada por
 * hora e por usuário (ver `rateLimiters.js`) porque consome cota paga. Então
 * não dá para cortar a cada frase curta: os trechos CRESCEM conforme a
 * resposta avança (ver PERFIS). O primeiro é curto porque ele é o único que a
 * pessoa espera ouvindo silêncio; do segundo em diante já existe áudio
 * tocando por cima da busca do seguinte, e trecho maior só melhora — menos
 * requisições e menos emendas na prosódia.
 *
 * O que é cobrado pelo provedor é CARACTERE, não requisição, e o total de
 * caracteres falados é o mesmo de antes. O que muda é a contagem de chamadas.
 */

/**
 * Tamanhos por posição do trecho na resposta: mínimo e máximo em caracteres.
 * O último perfil vale para todos os trechos daí em diante.
 *
 * QUEM MANDA AQUI É O MÍNIMO, não o máximo. Durante o streaming o trecho é
 * cortado assim que passa do mínimo e encontra um fim de frase — o texto que
 * completaria o máximo ainda nem foi escrito. O máximo só entra em cena quando
 * o texto já está inteiro (o botão "Ouvir" de uma resposta antiga) ou quando o
 * modelo despeja um bloco grande de uma vez.
 *
 * Os mínimos crescem rápido de propósito. A fala corre a ~15 caracteres por
 * segundo, então um trecho de 300 caracteres são uns 20 segundos de áudio —
 * tempo de sobra para sintetizar o seguinte (1 a 3s) sem buraco nenhum. Deixar
 * os mínimos baixos só produziria mais requisições para gastar a mesma cota.
 *
 * O primeiro é a exceção e é curto de propósito: ele é o ÚNICO que a pessoa
 * espera em silêncio, e cada caractere aqui é atraso puro antes da primeira
 * palavra falada.
 */
const PERFIS = [
    { min: 90, max: 320 },
    { min: 300, max: 900 },
    { min: 600, max: 1400 },
    { min: 1000, max: 1800 },
];

/**
 * Depois deste tanto de trechos, o segmentador para de emitir e junta todo o
 * resto num único trecho final. É o freio duro contra uma resposta gigante
 * virar dezenas de requisições de voz.
 */
const MAX_TRECHOS = 10;

/**
 * Teto de caracteres por trecho. Espelha (com folga) o MAX_CARACTERES_TTS de
 * `backend/src/routes/tts.js` — passar dele devolve 413 e o trecho fica mudo.
 */
const TETO_TRECHO = 4800;

/**
 * Tira do texto o que é marcação e não deve ser lido em voz alta.
 *
 * Blocos de código saem INTEIROS: ouvir chaves, parênteses e nomes de variável
 * soletrados não informa ninguém, e ainda gasta cota por caractere. O resto da
 * marcação vira o texto que ela envolvia, que é justamente o que a tela mostra.
 *
 * @param {string} texto trecho da resposta, em Markdown
 * @returns {string} texto corrido, pronto para o TTS
 */
export function limparParaFala(texto) {
    return (
        String(texto || '')
            // Bloco de código cercado, fechado ou ainda aberto no fim do stream.
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/```[\s\S]*$/g, ' ')
            // Imagem antes do link: `![alt](url)` também casa com o padrão de
            // link, e na ordem inversa sobraria um `!` solto na frase.
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            // Linha horizontal: viraria um "traço traço traço" na leitura.
            .replace(/^\s*([-*_])\s*\1\s*\1[\s\S]*?$/gm, ' ')
            .replace(/^\s{0,3}#{1,6}\s+/gm, '')
            .replace(/^\s{0,3}>\s?/gm, '')
            .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
            .replace(/[*_~`#|]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    );
}

/**
 * A posição do terminador é o fim de uma frase de verdade?
 *
 * Rejeita o ponto de item numerado ("1. Comprar"), que é o falso positivo que
 * mais aparece nas respostas do assistente: sem esta checagem a narração
 * abriria um trecho só com o número, e a lista sairia lida como "um... dois..."
 * com pausas longas no meio.
 *
 * @param {string} texto
 * @param {number} posicao índice do caractere terminador
 */
function fimDeFraseDeVerdade(texto, posicao) {
    if (texto[posicao] !== '.') return true;
    let i = posicao - 1;
    let digitos = 0;
    while (i >= 0 && !/\s/.test(texto[i])) {
        if (!/\d/.test(texto[i])) return true;
        digitos += 1;
        i -= 1;
    }
    return digitos === 0;
}

/**
 * Onde cortar `texto`, respeitando [min, max].
 *
 * @param {string} texto
 * @param {number} min
 * @param {number} max
 * @param {boolean} maisCedo true = primeiro corte válido (menor espera);
 *   false = último corte que cabe (menos requisições, prosódia mais inteira)
 * @returns {number} índice exclusivo do corte, ou -1 se ainda não dá para cortar
 */
function acharCorte(texto, min, max, maisCedo) {
    const janela = texto.slice(0, max);
    const cortes = [];

    // Parágrafo, fim de frase e quebra de linha simples — nessa ordem de força,
    // mas todos servem: quem escolhe entre eles é o `maisCedo`.
    const padrao = /\n\s*\n|[.!?…]["')\]]?(?=\s|$)|\n/g;
    let achado = padrao.exec(janela);
    while (achado !== null) {
        // Casamento vazio não avança o lastIndex e prenderia o laço.
        if (achado[0].length === 0) padrao.lastIndex += 1;
        else if (fimDeFraseDeVerdade(janela, achado.index)) {
            const fim = achado.index + achado[0].length;
            if (fim >= min) cortes.push(fim);
        }
        achado = padrao.exec(janela);
    }

    if (cortes.length > 0) return maisCedo ? cortes[0] : cortes[cortes.length - 1];

    // Sem pontuação nenhuma e já passou do teto: corta na última palavra, para
    // um parágrafo corrido gigante não segurar a narração para sempre.
    if (texto.length >= max) {
        const espaco = janela.lastIndexOf(' ');
        return espaco >= min ? espaco + 1 : max;
    }
    return -1;
}

/**
 * @typedef {object} TrechoDeFala
 * @property {number} inicio índice inicial no texto-fonte (Markdown)
 * @property {number} fim índice final, exclusivo
 * @property {string} fala texto já limpo, pronto para o TTS
 */

export class SegmentadorFala {
    constructor() {
        /** Texto-fonte acumulado até agora. */
        this.fonte = '';
        /** Quanto da fonte já virou trecho. */
        this.consumido = 0;
        this.emitidos = 0;
    }

    /**
     * Recebe a resposta acumulada ATÉ AGORA (não o delta) e devolve os trechos
     * que ficaram prontos desde a última chamada.
     *
     * Receber o acumulado, e não o pedaço novo, é o que mantém `inicio`/`fim`
     * válidos como posições da resposta inteira — que é como o destaque na tela
     * reencontra o trecho depois que o Markdown foi repintado.
     *
     * @param {string} textoAcumulado
     * @returns {TrechoDeFala[]}
     */
    alimentar(textoAcumulado) {
        this.fonte = textoAcumulado;
        const prontos = [];

        for (;;) {
            if (this.emitidos >= MAX_TRECHOS) break;

            const pendente = this.fonte.slice(this.consumido);
            if (!pendente) break;

            const perfil = PERFIS[Math.min(this.emitidos, PERFIS.length - 1)];
            if (pendente.length < perfil.min) break;

            const corte = acharCorte(pendente, perfil.min, perfil.max, this.emitidos === 0);
            if (corte <= 0) break;

            const trecho = this._montar(this.consumido, this.consumido + corte);
            this.consumido += corte;
            if (trecho) {
                this.emitidos += 1;
                prontos.push(trecho);
            }
        }

        return prontos;
    }

    /**
     * Fecha a resposta: entrega o que sobrou, sem exigir tamanho mínimo.
     * @returns {TrechoDeFala[]}
     */
    finalizar() {
        const prontos = [];

        while (this.consumido < this.fonte.length) {
            const resto = this.fonte.length - this.consumido;
            const corte = Math.min(resto, TETO_TRECHO);
            const trecho = this._montar(this.consumido, this.consumido + corte);
            this.consumido += corte;
            if (trecho) {
                this.emitidos += 1;
                prontos.push(trecho);
            }
        }

        return prontos;
    }

    /**
     * Monta o trecho, ou devolve null quando não sobrou nada audível —
     * um pedaço que só tinha bloco de código, tabela ou linha horizontal.
     * O intervalo é consumido de qualquer jeito: o que não se fala, se pula.
     */
    _montar(inicio, fim) {
        const fala = limparParaFala(this.fonte.slice(inicio, fim));
        if (fala.length < 2) return null;
        return { inicio, fim, fala };
    }
}
