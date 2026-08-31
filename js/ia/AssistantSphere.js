/**
 * AssistantSphere.js — a esfera do assistente, em Canvas 2D puro.
 *
 * Uma nuvem de pontos distribuída por Fibonacci, deslocada radialmente por
 * ruído 3D em três oitavas, com a amplitude comandada pelo nível da voz. O
 * objetivo é que a esfera pareça líquido — não uma bola respirando.
 *
 * Por que Canvas 2D e não WebGL/three.js: esta página é servida sem bundler e
 * a CSP autoriza scripts só por origem própria. `three.min.js` seria ~600kB
 * antes do primeiro pixel numa tela que já carrega o chat inteiro. Com 2200
 * pontos e sprites pré-renderizados, o 2D dá conta em 60fps.
 *
 * ─── Pontos de ajuste visual ────────────────────────────────────────────────
 * PALETAS ....... cores do núcleo/corpo/halo e o âmbar do estado de erro
 * ESTADOS ....... amplitude, velocidade e brilho de cada estado
 * NIVEIS_QUALIDADE passo na nuvem e oitavas de ruído por nível
 * FOV / INCLINACAO enquadramento da esfera
 * RAIO_RELATIVO . tamanho da esfera; ANEIS: raio, inclinação e período de cada órbita
 * ────────────────────────────────────────────────────────────────────────────
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
        fundoInterno: 'rgba(16, 185, 129, 0.10)',
        fundoExterno: 'rgba(3, 8, 7, 0)',
    },
    // Erro NÃO para a água: só troca a paleta para âmbar. Uma esfera
    // congelada seria lida como "a página travou", que é pior que o erro real.
    erro: {
        nucleo: [255, 214, 158],
        corpo: [255, 180, 84],
        halo: [198, 125, 31],
        fundoInterno: 'rgba(255, 180, 84, 0.10)',
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
    ocioso: { amp: 0.02, onda: 0.01, tempo: 1.0, giro: 0.055, anel: 1.0, brilho: 0.84, cintila: 0 },
    ouvindo: {
        amp: 0.03,
        onda: 0.022,
        tempo: 0.85,
        giro: 0.04,
        anel: 0.84,
        brilho: 0.96,
        cintila: 0,
    },
    pensando: {
        amp: 0.018,
        onda: 0.008,
        tempo: 1.3,
        giro: 0.32,
        anel: 1.06,
        brilho: 0.9,
        cintila: 1,
    },
    falando: { amp: 0.03, onda: 0.03, tempo: 2.2, giro: 0.11, anel: 1.1, brilho: 1.0, cintila: 0 },
    erro: {
        amp: 0.026,
        onda: 0.018,
        tempo: 0.9,
        giro: 0.045,
        anel: 0.96,
        brilho: 0.92,
        cintila: 0,
    },
};

/**
 * Ganho global da nuvem de pontos.
 *
 * Com 2200 sprites sobre um disco de ~200px de raio, cada pixel recebe cerca
 * de 3 sprites sobrepostos. Em modo 'lighter' isso multiplica: sem este fator
 * a esfera saturava em branco e virava um prato chapado — o defeito ficou
 * evidente na primeira captura, e nenhuma métrica numérica o teria pego.
 */
const EXPOSICAO = 0.75;

/** Amplitude extra que a voz acrescenta no pico (0.03 + 0.13 ≈ 0.16). */
const AMP_VOZ = 0.13;

/** Fator de interpolação por frame. 0.15 no nível de voz, 0.08 nos parâmetros
 *  de estado — a voz precisa ser responsiva, a troca de estado não. */
const SUAVIZACAO_VOZ = 0.15;
const SUAVIZACAO_ESTADO = 0.08;

/** Pontos da nuvem no nível de qualidade mais alto. */
const TOTAL_PONTOS = 2200;

/**
 * Degraus de qualidade. A queda é automática e só desce: subir de volta faria
 * a esfera oscilar entre dois níveis num notebook que está no limite.
 *
 * O degrau é o PASSO na nuvem, não uma contagem alvo: percorrer o array de
 * Fibonacci de 2 em 2 mantém a distribuição esférica. Declarar a contagem e
 * derivar o passo por divisão dava passo 1 para qualquer alvo acima da
 * metade — o degrau intermediário não reduzia nada.
 */
