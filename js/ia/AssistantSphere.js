/**
 * AssistantSphere.js — a esfera do assistente, em Canvas 2D puro.
 *
 * Uma nuvem de pontos distribuída por Fibonacci, deslocada radialmente por
 * ruído 3D em três oitavas, com a amplitude comandada pelo nível da voz. O
 * objetivo é que a esfera pareça líquido — não uma bola respirando.
 *
 * Por que Canvas 2D e não WebGL/three.js: esta página é servida sem bundler e
 * a CSP autoriza scripts só por origem própria. `three.min.js` seria ~600kB
 * antes do primeiro pixel numa tela que já carrega o chat inteiro. Com 3200
 * pontos, sprites e camadas de brilho pré-renderizados, o 2D dá conta em 60fps.
 *
 * ─── Pontos de ajuste visual ────────────────────────────────────────────────
 * PALETAS ....... cores do núcleo/corpo/halo e o âmbar do estado de erro
 * ESTADOS ....... amplitude, velocidade e brilho de cada estado
 * NIVEIS_QUALIDADE passo na nuvem, oitavas de ruído e densidade (dpr) por nível
 * _gerarCamadas . fundo, bloom, halo, núcleo e especular — toda a luz difusa
 * FOV / INCLINACAO enquadramento da esfera
 * RAIO_RELATIVO . tamanho da esfera; ANEIS: raio, inclinação e período de cada órbita
 * RESPOSTA_* .... rapidez com que voz e estado alcançam o alvo, por SEGUNDO
 * DURACAO_ENTRADA e DECAIMENTO_IMPULSO: a materialização e o acento da troca
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A mesma esfera serve dois enquadramentos: a página cheia do assistente
 * (padrão) e o orb do chatbot embutido no dashboard, que pede
 * `{ compacto: true, escalaRaio: 1.4 }` — duas órbitas em vez de quatro e uma
 * esfera maior dentro do quadrado, porque a 200px as quatro órbitas se
 * empilham numa névoa. Nada disso muda o padrão: sem opções, o desenho é
 * pixel a pixel o mesmo de antes.
 */

import { criarRuido3D } from './ruido3d.js';

const TAU = Math.PI * 2;

/**
 * Paleta institucional (DESIGN-SYSTEM.md): esmeralda #10b981 + teal #0d9488.
 * O núcleo #6ee7b7 é o mesmo `--accent3` já usado no CSS da página, então a
 * esfera e o restante da interface continuam sendo a mesma marca.
 */
const PALETAS = {
    normal: {
        nucleo: [110, 231, 183],
        corpo: [16, 185, 129],
        halo: [13, 148, 136],
        fundoInterno: 'rgba(16, 185, 129, 0.15)',
        fundoExterno: 'rgba(3, 8, 7, 0)',
    },
    // Erro NÃO para a água: só troca a paleta para âmbar. Uma esfera
    // congelada seria lida como "a página travou", que é pior que o erro real.
    erro: {
        nucleo: [255, 214, 158],
        corpo: [255, 180, 84],
        halo: [198, 125, 31],
        fundoInterno: 'rgba(255, 180, 84, 0.15)',
        fundoExterno: 'rgba(8, 5, 2, 0)',
    },
};

/**
 * Parâmetros por estado. Todos são interpolados na troca (ver `SUAVIZACAO`),
 * então nenhum estado entra em degrau.
 *
 * `amp` é a amplitude de repouso; em `falando` ela ainda soma `AMP_VOZ * nível`.
 */
const ESTADOS = {
    ocioso: { amp: 0.02, onda: 0.01, tempo: 1.0, giro: 0.055, anel: 1.0, brilho: 0.96, cintila: 0 },
    ouvindo: {
        amp: 0.03,
        onda: 0.022,
        tempo: 0.85,
        giro: 0.04,
        anel: 0.84,
        brilho: 1.08,
        cintila: 0,
    },
    pensando: {
        amp: 0.018,
        onda: 0.008,
        tempo: 1.3,
        giro: 0.32,
        anel: 1.06,
        brilho: 1.02,
        cintila: 1,
    },
    falando: { amp: 0.03, onda: 0.03, tempo: 2.2, giro: 0.11, anel: 1.1, brilho: 1.14, cintila: 0 },
    erro: {
        amp: 0.026,
        onda: 0.018,
        tempo: 0.9,
        giro: 0.045,
        anel: 0.96,
        brilho: 1.04,
        cintila: 0,
    },
};

/**
 * Ganho global da nuvem de pontos.
 *
 * Com 3200 sprites sobre um disco de ~200px de raio, cada pixel recebe várias
 * camadas sobrepostas. Em modo 'lighter' isso multiplica: sem este fator a
 * esfera satura em branco e vira um prato chapado — o defeito ficou evidente
 * na primeira captura, e nenhuma métrica numérica o teria pego.
 *
 * Caiu de 0.75 para 0.68 quando a contagem subiu de 2200 para 3200 pontos: o
 * que se mantém constante é a LUZ TOTAL da nuvem, não o ganho por ponto. Mais
 * pontos menores no mesmo disco dão grão mais fino — que é a leitura de "HD" —
 * em vez de um miolo estourado. O brilho a mais que o olho percebe veio das
 * camadas de halo, bloom e núcleo, que são gradientes e por isso acendem a
 * esfera sem apagar a textura da água.
 */
const EXPOSICAO = 0.68;

/** Amplitude extra que a voz acrescenta no pico (0.03 + 0.13 ≈ 0.16). */
const AMP_VOZ = 0.13;

/**
 * Constantes de suavização, em unidades POR SEGUNDO — não por quadro.
 *
 * A forma antiga era `valor += (alvo - valor) * 0.15` a cada quadro, o que
 * amarra a animação à taxa de atualização da tela: num monitor de 120Hz a
 * esfera reagia ao dobro da velocidade de um de 60Hz, e num notebook que
 * caísse para 30fps ela ficava pastosa. Não era percebido como bug porque
 * cada máquina só vê a sua própria versão — mas é a mesma esfera reagindo
 * com três personalidades diferentes.
 *
 * `1 - exp(-k * dt)` dá o mesmo decaimento exponencial com o tempo real como
 * relógio. Os valores abaixo reproduzem a resposta antiga a 60fps:
 * k = -60 * ln(1 - fator).
 *
 * A voz ganhou ataque e relaxamento SEPARADOS. Com um único fator, subir e
 * descer no mesmo ritmo, a esfera chegava atrasada em cada consoante e
 * escorria depois dela — o efeito de "gelatina" que faz a animação parecer
 * solta da narração. Envelope de áudio se lê com ataque rápido e queda lenta:
 * a esfera acompanha o ataque da sílaba e sustenta o brilho na cauda, que é
 * como o ouvido também processa a fala.
 */
