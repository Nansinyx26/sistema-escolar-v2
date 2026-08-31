/**
 * NivelDeVoz.js — mede, em 0..1, o quanto a voz do assistente está soando
 * agora. É o que faz a esfera "falar junto" com a narração do ElevenLabs.
 *
 * Contrato de segurança do módulo: ele NUNCA pode calar o assistente. Quando
 * a medição real não é possível — AudioContext bloqueado, analyser mudo,
 * navegador sem Web Audio — ele devolve um envelope sintético com cadência de
 * fala em vez de devolver zero. Uma esfera parada durante a narração parece
 * um bug; uma esfera aproximada, não.
 *
 * Sobre CORS: o áudio vindo do backend já chega como Blob e vira
 * `URL.createObjectURL` em `js/sidebar-voice.js`. Blob URL é same-origin, então
 * o analyser lê os dados normalmente. Apontar o `<audio>` direto para a URL da
 * API contaminaria o contexto e `getByteFrequencyData` só devolveria zeros.
 */

const TAU = Math.PI * 2;

/** Faixa da voz humana que interessa para o envelope: fundamental + formantes. */
const HZ_MIN = 100;
const HZ_MAX = 4000;
/** Centro do peso triangular — onde mora a energia perceptível da fala. */
const HZ_FOCO = 700;

/** Leituras zeradas seguidas com o áudio tocando antes de assumir analyser mudo. */
const LEITURAS_MUDAS_ATE_FALLBACK = 40;

/**
 * Envelope sintético de fala. Sílabas a ~6Hz moduladas por uma cadência de
 * frase mais lenta, com respiros — sem isso o fallback vira um zumbido
 * constante, que é justamente o que denuncia que o áudio não está sendo lido.
 *
 * @param {number} t segundos
 * @returns {number} 0..1
 */
function envelopeSintetico(t) {
    const silabas = 0.5 + 0.5 * Math.sin(t * 6.2 * TAU);
    const variacao = 0.62 + 0.38 * Math.sin(t * 1.7 * TAU + 1.3);
    // `max(0, …)` cria o silêncio entre frases: a onda passa metade do
    // período abaixo de zero e é achatada ali.
    const respiro = Math.max(0, Math.sin(t * 0.42 * TAU + 0.7));
    // O ganho 1.6 com corte em 1 não é enfeite: sem ele a média do envelope
    // fica em ~0.14, e a esfera "falando" mal se distingue do repouso, que é
    // exatamente o sintoma que o fallback existe para evitar. O corte faz as
    // sílabas saturarem no pico — o que o envelope de uma voz real também faz.
    return Math.min(1, 1.6 * silabas ** 1.1 * variacao * (0.42 + 0.58 * respiro));
}

/**
 * @typedef {'real'|'sintetico'} ModoMedicao
 */

/**
 * @param {object} [opcoes]
 * @param {(mensagem: string, erro?: unknown) => void} [opcoes.aoRegistrar] log injetável (testes)
 */