const NIVEIS_QUALIDADE = [
    { passo: 1, oitavas: 3 }, // 2200 pontos
    { passo: 2, oitavas: 3 }, // 1100 pontos
    { passo: 3, oitavas: 2 }, // ~733 pontos
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
 */
const RAIO_RELATIVO = 0.188;

/** Anéis orbitais: raio relativo, achatamento, período em segundos, nós. */
const ANEIS = [
    { raio: 1.32, achatamento: 0.2, periodo: 62, giroNo: 34, nos: 1 },
    { raio: 1.62, achatamento: 0.34, periodo: -96, giroNo: -51, nos: 1 },
    { raio: 1.95, achatamento: 0.14, periodo: 44, giroNo: 78, nos: 2 },
    { raio: 2.3, achatamento: 0.42, periodo: -124, giroNo: 63, nos: 1 },
];

/** Rastro do nó que percorre o anel: quantas cópias e o quanto elas recuam. */
const RASTRO_PASSOS = 7;
const RASTRO_ATRASO = 0.035;

/** Erros seguidos no laço de render antes de desistir e entregar o fallback. */
const ERROS_ATE_DESISTIR = 8;

const CONSULTA_REDUZIR = '(prefers-reduced-motion: reduce)';

/** Sprite de ponto: 32px basta, o maior ponto desenhado tem ~8px de device. */
const TAM_SPRITE = 32;

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
    gradiente.addColorStop(0, `rgba(${r}, ${v}, ${a}, 1)`);
    gradiente.addColorStop(0.28, `rgba(${r}, ${v}, ${a}, 0.68)`);
    gradiente.addColorStop(0.62, `rgba(${r}, ${v}, ${a}, 0.16)`);
    gradiente.addColorStop(1, `rgba(${r}, ${v}, ${a}, 0)`);

    g.fillStyle = gradiente;
    g.fillRect(0, 0, TAM_SPRITE, TAM_SPRITE);
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
     */
    constructor(canvas, opcoes = {}) {
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) throw new Error('Canvas 2D indisponível.');

        this.canvas = canvas;
        this.ctx = ctx;
        this.medidor = opcoes.medidor || null;
        this.aoFalhar = opcoes.aoFalhar || (() => {});

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

        const paleta = estado === 'erro' ? PALETAS.erro : PALETAS.normal;
        if (paleta !== this.paleta) {
            this.paleta = paleta;
            this.sprites = this._gerarSprites(paleta);
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

    _gerarSprites(paleta) {
        return {
            nucleo: criarSprite(paleta.nucleo),
            corpo: criarSprite(paleta.corpo),
            halo: criarSprite(paleta.halo),
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
        // Teto de 2 no devicePixelRatio: acima disso o ganho visual some e o
        // custo de preenchimento quadruplica em telas 3x.
        const dpr = Math.min(2, window.devicePixelRatio || 1);
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
                this._interpolarEstado(1);
                this._desenhar(0.86 + 0.14 * Math.sin(this.decorrido * 0.06 * TAU));
                return;
            }

            this._interpolarEstado(SUAVIZACAO_ESTADO);

            const esperandoVoz = this.estado === 'falando';
            const bruto = this.medidor ? this.medidor.nivel(this.decorrido, esperandoVoz) : 0;
            this.nivelVoz += (bruto - this.nivelVoz) * SUAVIZACAO_VOZ;

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
            this._desenhar(this.atual.brilho * (1 + this.nivelVoz * 0.22));
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
     */
    _desenhar(brilhoGlobal) {
        const ctx = this.ctx;
        const lado = this.largura;
        if (!lado) return;

        const cx = lado / 2;
        const cy = lado / 2;
        const raio = lado * RAIO_RELATIVO;
        const paleta = this.paleta;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, lado, lado);

        // Brilho difuso do fundo — o gradiente radial quase preto do mockup.
        const fundo = ctx.createRadialGradient(cx, cy, 0, cx, cy, lado * 0.5);
        fundo.addColorStop(0, paleta.fundoInterno);
        fundo.addColorStop(1, paleta.fundoExterno);
        ctx.fillStyle = fundo;
        ctx.fillRect(0, 0, lado, lado);

        // Daqui para baixo tudo soma luz: com 'lighter' a ordem de desenho
        // deixa de importar, o que dispensa ordenar 2200 pontos por Z a cada
        // frame — o custo que inviabilizaria essa contagem em Canvas 2D.
        ctx.globalCompositeOperation = 'lighter';

        this._desenharHalo(cx, cy, raio, brilhoGlobal);
        this._desenharAneis(cx, cy, raio, brilhoGlobal);
        this._desenharPontos(cx, cy, raio, brilhoGlobal);

        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    _desenharHalo(cx, cy, raio, brilho) {
        const ctx = this.ctx;
        const paleta = this.paleta;
        const pulso = 1 + this.nivelVoz * 0.18;

        const raioHalo = raio * 2.15 * pulso;
        const halo = ctx.createRadialGradient(cx, cy, raio * 0.55, cx, cy, raioHalo);
        halo.addColorStop(0, rgba(paleta.corpo, 0.18 * brilho));
        halo.addColorStop(0.42, rgba(paleta.halo, 0.085 * brilho));
        halo.addColorStop(1, rgba(paleta.halo, 0));
        ctx.globalAlpha = 1;
        ctx.fillStyle = halo;
        // Só a caixa do gradiente, não o canvas inteiro: com 'lighter' cada
        // pixel é lido e reescrito, e pintar as bordas transparentes era ~35%
        // de preenchimento jogado fora todo quadro.
        ctx.fillRect(cx - raioHalo, cy - raioHalo, raioHalo * 2, raioHalo * 2);

        // Núcleo: o "miolo" aceso que atravessa a nuvem de pontos. Fraco de
        // propósito — em 0.30 ele somava com a nuvem (que já é aditiva) e
        // estourava o centro da esfera em branco, apagando a textura de água.
        const raioNucleo = raio * 0.92;
        const nucleo = ctx.createRadialGradient(cx, cy, 0, cx, cy, raioNucleo);
        nucleo.addColorStop(0, rgba(paleta.nucleo, 0.1 * brilho));
        nucleo.addColorStop(0.5, rgba(paleta.corpo, 0.035 * brilho));
        nucleo.addColorStop(1, rgba(paleta.corpo, 0));
        ctx.fillStyle = nucleo;
        ctx.fillRect(cx - raioNucleo, cy - raioNucleo, raioNucleo * 2, raioNucleo * 2);
    }

    _desenharAneis(cx, cy, raio, brilho) {
        const ctx = this.ctx;
        const paleta = this.paleta;
        const escalaAnel = this.atual.anel;
        // `tempoAnel` e não `decorrido`: em movimento reduzido a geometria fica
        // congelada, e as órbitas fazem parte dela. Com `decorrido` os anéis
        // continuavam girando mesmo com prefers-reduced-motion.
        const t = this.tempoAnel;
        const alfa = (0.2 + this.nivelVoz * 0.16) * brilho;

        // O brilho do anel vem de um traço largo e fraco sob o traço fino, e
        // NÃO de `shadowBlur`. Medido no Chromium: com shadowBlur ligado nestes
        // traços o quadro passava de 230ms (a esfera caía para ~4fps e o
        // degrau de qualidade despencava); sem ele, fica na casa de 1 dígito.
        ctx.strokeStyle = rgba(paleta.halo, 0.85);

        const tracoFino = Math.max(1, this.dpr * 0.9);
        const tracoHalo = this.dpr * 5;

        for (let i = 0; i < ANEIS.length; i++) {
            const anel = ANEIS[i];
            const rx = raio * anel.raio * escalaAnel;
            const ry = rx * anel.achatamento;
            const rotacao = (t / anel.periodo) * TAU + i * 0.7;

            ctx.lineWidth = tracoHalo;
            ctx.globalAlpha = alfa * 0.22;
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

            ctx.globalAlpha = Math.min(1, 0.75 * desbotar * desbotar * profundidade * brilho);
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
        // dos ~3x de sobreposição estourava a esfera em branco e apagava a
        // própria água que ela existe para mostrar.
        const tamBase = this.dpr * (this.largura / 900) * 3.4;

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