const RESPOSTA_VOZ_ATAQUE = 26;
const RESPOSTA_VOZ_QUEDA = 8;
const RESPOSTA_ESTADO = 5;

/**
 * Converte uma constante por segundo no fator daquele quadro.
 * O `min(1, …)` protege contra um `dt` grande (aba que volta do background).
 */
function fatorSuave(k, dt) {
    return 1 - Math.exp(-k * dt);
}

/**
 * Entrada da esfera: ela materializa em vez de aparecer pronta.
 *
 * Importa pouco na página do assistente, onde a esfera nasce junto com o
 * documento, e muito no orb do chatbot do dashboard, que monta e desmonta a
 * cada resposta. Sem a rampa, cada narração começava com um estouro de luz no
 * meio da janela do chat.
 *
 * 420ms com ease-out cúbico: dentro do teto de 300ms do Emil não caberia uma
 * esfera inteira se formando, mas este não é um controle de uso repetido —
 * é o estado "o assistente começou a falar", visto uma vez por resposta.
 */
const DURACAO_ENTRADA = 0.42;

/**
 * Acento na troca de estado: um impulso que decai em ~380ms.
 *
 * A interpolação de `ESTADOS` leva quase um segundo para assentar, então sem
 * este acento a passagem de "pensando" para "falando" não tinha instante — a
 * esfera derivava de um estado ao outro e a troca não era legível. O impulso
 * é curto e pequeno de propósito: marca o momento, não chama atenção.
 */
const DECAIMENTO_IMPULSO = 6;

/** Pontos da nuvem no nível de qualidade mais alto. */
const TOTAL_PONTOS = 3200;

/**
 * Degraus de qualidade. A queda é automática e só desce: subir de volta faria
 * a esfera oscilar entre dois níveis num notebook que está no limite.
 *
 * O degrau é o PASSO na nuvem, não uma contagem alvo: percorrer o array de
 * Fibonacci de 2 em 2 mantém a distribuição esférica. Declarar a contagem e
 * derivar o passo por divisão dava passo 1 para qualquer alvo acima da
 * metade — o degrau intermediário não reduzia nada.
 *
 * O `dpr` entrou junto porque densidade é metade da percepção de nitidez — e
 * porque é o eixo mais CARO, já que o custo de preenchimento cresce com o
 * quadrado dele. Fixo em 2 (como era) ele desperdiçava a tela 3x de quem tem
 * máquina para isso; fixo em 3 travaria quem não tem. Como degrau, quem mede
 * é o próprio cronômetro do quadro. É o PRIMEIRO a cair, antes de qualquer
 * ponto ser descartado: perder densidade incomoda menos que perder a textura
 * da água, que é a coisa que a esfera existe para mostrar.
 */
const NIVEIS_QUALIDADE = [
    { passo: 1, oitavas: 3, dpr: 3 }, // 3200 pontos, densidade máxima
    { passo: 1, oitavas: 3, dpr: 2 }, // 3200 pontos em retina comum
    { passo: 2, oitavas: 3, dpr: 2 }, // 1600 pontos
    { passo: 3, oitavas: 2, dpr: 1.5 }, // ~1067 pontos
];

/**
 * Orçamento do DESENHO em ms, e por quantos quadros seguidos ele pode estourar
 * antes de a qualidade cair um degrau.
 *
 * 11ms de um orçamento de 16.7ms: o resto do quadro é do navegador (composição,
 * layout do chat ao lado, o próprio vsync). O que se mede aqui é só o tempo
 * dentro de `_desenhar` — medir o intervalo entre callbacks do rAF misturava o
 * nosso custo com throttling alheio e derrubava a qualidade de uma esfera que
 * rodava a 60fps.
 */
const MS_LIMITE = 11;
const FRAMES_ATE_QUEDA = 45;

/** Distância virtual da câmera, em raios. Menor = mais perspectiva. */
const FOV = 2.7;
/** Inclinação do eixo, para a esfera não ser vista exatamente de equador. */
const INCLINACAO = 0.28;

/**
 * Raio da esfera como fração do lado do canvas.
 *
 * O teto vem do anel mais externo, que também é esticado pelo `anel` do estado
 * ativo: RAIO_RELATIVO * 2.3 (maior raio em ANEIS) * 1.1 (maior escala, em
 * "falando") tem de ficar abaixo de 0.5, senão a órbita é cortada pela borda
 * bem no estado em que ela está mais visível. 0.188 deixa folga para a
 * espessura do traço e para o halo largo desenhado sob ele.
 *
 * Quem monta a esfera pode pedir um raio maior (`escalaRaio`); o teto acima
 * continua valendo e é recalculado em `_limitarRaio` a partir do conjunto de
 * anéis realmente em uso — não de um número fixo que se desatualiza quando
 * ANEIS muda.
 */
const RAIO_RELATIVO = 0.188;

/**
 * Fração do lado que a órbita mais externa não pode ultrapassar.
 *
 * 0.476 e não 0.5: é exatamente onde o enquadramento padrão já estava
 * (0.188 * 2.3 * 1.1 = 0.4756), então o teto não encolhe a esfera de quem
 * não pede escala nenhuma. A folga até a borda é o traço do anel e o halo
 * largo desenhado sob ele.
 */
const LIMITE_ORBITA = 0.476;
/** Maior valor de `anel` em ESTADOS — o esticão do estado "falando". */
const ESCALA_ANEL_MAX = 1.1;