export function criarMedidorDeVoz(opcoes = {}) {
    const registrar = opcoes.aoRegistrar || ((m, e) => console.warn('[Voz] ' + m, e || ''));

    const Contexto = window.AudioContext || window.webkitAudioContext;

    /** @type {AudioContext|null} */
    let contexto = null;
    /** @type {AnalyserNode|null} */
    let analisador = null;
    /** @type {Uint8Array|null} */
    let espectro = null;
    /** @type {HTMLAudioElement|null} */
    let elementoAtual = null;

    /**
     * `createMediaElementSource` só pode ser chamado UMA vez por elemento:
     * a segunda chamada lança InvalidStateError e derruba a narração. O mapa
     * guarda a fonte já criada; é fraco para não segurar na memória os
     * `new Audio()` descartados a cada resposta.
     * @type {WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>}
     */
    const fontesPorElemento = new WeakMap();

    /** Índices do espectro correspondentes à faixa da voz, e seus pesos. */
    let faixaInicio = 1;
    let faixaFim = 21;
    /** @type {Float32Array|null} */
    let pesos = null;

    let leiturasMudas = 0;
    let modo = /** @type {ModoMedicao} */ ('sintetico');
    let jaAvisouFalha = false;

    /** Pico decadente: dá ganho automático para vozes gravadas em volume baixo. */
    let pico = 0.12;

    function calcularPesos() {
        if (!contexto || !analisador) return;
        const hzPorBin = contexto.sampleRate / analisador.fftSize;
        faixaInicio = Math.max(1, Math.floor(HZ_MIN / hzPorBin));
        faixaFim = Math.min(analisador.frequencyBinCount - 1, Math.ceil(HZ_MAX / hzPorBin));
        if (faixaFim <= faixaInicio) faixaFim = faixaInicio + 1;

        pesos = new Float32Array(faixaFim - faixaInicio + 1);
        const binFoco = HZ_FOCO / hzPorBin;
        const alcance = Math.max(1, faixaFim - faixaInicio);
        for (let i = 0; i < pesos.length; i++) {
            const distancia = Math.abs(faixaInicio + i - binFoco) / alcance;
            // Peso triangular: 1 no foco, 0.25 nas pontas. Sem isso o grave da
            // trilha e o chiado do topo dominam e o envelope some.
            pesos[i] = Math.max(0.25, 1 - distancia * 1.5);
        }
    }

    /** Cria contexto e analisador na primeira necessidade. */
    function garantirContexto() {
        if (contexto || !Contexto) return contexto;
        try {
            contexto = new Contexto();
            analisador = contexto.createAnalyser();
            analisador.fftSize = 256;
            analisador.smoothingTimeConstant = 0.75;
            espectro = new Uint8Array(analisador.frequencyBinCount);
            // O analisador fica ligado ao destino permanentemente: assim o
            // caminho do som existe antes de qualquer fonte se conectar.
            analisador.connect(contexto.destination);
            calcularPesos();
        } catch (e) {
            contexto = null;
            analisador = null;
            registrar('AudioContext indisponível; usando envelope sintético.', e);
        }
        return contexto;
    }

    /**
     * Destrava o áudio. Precisa ser chamado a partir de um gesto do usuário —
     * o Chrome cria todo AudioContext em `suspended` e só um clique/tecla o
     * libera. Chamar em qualquer outro momento não tem efeito.
     */
    function desbloquear() {
        const ctx = garantirContexto();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    }

    /**
     * Passa a medir o elemento de áudio informado.
     *
     * Se o contexto ainda estiver suspenso, o elemento NÃO é roteado: uma
     * `MediaElementAudioSourceNode` ligada a um contexto suspenso emudece o
     * áudio por completo. Nesse caso preferimos perder a sincronia (fallback
     * sintético) a perder a voz.
     *
     * @param {HTMLAudioElement|null|undefined} elemento
     */
    function observar(elemento) {
        if (!elemento) return;
        elementoAtual = elemento;
        leiturasMudas = 0;
        pico = 0.12;

        const ctx = garantirContexto();
        if (!ctx || !analisador) {
            modo = 'sintetico';
            return;
        }

        if (ctx.state !== 'running') {
            // Tenta destravar para a PRÓXIMA narração; esta fica no sintético.
            ctx.resume().catch(() => {});
            modo = 'sintetico';
            return;
        }

        try {
            let fonte = fontesPorElemento.get(elemento);
            if (!fonte) {
                fonte = ctx.createMediaElementSource(elemento);
                fontesPorElemento.set(elemento, fonte);
                fonte.connect(analisador);
            }
            modo = 'real';
        } catch (e) {
            // Elemento já roteado por outro contexto, ou mídia com CORS.
            modo = 'sintetico';
            if (!jaAvisouFalha) {
                jaAvisouFalha = true;
                registrar('Não foi possível ligar o analisador ao áudio.', e);
            }
        }
    }

    /** Encerra a medição do elemento atual (fim ou interrupção da narração). */
    function soltar() {
        elementoAtual = null;
        leiturasMudas = 0;
    }

    /**
     * Nível de voz agora.
     *
     * @param {number} tempo segundos desde o início da animação
     * @param {boolean} esperandoVoz true quando o assistente deveria estar falando
     * @returns {number} 0..1
     */
    function nivel(tempo, esperandoVoz) {
        if (!esperandoVoz) return 0;

        if (modo === 'real' && analisador && espectro && pesos) {
            try {
                analisador.getByteFrequencyData(espectro);

                let soma = 0;
                let somaPesos = 0;
                for (let i = faixaInicio; i <= faixaFim; i++) {
                    const peso = pesos[i - faixaInicio];
                    soma += espectro[i] * peso;
                    somaPesos += peso;
                }
                const bruto = somaPesos > 0 ? soma / somaPesos / 255 : 0;

                // Áudio realmente tocando e mesmo assim mudo por tempo demais:
                // o analyser está cego (contexto contaminado, faixa silenciosa).
                const tocando = elementoAtual && !elementoAtual.paused;
                if (bruto < 0.01 && tocando) {
                    leiturasMudas += 1;
                    if (leiturasMudas >= LEITURAS_MUDAS_ATE_FALLBACK) {
                        modo = 'sintetico';
                        registrar('Analisador mudo; trocando para envelope sintético.');
                    }
                } else if (bruto >= 0.01) {
                    leiturasMudas = 0;
                }

                // Ganho automático: acompanha o pico recente e decai devagar,
                // para uma voz gravada baixa mover a esfera tanto quanto uma alta.
                pico = Math.max(bruto, pico * 0.996, 0.08);
                return Math.min(1, bruto / pico);
            } catch (e) {
                modo = 'sintetico';
                registrar('Falha ao ler o espectro.', e);
            }
        }

        return envelopeSintetico(tempo);
    }

    /** Solta os recursos de áudio. As fontes morrem junto com os elementos. */
    function destruir() {
        soltar();
        try {
            if (analisador) analisador.disconnect();
            if (contexto && contexto.state !== 'closed') contexto.close();
        } catch {
            // Contexto já encerrado pelo navegador: nada a fazer.
        }
        contexto = null;
        analisador = null;
        espectro = null;
    }

    return {
        desbloquear,
        observar,
        soltar,
        nivel,
        destruir,
        get modo() {
            return modo;
        },
    };
}