/** Anéis orbitais: raio relativo, achatamento, período em segundos, nós. */
const ANEIS = [
    { raio: 1.32, achatamento: 0.2, periodo: 62, giroNo: 34, nos: 1 },
    { raio: 1.62, achatamento: 0.34, periodo: -96, giroNo: -51, nos: 1 },
    { raio: 1.95, achatamento: 0.14, periodo: 44, giroNo: 78, nos: 2 },
    { raio: 2.3, achatamento: 0.42, periodo: -124, giroNo: 63, nos: 1 },
];

/**
 * Conjunto reduzido de órbitas, para molduras pequenas.
 *
 * Num orb de ~200px as quatro órbitas ficam a poucos pixels uma da outra e
 * lêem como uma névoa cinza em volta da esfera, não como órbitas. Com duas,
 * cada uma tem espaço para ser vista — e o raio da esfera pode crescer ~40%
 * dentro do mesmo quadrado, que é o que faz a água aparecer nesse tamanho.
 */
const ANEIS_COMPACTOS = ANEIS.slice(0, 2);

/** Rastro do nó que percorre o anel: quantas cópias e o quanto elas recuam. */
const RASTRO_PASSOS = 7;
const RASTRO_ATRASO = 0.035;

/** Erros seguidos no laço de render antes de desistir e entregar o fallback. */
const ERROS_ATE_DESISTIR = 8;

const CONSULTA_REDUZIR = '(prefers-reduced-motion: reduce)';

/**
 * Sprite de ponto. 48px e não 32: com dpr 3 e a saia mais larga que cada ponto
 * ganhou, o maior sprite desenhado chega a ~14px de device — e a 32px ele já
 * subia borrado, o que transformava em mancha justamente o grão que deveria
 * ficar mais visível nas telas densas.
 */
const TAM_SPRITE = 48;

/**
 * Lado das camadas de brilho pré-renderizadas (fundo, bloom, halo, núcleo).
 *
 * 256px basta: são gradientes radiais suaves, sem nenhum detalhe fino, e a
 * ampliação até o lado do canvas fica por conta da interpolação bilinear do
 * navegador — num gradiente ela é indistinguível do original.
 */
const TAM_CAMADA = 256;

/**
 * Sprite radial pré-renderizado. Desenhar 2200 `arc()` por frame é inviável;
 * 2200 `drawImage()` de um gradiente pronto, com `globalCompositeOperation`
 * em 'lighter', dá o mesmo ponto luminoso e ainda entrega o bloom de graça —
 * sem `shadowBlur` por ponto, que seria catastrófico para o frame time.
 *
 * @param {[number, number, number]} rgb
 * @returns {HTMLCanvasElement}
 */
function criarSprite(rgb) {
    const tela = document.createElement('canvas');
    tela.width = TAM_SPRITE;
    tela.height = TAM_SPRITE;
    const g = tela.getContext('2d');
    if (!g) return tela;

    const meio = TAM_SPRITE / 2;
    const gradiente = g.createRadialGradient(meio, meio, 0, meio, meio, meio);
    const [r, v, a] = rgb;
    // Núcleo quente e estreito + saia longa e fraca. O perfil antigo (uma queda
    // só, de 0.28 a 0.62) dava um borrão de intensidade média: o ponto não
    // tinha centro nítido nem brilho ao redor. Separar as duas coisas é o que
    // faz cada partícula ler como uma LUZ — miolo definido, halo próprio — e é
    // daí que vem a impressão de brilho sem estourar a exposição.
    gradiente.addColorStop(0, `rgba(${r}, ${v}, ${a}, 1)`);
    gradiente.addColorStop(0.16, `rgba(${r}, ${v}, ${a}, 0.92)`);
    gradiente.addColorStop(0.34, `rgba(${r}, ${v}, ${a}, 0.52)`);
    gradiente.addColorStop(0.62, `rgba(${r}, ${v}, ${a}, 0.17)`);
    gradiente.addColorStop(0.84, `rgba(${r}, ${v}, ${a}, 0.05)`);
    gradiente.addColorStop(1, `rgba(${r}, ${v}, ${a}, 0)`);

    g.fillStyle = gradiente;
    g.fillRect(0, 0, TAM_SPRITE, TAM_SPRITE);
    return tela;
}

/**
 * Camada de brilho pré-renderizada: um gradiente radial virado bitmap.
 *
 * Antes, fundo, halo e núcleo eram `createRadialGradient` + `fillRect` A CADA
 * QUADRO, sobre quase todo o canvas. Criar o objeto de gradiente e avaliá-lo
 * pixel a pixel é o item mais caro do desenho depois da nuvem de pontos — e
 * era pago 60 vezes por segundo para pintar sempre a mesma coisa.
 *
 * Como bitmap, o mesmo pixel sai de um `drawImage` escalado, que é uma cópia
 * interpolada. A folga que isso abriu foi gasta em MAIS luz: entraram uma
 * camada de bloom larga e um brilho especular, que antes não caberiam no
 * orçamento de 11ms.
 *
 * @param {Array<[number, string]>} paradas pares [posição 0..1, cor CSS]
 * @returns {HTMLCanvasElement}
 */
function criarCamadaRadial(paradas) {
    const tela = document.createElement('canvas');
    tela.width = TAM_CAMADA;
    tela.height = TAM_CAMADA;
    const g = tela.getContext('2d');
    if (!g) return tela;

    const meio = TAM_CAMADA / 2;
    const gradiente = g.createRadialGradient(meio, meio, 0, meio, meio, meio);
    for (const [posicao, cor] of paradas) gradiente.addColorStop(posicao, cor);

    g.fillStyle = gradiente;
    g.fillRect(0, 0, TAM_CAMADA, TAM_CAMADA);
    return tela;
}

function rgba(rgb, alfa) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alfa})`;
}

/** Gerador linear congruente — embaralhamento estável entre carregamentos. */
function criarSorteio(semente) {
    let estado = semente >>> 0;
    return () => {
        estado = (Math.imul(estado, 1664525) + 1013904223) >>> 0;
        return estado / 4294967296;
    };
}

/**
 * Distribuição de Fibonacci COM jitter: o ângulo áureo evita as aglomerações
 * nos polos que uma grade latitude/longitude produz, mas por ser regular
 * demais ele cria um artefato próprio — os braços da espiral se alinham e a
 * esfera aparece como trama de cesto, não como nuvem de pontos. Visível já na
 * primeira captura de tela.
 *
 * O jitter de até ~0.5 do espaçamento entre vizinhos quebra o alinhamento sem
 * abrir buracos na cobertura.
 *
 * @param {number} total
 * @returns {Float32Array} ternas (x, y, z) unitárias
 */
function distribuirFibonacci(total) {
    const pontos = new Float32Array(total * 3);
    const anguloAureo = Math.PI * (3 - Math.sqrt(5));
    const sortear = criarSorteio(20260831);
    // Espaçamento médio em latitude entre dois índices consecutivos.
    const passoY = 2 / total;

    for (let i = 0; i < total; i++) {
        const y = Math.max(-1, Math.min(1, 1 - i * passoY + (sortear() - 0.5) * passoY * 1.0));
        const raio = Math.sqrt(Math.max(0, 1 - y * y));
        const teta = anguloAureo * i + (sortear() - 0.5) * 0.55;
        pontos[i * 3] = Math.cos(teta) * raio;
        pontos[i * 3 + 1] = y;
        pontos[i * 3 + 2] = Math.sin(teta) * raio;
    }
    return pontos;
}

export class AssistantSphere {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {object} [opcoes]
     * @param {{ nivel: (t: number, esperando: boolean) => number }} [opcoes.medidor]
     * @param {() => void} [opcoes.aoFalhar] chamado quando o render desiste de vez
     * @param {number} [opcoes.escalaRaio=1] multiplica RAIO_RELATIVO; limitado
     *   por `_limitarRaio` para a órbita externa nunca sair do quadro
     * @param {boolean} [opcoes.compacto=false] usa só as duas órbitas internas,
     *   o que libera um raio maior — para orbs pequenos (chat, FAB)
     * @param {boolean} [opcoes.entrada=true] materializa em vez de aparecer pronta
     */
    constructor(canvas, opcoes = {}) {
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) throw new Error('Canvas 2D indisponível.');

        this.canvas = canvas;
        this.ctx = ctx;
        this.medidor = opcoes.medidor || null;
        this.aoFalhar = opcoes.aoFalhar || (() => {});

        this.aneis = opcoes.compacto ? ANEIS_COMPACTOS : ANEIS;
        this.raioRelativo = this._limitarRaio(opcoes.escalaRaio);

        // `entrada` vai de 0 a 1 na montagem. Começar em 1 é o modo "já
        // formada", para quem remonta a esfera sem que ela tenha saído de vista.
        this.entrada = opcoes.entrada === false ? 1 : 0;
        // Acento decrescente disparado a cada troca de estado.
        this.impulso = 0;

        this.ruido = criarRuido3D();

        // A nuvem é gerada uma vez no nível mais alto; a queda de qualidade
        // percorre o mesmo array com passo maior, o que preserva a
        // distribuição — pegar um prefixo do array daria só a calota norte.
        this.totalPontos = TOTAL_PONTOS;
        this.pontos = distribuirFibonacci(this.totalPontos);

        // Fase por ponto: usada na cintilação de "pensando". Guardada para o
        // cintilar ser estável entre frames em vez de ruído branco.
        this.fases = new Float32Array(this.totalPontos);
        // Variação de tamanho por ponto (0.78x a 1.22x): partículas de tamanhos
        // diferentes leem como nuvem; todas iguais leem como trama impressa.
        this.variacoes = new Float32Array(this.totalPontos);
        const sorteioVar = criarSorteio(778899);
        for (let i = 0; i < this.totalPontos; i++) {
            this.fases[i] = (i * 2.399963) % TAU;
            this.variacoes[i] = 0.78 + sorteioVar() * 0.44;
        }

        this.nivelQualidade = 0;
        this.framesLentos = 0;
        this.mediaFrame = MS_LIMITE * 0.6;

        this.paleta = PALETAS.normal;
        this.sprites = this._gerarSprites(this.paleta);
        this.camadas = this._gerarCamadas(this.paleta);

        this.estado = 'ocioso';
        // Começa já nos valores de "ocioso" para não haver interpolação visível
        // no primeiro frame.
        this.atual = { ...ESTADOS.ocioso };
        this.alvo = ESTADOS.ocioso;
        this.nivelVoz = 0;

        this.tempo = 0;
        this.giro = 0;
        // Relógio próprio das órbitas: períodos fixos de 40–120s, independentes do
        // `tempo` (que acelera com o estado). Congela junto com a geometria em
        // movimento reduzido.
        this.tempoAnel = 0;
        this.decorrido = 0;
        this.ultimoQuadro = 0;
        this.rodando = false;
        this.visivel = true;
        this.rafId = 0;
        this.erros = 0;
        this.desistiu = false;
        this.ultimoDesenhoReduzido = -1;

        this.largura = 0;
        this.altura = 0;
        this.dpr = 1;

        this._quadro = this._quadro.bind(this);
        this._aoTrocarVisibilidade = this._aoTrocarVisibilidade.bind(this);

        this.consultaReduzir = window.matchMedia
            ? window.matchMedia(CONSULTA_REDUZIR)
            : { matches: false, addEventListener: null, removeEventListener: null };
        this.reduzido = !!this.consultaReduzir.matches;
        this._aoTrocarPreferencia = () => {
            this.reduzido = !!this.consultaReduzir.matches;
            this.ultimoDesenhoReduzido = -1;
        };
        this.consultaReduzir.addEventListener?.('change', this._aoTrocarPreferencia);

        this._medirCanvas();

        this.observadorTamanho =
            typeof ResizeObserver === 'function'
                ? new ResizeObserver(() => this._medirCanvas())
                : null;
        this.observadorTamanho?.observe(canvas);

        // Fora da viewport a esfera não é vista; manter o rAF girando ali só
        // gasta bateria. Vale principalmente no layout de tablet, onde o palco
        // pode sair da tela.
        this.observadorVisibilidade =
            typeof IntersectionObserver === 'function'
                ? new IntersectionObserver(
                      (entradas) => {
                          this.visivel = entradas.some((e) => e.isIntersecting);
                          this._sincronizarLaco();
                      },
                      { threshold: 0.01 }
                  )
                : null;
        this.observadorVisibilidade?.observe(canvas);

        document.addEventListener('visibilitychange', this._aoTrocarVisibilidade);

        this.rodando = true;
        this._sincronizarLaco();
    }

    /**
     * Troca o estado da esfera.
     * @param {'ocioso'|'ouvindo'|'pensando'|'falando'|'erro'} estado
     */
    definirEstado(estado) {
        if (!ESTADOS[estado] || estado === this.estado) return;
        this.estado = estado;
        this.alvo = ESTADOS[estado];

        // O acento da troca. Fica em 0 sob movimento reduzido: é exatamente o
        // tipo de pulso curto que a preferência pede para não existir.
        if (!this.reduzido) this.impulso = 1;

        const paleta = estado === 'erro' ? PALETAS.erro : PALETAS.normal;
        if (paleta !== this.paleta) {
            this.paleta = paleta;
            this.sprites = this._gerarSprites(paleta);
            this.camadas = this._gerarCamadas(paleta);
        }
        // Em movimento reduzido o desenho é congelado: sem isto a troca de
        // estado só apareceria no próximo tique lento.
        this.ultimoDesenhoReduzido = -1;
    }

    /** Cancela rAF, observadores e listeners. Chamar ao sair da página. */
    destruir() {
        this.rodando = false;
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = 0;
        this.observadorTamanho?.disconnect();
        this.observadorVisibilidade?.disconnect();
        this.consultaReduzir.removeEventListener?.('change', this._aoTrocarPreferencia);
        document.removeEventListener('visibilitychange', this._aoTrocarVisibilidade);
    }

    // ── Interno ─────────────────────────────────────────────────────────────

    /**
     * Raio pedido, cortado no que a órbita mais externa em uso comporta.
     *
     * Deriva o teto de `this.aneis` em vez de repetir o 2.3 do comentário de
     * RAIO_RELATIVO: assim mexer em ANEIS não deixa para trás um limite que
     * ninguém lembra de atualizar, e o conjunto compacto ganha automaticamente
     * a folga que as duas órbitas externas deixaram.
     *
     * @param {number} [escala=1]
     * @returns {number} fração do lado do canvas
     */
    _limitarRaio(escala) {
        const pedido = RAIO_RELATIVO * (escala > 0 ? escala : 1);
        let maiorOrbita = 1;
        for (const anel of this.aneis) maiorOrbita = Math.max(maiorOrbita, anel.raio);
        const teto = LIMITE_ORBITA / (maiorOrbita * ESCALA_ANEL_MAX);
        return Math.min(pedido, teto);
    }

    _gerarSprites(paleta) {
        return {
            nucleo: criarSprite(paleta.nucleo),
            corpo: criarSprite(paleta.corpo),
            halo: criarSprite(paleta.halo),
        };
    }

    /**
     * As cinco camadas de luz difusa, na paleta ativa.
     *
     * As posições de `halo` já vêm CONVERTIDAS para a escala do bitmap: o
     * gradiente original começava num raio interno de 0.55 do raio da esfera
     * dentro de um disco de 2.15 — ou seja, em 0.256 da camada. Guardar a
     * conversão aqui, e não no desenho, é o que permite ao quadro gastar um
     * `drawImage` por camada e nada mais.
     */
    _gerarCamadas(paleta) {
        return {
            // Brilho difuso do fundo — o gradiente radial quase preto do mockup.
            fundo: criarCamadaRadial([
                [0, paleta.fundoInterno],
                [1, paleta.fundoExterno],
            ]),
            // Bloom: a luz que "vaza" da esfera para o palco. É o brilho visto
            // de fora, e por ser larguíssimo e fraco não compete com a nuvem —
            // some se você procurar por ele, e faz falta se sair.
            bloom: criarCamadaRadial([
                [0, rgba(paleta.corpo, 0.1)],
                [0.35, rgba(paleta.halo, 0.055)],
                [0.7, rgba(paleta.halo, 0.018)],
                [1, rgba(paleta.halo, 0)],
            ]),
            halo: criarCamadaRadial([
                [0, rgba(paleta.corpo, 0.27)],
                [0.256, rgba(paleta.corpo, 0.27)],
                [0.568, rgba(paleta.halo, 0.13)],
                [1, rgba(paleta.halo, 0)],
            ]),
            // Núcleo: o miolo aceso que atravessa a nuvem. Contido de
            // propósito — a nuvem já soma luz, e um núcleo forte apaga em
            // branco justamente a textura de água do centro.
            nucleo: criarCamadaRadial([
                [0, rgba(paleta.nucleo, 0.17)],
                [0.5, rgba(paleta.corpo, 0.06)],
                [1, rgba(paleta.corpo, 0)],
            ]),
            // Especular: o reflexo alto e deslocado que diz de onde vem a luz.
            // Sem ele a nuvem é simétrica e lê como disco; com ele o olho fecha
            // a forma como esfera. Fraco porque é pista de volume, não brilho.
            especular: criarCamadaRadial([
                [0, rgba(paleta.nucleo, 0.3)],
                [0.4, rgba(paleta.nucleo, 0.09)],
                [1, rgba(paleta.nucleo, 0)],
            ]),
        };
    }

    _aoTrocarVisibilidade() {
        this._sincronizarLaco();
    }

    /** Liga ou desliga o rAF conforme aba visível, esfera na tela e vida útil. */
    _sincronizarLaco() {
        const deveRodar = this.rodando && this.visivel && !document.hidden && !this.desistiu;
        if (deveRodar && !this.rafId) {
            this.ultimoQuadro = 0;
            this.rafId = requestAnimationFrame(this._quadro);
        } else if (!deveRodar && this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
    }

    _medirCanvas() {
        const caixa = this.canvas.getBoundingClientRect();
        const lado = Math.max(1, Math.min(caixa.width, caixa.height));
        // O teto do devicePixelRatio é o do degrau de qualidade ATIVO, e não
        // uma constante: o custo de preenchimento cresce com o quadrado dele,
        // então quem decide é o cronômetro do quadro. Ver NIVEIS_QUALIDADE.
        const teto = NIVEIS_QUALIDADE[this.nivelQualidade].dpr;
        const dpr = Math.min(teto, window.devicePixelRatio || 1);
        const pixels = Math.round(lado * dpr);
        if (pixels === this.canvas.width && dpr === this.dpr) return;

        this.dpr = dpr;
        this.canvas.width = pixels;
        this.canvas.height = pixels;
        this.largura = pixels;
        this.altura = pixels;
        this.ultimoDesenhoReduzido = -1;
    }

    /**
     * Um quadro. Todo o corpo é protegido: uma exceção aqui não pode derrubar
     * a página do assistente, então ela é registrada uma vez e o laço segue
     * com os últimos parâmetros válidos.
     */
    _quadro(agora) {
        this.rafId = requestAnimationFrame(this._quadro);

        try {
            const dt = this.ultimoQuadro
                ? Math.min(0.05, (agora - this.ultimoQuadro) / 1000)
                : 0.016;
            this.ultimoQuadro = agora;
            this.decorrido += dt;

            if (this.reduzido) {
                // Movimento reduzido: geometria congelada, só o brilho respira
                // devagar. Redesenha a ~10fps porque nada mais muda.
                if (this.decorrido - this.ultimoDesenhoReduzido < 0.1) return;
                this.ultimoDesenhoReduzido = this.decorrido;
                // Sem rampa e sem acento: quem pediu menos movimento recebe a
                // esfera já formada, não uma que se monta na frente dele.
                this.entrada = 1;
                this.impulso = 0;
                this._interpolarEstado(1);
                this._desenhar(0.86 + 0.14 * Math.sin(this.decorrido * 0.06 * TAU));
                return;
            }

            if (this.entrada < 1) {
                this.entrada = Math.min(1, this.entrada + dt / DURACAO_ENTRADA);
            }
            // Decaimento exponencial do acento — nunca chega a zero exato, e o
            // corte evita ficar somando um resíduo de 1e-9 para sempre.
            this.impulso *= Math.exp(-DECAIMENTO_IMPULSO * dt);
            if (this.impulso < 0.002) this.impulso = 0;

            this._interpolarEstado(fatorSuave(RESPOSTA_ESTADO, dt));

            const esperandoVoz = this.estado === 'falando';
            const bruto = this.medidor ? this.medidor.nivel(this.decorrido, esperandoVoz) : 0;
            const respostaVoz = bruto > this.nivelVoz ? RESPOSTA_VOZ_ATAQUE : RESPOSTA_VOZ_QUEDA;
            this.nivelVoz += (bruto - this.nivelVoz) * fatorSuave(respostaVoz, dt);

            // O tempo do ruído anda mais rápido enquanto o assistente fala: é
            // o que separa "líquido agitado" de "líquido em repouso".
            this.tempo += dt * this.atual.tempo * (1 + this.nivelVoz * 0.6);
            this.giro += dt * this.atual.giro * (1 + this.nivelVoz * 0.35);
            this.tempoAnel += dt * (1 + this.nivelVoz * 0.3);

            // Cronometra só o DESENHO. Medir o intervalo entre callbacks do
            // rAF media o vsync e o throttling do navegador junto com o nosso
            // custo: num monitor de 60Hz todo quadro vale 16.7 ou 33.3ms, e um
            // engasgo alheio derrubava a qualidade de uma esfera que estava
            // perfeitamente dentro do orçamento (observado no Chromium).
            const antes = performance.now();
            // Ease-out cúbico na entrada: a esfera chega rápido ao brilho quase
            // final e assenta o resto devagar. Com a rampa linear ela terminava
            // de aparecer com um degrau visível.
            const restante = 1 - this.entrada;
            const rampa = 1 - restante * restante * restante;
            this._desenhar(this.atual.brilho * (1 + this.nivelVoz * 0.22) * rampa, rampa);
            this._avaliarDesempenho(performance.now() - antes);
            this.erros = 0;
        } catch (e) {
            this._registrarErro(e);
        }
    }

    _registrarErro(e) {
        this.erros += 1;
        if (this.erros === 1) console.error('[Esfera] Falha no laço de render:', e);
        if (this.erros < ERROS_ATE_DESISTIR) return;

        // Erro persistente: encerra o laço e devolve o controle à página, que
        // revela o orb estático em CSS no lugar do canvas.
        this.desistiu = true;
        this.rodando = false;
        this._sincronizarLaco();
        try {
            this.aoFalhar();
        } catch {
            // O fallback também falhou; não há mais nada a tentar.
        }
    }

    /** Baixa a qualidade quando a média do tempo de DESENHO passa do orçamento. */
    _avaliarDesempenho(ms) {
        this.mediaFrame += (ms - this.mediaFrame) * 0.05;
        if (this.nivelQualidade >= NIVEIS_QUALIDADE.length - 1) return;

        if (this.mediaFrame > MS_LIMITE) {
            this.framesLentos += 1;
            if (this.framesLentos >= FRAMES_ATE_QUEDA) {
                this.nivelQualidade += 1;
                this.framesLentos = 0;
                this.mediaFrame = MS_LIMITE * 0.6;
                // O degrau também baixa o dpr, e quem aplica isso é a medição
                // do canvas. Sem esta chamada o primeiro degrau (que só muda a
                // densidade) não teria efeito nenhum, e a queda seguiria direto
                // para o descarte de pontos.
                this._medirCanvas();
            }
        } else {
            this.framesLentos = 0;
        }
    }

    /** Aproxima os parâmetros atuais dos do estado alvo. */
    _interpolarEstado(fator) {
        const a = this.atual;
        const b = this.alvo;
        a.amp += (b.amp - a.amp) * fator;
        a.onda += (b.onda - a.onda) * fator;
        a.tempo += (b.tempo - a.tempo) * fator;
        a.giro += (b.giro - a.giro) * fator;
        a.anel += (b.anel - a.anel) * fator;
        a.brilho += (b.brilho - a.brilho) * fator;
        a.cintila += (b.cintila - a.cintila) * fator;
    }

    /**
     * @param {number} brilhoGlobal multiplicador de opacidade do frame
     * @param {number} [rampa=1] progresso da entrada, já suavizado (0..1)
     */
    _desenhar(brilhoGlobal, rampa = 1) {
        const ctx = this.ctx;
        const lado = this.largura;
        if (!lado) return;

        const cx = lado / 2;
        const cy = lado / 2;
        // A esfera entra de 0.88 do raio, não de zero: partir de um ponto é o
        // erro clássico de `scale(0)` — o começo do movimento fica rápido
        // demais para o olho e o fim, arrastado. O impulso da troca de estado
        // soma aqui um empurrão de menos de 2%, que se sente sem se ver.
        const escala = (0.88 + 0.12 * rampa) * (1 + this.impulso * 0.018);
        const raio = lado * this.raioRelativo * escala;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        // 'copy' e não 'source-over' depois de um clearRect: o blit do fundo já
        // apaga sozinho tudo que estiver fora dele, então o quadro começa com
        // UMA passada sobre o canvas em vez de duas.
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(this.camadas.fundo, 0, 0, lado, lado);

        // Daqui para baixo tudo soma luz: com 'lighter' a ordem de desenho
        // deixa de importar, o que dispensa ordenar 3200 pontos por Z a cada
        // frame — o custo que inviabilizaria essa contagem em Canvas 2D.
        ctx.globalCompositeOperation = 'lighter';

        this._desenharBloom(cx, cy, raio, brilhoGlobal);
        this._desenharHalo(cx, cy, raio, brilhoGlobal);
        this._desenharAneis(cx, cy, raio, brilhoGlobal);
        this._desenharPontos(cx, cy, raio, brilhoGlobal);
        // O especular vem DEPOIS da nuvem: ele é o reflexo NA superfície, e
        // sob os pontos ele só somaria uma mancha no fundo do palco.
        this._desenharEspecular(cx, cy, raio, brilhoGlobal);

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    /**
     * Desenha uma camada radial centrada, com o raio e a opacidade pedidos.
     *
     * Só a caixa da camada é tocada, nunca o canvas inteiro: com 'lighter'
     * cada pixel é lido e reescrito, e pintar as bordas transparentes era ~35%
     * de preenchimento jogado fora todo quadro.
     */
    _blit(camada, cx, cy, raio, alfa) {
        if (alfa <= 0.002) return;
        const ctx = this.ctx;
        ctx.globalAlpha = alfa > 1 ? 1 : alfa;
        ctx.drawImage(camada, cx - raio, cy - raio, raio * 2, raio * 2);
    }

    /**
     * Bloom: o halo largo que faz a esfera acender o palco em volta dela.
     *
     * Respira mais com a voz que o halo (0.26 contra 0.18) porque é a camada
     * mais externa — é ali que um ganho de raio é percebido como "a esfera
     * cresceu de luz" em vez de "a esfera inchou".
     */
    _desenharBloom(cx, cy, raio, brilho) {
        const pulso = 1 + this.nivelVoz * 0.26;
        this._blit(this.camadas.bloom, cx, cy, raio * 3.05 * pulso, brilho * 0.95);
    }

    _desenharHalo(cx, cy, raio, brilho) {
        const pulso = 1 + this.nivelVoz * 0.18;
        this._blit(this.camadas.halo, cx, cy, raio * 2.15 * pulso, brilho);
        this._blit(this.camadas.nucleo, cx, cy, raio * 0.92, brilho);
    }

    /**
     * Reflexo especular, alto e à esquerda — a mesma direção de luz do orb em
     * CSS que a esfera substitui (`circle at 35% 30%`), para o fallback e o
     * canvas não parecerem iluminados por sóis diferentes.
     */
    _desenharEspecular(cx, cy, raio, brilho) {
        this._blit(
            this.camadas.especular,
            cx - raio * 0.3,
            cy - raio * 0.34,
            raio * 0.62,
            brilho * 0.7
        );
    }

    _desenharAneis(cx, cy, raio, brilho) {
        const ctx = this.ctx;
        const paleta = this.paleta;
        const escalaAnel = this.atual.anel;
        // `tempoAnel` e não `decorrido`: em movimento reduzido a geometria fica
        // congelada, e as órbitas fazem parte dela. Com `decorrido` os anéis
        // continuavam girando mesmo com prefers-reduced-motion.
        const t = this.tempoAnel;
        const alfa = (0.28 + this.nivelVoz * 0.2) * brilho;

        // O brilho do anel vem de um traço largo e fraco sob o traço fino, e
        // NÃO de `shadowBlur`. Medido no Chromium: com shadowBlur ligado nestes
        // traços o quadro passava de 230ms (a esfera caía para ~4fps e o
        // degrau de qualidade despencava); sem ele, fica na casa de 1 dígito.
        ctx.strokeStyle = rgba(paleta.halo, 0.85);

        const tracoFino = Math.max(1, this.dpr * 0.9);
        const tracoHalo = this.dpr * 5;

        for (let i = 0; i < this.aneis.length; i++) {
            const anel = this.aneis[i];
            const rx = raio * anel.raio * escalaAnel;
            const ry = rx * anel.achatamento;
            const rotacao = (t / anel.periodo) * TAU + i * 0.7;

            ctx.lineWidth = tracoHalo;
            ctx.globalAlpha = alfa * 0.3;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, rotacao, 0, TAU);
            ctx.stroke();

            ctx.lineWidth = tracoFino;
            ctx.globalAlpha = alfa;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, rotacao, 0, TAU);
            ctx.stroke();

            for (let n = 0; n < anel.nos; n++) {
                const base = (t / anel.giroNo) * TAU + (n / anel.nos) * TAU + i * 1.9;
                this._desenharNo(cx, cy, rx, ry, rotacao, base, brilho);
            }
        }
    }

    /** Nó luminoso percorrendo um anel, com rastro curto atrás dele. */
    _desenharNo(cx, cy, rx, ry, rotacao, angulo, brilho) {
        const ctx = this.ctx;
        const cosR = Math.cos(rotacao);
        const senR = Math.sin(rotacao);

        for (let p = 0; p < RASTRO_PASSOS; p++) {
            const a = angulo - p * RASTRO_ATRASO;
            const ex = rx * Math.cos(a);
            const ey = ry * Math.sin(a);
            const x = cx + ex * cosR - ey * senR;
            const y = cy + ex * senR + ey * cosR;

            // O nó escurece na metade de trás da órbita: é o que faz o anel
            // parecer atravessar a esfera em vez de ficar colado na frente.
            const profundidade = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(a));
            const desbotar = 1 - p / RASTRO_PASSOS;
            const tamanho = this.dpr * (4.5 * desbotar + 1.2) * profundidade;

            ctx.globalAlpha = Math.min(1, 0.9 * desbotar * desbotar * profundidade * brilho);
            ctx.drawImage(this.sprites.nucleo, x - tamanho, y - tamanho, tamanho * 2, tamanho * 2);
        }
    }

    _desenharPontos(cx, cy, raio, brilho) {
        const ctx = this.ctx;
        const qualidade = NIVEIS_QUALIDADE[this.nivelQualidade];
        const passo = qualidade.passo;
        const tresOitavas = qualidade.oitavas >= 3;

        const pontos = this.pontos;
        const fases = this.fases;
        const variacoes = this.variacoes;
        const ruido = this.ruido;
        const spriteNucleo = this.sprites.nucleo;
        const spriteCorpo = this.sprites.corpo;
        const spriteHalo = this.sprites.halo;

        const t = this.tempo;
        const amplitude = this.atual.amp + AMP_VOZ * this.nivelVoz;
        const ampOnda = this.atual.onda + this.nivelVoz * 0.02;
        const cintila = this.atual.cintila;

        const cosGiro = Math.cos(this.giro);
        const senGiro = Math.sin(this.giro);
        const cosIncl = Math.cos(INCLINACAO);
        const senIncl = Math.sin(INCLINACAO);

        // Deslocamentos temporais das oitavas na proporção 1 : 0.55 : 0.3.
        // Sobrepor velocidades diferentes é o que faz a superfície ler como
        // líquido; uma oitava só produz aquele "respirar" de bola inflando.
        const t1 = t * 0.3;
        const t2 = t * 0.165;
        const t3 = t * 0.09;

        // Pontos pequenos e translúcidos. Em 4.2 e alfa cheio a soma aditiva
        // da sobreposição estourava a esfera em branco e apagava a própria
        // água que ela existe para mostrar.
        //
        // Encolheu de 0.0201 para 0.0182 junto com a subida de 2200 para 3200
        // pontos: a área coberta por partícula cai na mesma proporção em que a
        // contagem sobe, então a nuvem fica mais FINA sem ficar mais densa. É
        // essa troca — mais pontos, cada um menor — que aparece como resolução.
        //
        // O tamanho sai do RAIO, não do lado do canvas: assim ele continua
        // correto quando a esfera ocupa outra fração do quadro. Com a fórmula
        // antiga, um orb pequeno com esfera proporcionalmente grande recebia
        // pontos de menos de 1px e a nuvem virava poeira.
        const tamBase = this.dpr * raio * 0.0182;

        for (let i = 0; i < this.totalPontos; i += passo) {
            const bx = pontos[i * 3];
            const by = pontos[i * 3 + 1];
            const bz = pontos[i * 3 + 2];

            // Frequências ALTAS de propósito. Com a base em 0.8 a oitava mais
            // grave desloca quase a esfera inteira na mesma direção: em
            // amplitude de fala isso deformava a silhueta numa batata, em vez
            // de ondular a superfície. A partir de ~1.5 a onda cabe várias
            // vezes na esfera e lê como líquido.
            let n =
                0.45 * ruido(bx * 1.5 + t1, by * 1.5, bz * 1.5 - t1 * 0.4) +
                0.33 * ruido(bx * 3.1, by * 3.1 + t2, bz * 3.1);
            if (tresOitavas) n += 0.22 * ruido(bx * 5.4 - t3, by * 5.4, bz * 5.4 + t3 * 0.6);

            // Banda de onda subindo pela latitude: o `- t` faz a crista viajar
            // do polo sul para o norte, como no mockup.
            const onda = Math.sin(by * 4.2 - t * 1.5);
            const crista = onda > 0 ? onda : 0;

            const r = 1 + amplitude * n + ampOnda * onda;

            // Rotação em Y, depois inclinação em X.
            const px = bx * cosGiro + bz * senGiro;
            const pzGiro = bz * cosGiro - bx * senGiro;
            const py = by * cosIncl - pzGiro * senIncl;
            const pz = by * senIncl + pzGiro * cosIncl;

            // `FOV - pz` e não `FOV + pz`: a câmera olha do +Z, então pz=+1 é o
            // ponto MAIS PRÓXIMO e tem de crescer. Com o sinal trocado o
            // hemisfério da frente encolhia e anulava o ganho de profundidade
            // que `d` aplica logo abaixo — a esfera ficava chapada.
            const perspectiva = FOV / (FOV - pz * r);
            const x = cx + px * r * raio * perspectiva;
            const y = cy + py * r * raio * perspectiva;

            // Profundidade falsa: o hemisfério de trás fica menor e mais
            // escuro, sem custo de Z-buffer. Quadrática, não cúbica: com o
            // expoente 3 só a calota da frente sobrevivia e a esfera virava
            // confete esparso. Quem achatava a imagem em disco era a exposição
            // alta demais (ver EXPOSICAO), não a curva de profundidade.
            const d = (pz + 1) * 0.5;
            let alfa = (0.05 + 0.95 * d * d) * brilho * EXPOSICAO;
            // A crista da onda acende: com deslocamento pequeno (repouso é
            // 0.02 de raio, ~4px) a ondulação só é perceptível pelo brilho.
            alfa *= 1 + crista * 0.55;
            if (cintila > 0.01) {
                // "Pensando": pontos cintilando em fases fixas, não ruído branco.
                alfa *= 1 - cintila * 0.45 * (0.5 + 0.5 * Math.sin(fases[i] + t * 7.5));
            }
            if (alfa <= 0.004) continue;

            // `variacoes[i]` quebra o que resta da regularidade da grade: com
            // todos os pontos do mesmo tamanho a nuvem ainda lia como textura
            // impressa, não como partículas.
            const tamanho =
                tamBase *
                variacoes[i] *
                (0.35 + 0.95 * d) *
                perspectiva *
                (1 + crista * this.nivelVoz * 0.5);

            ctx.globalAlpha = alfa > 1 ? 1 : alfa;
            const sprite =
                d > 0.78 || crista > 0.85 ? spriteNucleo : d > 0.38 ? spriteCorpo : spriteHalo;
            ctx.drawImage(sprite, x - tamanho, y - tamanho, tamanho * 2, tamanho * 2);
        }
    }
}
