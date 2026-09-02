/**
 * NarradorStream.js — narra a resposta em trechos, na ordem, sem buraco entre
 * um e outro.
 *
 * COMO ELE FICA À FRENTE DO ÁUDIO
 * -------------------------------
 * Cada trecho vira uma requisição a `/api/tts/speak`, que leva de centenas de
 * milissegundos a alguns segundos. Se a busca do trecho seguinte só começasse
 * quando o atual terminasse, a narração ficaria com uma pausa audível a cada
 * frase — pior que a espera única de antes, porque agora ela se repete.
 *
 * Por isso as buscas correm ADIANTADAS: até `MAX_EM_VOO` trechos são
 * sintetizados em paralelo enquanto o primeiro toca. Como o tempo de fala de
 * um trecho é quase sempre maior que o tempo de síntese do próximo, o áudio
 * seguinte já está em memória quando o anterior acaba.
 *
 * Duas em voo, e não a fila toda: sem teto, uma resposta longa dispararia
 * dez requisições no mesmo instante — e o front derrubaria sozinho o limite
 * por hora que existe para proteger a cota paga.
 *
 * POR QUE NÃO USA `window.speak`
 * ------------------------------
 * `window.speak` (de `js/sidebar-voice.js`) busca E toca na mesma chamada, e
 * cala o áudio anterior ao começar. Os dois comportamentos são exatamente o
 * contrário do que uma fila precisa: aqui a busca acontece MUITO antes do
 * play, e o áudio anterior tem de terminar em paz.
 *
 * O que este módulo mantém compatível com ele é o que o resto da página
 * escuta: `window.currentTtsAudio`, o evento `tts:started` (que liga o
 * medidor de voz à esfera) e o `tts:ended`.
 */

/** Requisições de síntese simultâneas. Ver o cabeçalho. */
const MAX_EM_VOO = 2;

/** Trechos que podem falhar em sequência antes de desistir da narração. */
const FALHAS_ATE_DESISTIR = 2;

/**
 * Busca o áudio de um trecho. Mesmo endpoint, mesmo corpo e mesma checagem de
 * tamanho de `window.speak` — o que muda é só não tocar nada aqui.
 *
 * @param {string} texto
 * @param {AbortSignal} sinal
 * @returns {Promise<Blob|null>} null quando o servidor recusa ou devolve vazio
 */
async function buscarAudio(texto, sinal) {
    const base = (window.API_BASE_URL || '/api').replace(/\/$/, '');
    const csrf = document.cookie.match(/csrf_token=([^;]+)/)?.[1] || '';

    const resposta = await fetch(base + '/tts/speak', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
            text: texto,
            voice: 'male',
            provider: 'elevenlabs',
            voiceId: localStorage.getItem('user_elevenlabs_voice') || 'brian',
        }),
        signal: sinal,
    });

    if (!resposta.ok) {
        console.warn('[Voz] TTS recusou o trecho: HTTP ' + resposta.status);
        return null;
    }

    const blob = await resposta.blob();
    // Alguns erros do provedor voltam com 200 e um corpo minúsculo; tocar isso
    // dispara um 'error' no elemento e a fila pularia o trecho sem saber por quê.
    return blob.size < 100 ? null : blob;
}

export class NarradorStream {
    /**
     * @param {object} [opcoes]
     * @param {(trecho: object) => void} [opcoes.aoTocarTrecho] chamado quando o
     *   áudio de um trecho começa — é o gancho do destaque na tela
     * @param {() => void} [opcoes.aoComecar] primeira nota de áudio da resposta
     * @param {() => void} [opcoes.aoTerminar] fila vazia e fechada
     * @param {(mensagem: string) => void} [opcoes.aoFalhar]
     */
    constructor(opcoes = {}) {
        this.aoTocarTrecho = opcoes.aoTocarTrecho || (() => {});
        this.aoComecar = opcoes.aoComecar || (() => {});
        this.aoTerminar = opcoes.aoTerminar || (() => {});
        this.aoFalhar = opcoes.aoFalhar || (() => {});

        /** @type {Array<{trecho: object, promessa: Promise<Blob|null>|null}>} */
        this.fila = [];
        this.emVoo = 0;
        this.falhas = 0;
        this.tocando = false;
        this.comecou = false;
        this.fechada = false;
        this.parado = false;
        /** @type {HTMLAudioElement|null} */
        this.audioAtual = null;
        /** Blob URL do áudio em reprodução, para revogar na hora certa. */
        this.urlAtual = '';
        this.controlador = new AbortController();
    }

    /**
     * Põe um trecho na fila. A busca do áudio começa aqui (respeitando o teto
     * de requisições em voo), não na hora de tocar.
     * @param {{fala: string}} trecho
     */
    enfileirar(trecho) {
        if (this.parado || this.fechada || !trecho?.fala) return;
        this.fila.push({ trecho, promessa: null });
        this._agendarBuscas();
        this._tocarProximo();
    }

    /** Avisa que não vêm mais trechos. A fila ainda toca até o fim. */
    fechar() {
        if (this.parado) return;
        this.fechada = true;
        this._tocarProximo();
    }

    /** Corta tudo: áudio em reprodução, buscas em voo e o que está na fila. */
    parar() {
        if (this.parado) return;
        this.parado = true;
        this.fila = [];

        try {
            this.controlador.abort();
        } catch {
            // Já abortado: nada a fazer.
        }
        this._descartarAudio();
    }

    /** true enquanto ainda há áudio tocando ou trecho para tocar. */
    get ativo() {
        return !this.parado && (this.tocando || this.fila.length > 0);
    }

    // ── Interno ─────────────────────────────────────────────────────────────

    _agendarBuscas() {
        for (let i = 0; i < this.fila.length; i++) {
            const item = this.fila[i];
            if (item.promessa) continue;
            // A CABEÇA da fila ignora o teto de requisições em voo: ela é o
            // áudio que a pessoa está esperando agora, e segurá-la por causa de
            // uma busca adiantada seria trocar latência por nada. Sem esta
            // exceção o teto também poderia deixar o primeiro item sem promessa
            // nenhuma — e `_tocarProximo` leria isso como trecho falhado.
            if (i > 0 && this.emVoo >= MAX_EM_VOO) return;

            this.emVoo += 1;
            item.promessa = buscarAudio(item.trecho.fala, this.controlador.signal)
                .catch((e) => {
                    // Abortar a narração não é falha: é o pedido de quem parou.
                    if (e?.name !== 'AbortError') {
                        console.warn('[Voz] Falha ao sintetizar o trecho:', e?.message);
                    }
                    return null;
                })
                .finally(() => {
                    this.emVoo -= 1;
                    if (!this.parado) this._agendarBuscas();
                });
        }
    }

    async _tocarProximo() {
        if (this.parado || this.tocando) return;

        const item = this.fila[0];
        if (!item) {
            if (this.fechada) this._encerrar();
            return;
        }

        this.tocando = true;
        this._agendarBuscas();

        const blob = await item.promessa;
        // Entre o `await` e aqui a narração pode ter sido cortada — pelo
        // microfone, por uma conversa nova ou pela troca de página.
        if (this.parado) return;

        this.fila.shift();
        this._agendarBuscas();

        if (!blob) {
            this.tocando = false;
            this.falhas += 1;
            if (this.falhas >= FALHAS_ATE_DESISTIR) {
                // Um trecho mudo no meio já é ruim; uma resposta inteira
                // picotada em silêncios é pior que não narrar.
                this.parar();
                this.aoFalhar('Não foi possível gerar o áudio da resposta.');
                return;
            }
            this._tocarProximo();
            return;
        }

        this.falhas = 0;
        this._reproduzir(blob, item.trecho);
    }

    /**
     * @param {Blob} blob
     * @param {object} trecho
     */
    _reproduzir(blob, trecho) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this.audioAtual = audio;
        this.urlAtual = url;

        const seguir = () => {
            if (this.audioAtual !== audio) return; // já substituído ou descartado
            this.audioAtual = null;
            this.urlAtual = '';
            URL.revokeObjectURL(url);
            this.tocando = false;
            if (this.parado) return;
            window.dispatchEvent(new CustomEvent('tts:ended'));
            this._tocarProximo();
        };

        audio.addEventListener('ended', seguir, { once: true });
        // Sem o 'error' um codec recusado no meio deixaria a fila parada para
        // sempre, com o restante da resposta nunca narrado e a esfera presa
        // em "Narrando a resposta...".
        audio.addEventListener('error', seguir, { once: true });

        // `window.currentTtsAudio` é o que `pagina-ia-assistant.js` entrega ao
        // medidor de voz quando ouve `tts:started`. Ele precisa apontar para
        // ESTE elemento antes do evento sair.
        window.currentTtsAudio = audio;

        audio
            .play()
            .then(() => {
                if (this.parado) return;
                if (!this.comecou) {
                    this.comecou = true;
                    this.aoComecar();
                }
                this.aoTocarTrecho(trecho);
                window.dispatchEvent(new CustomEvent('tts:started'));
            })
            .catch((e) => {
                // Autoplay bloqueado (nenhum gesto do usuário ainda) cai aqui.
                // Não adianta insistir nos trechos seguintes: todos morreriam
                // igual, e cada um custa uma requisição de síntese.
                console.warn('[Voz] Reprodução recusada pelo navegador:', e?.message);
                this.parar();
                this.aoFalhar('O navegador bloqueou o áudio. Toque na página e tente de novo.');
            });
    }

    _descartarAudio() {
        const audio = this.audioAtual;
        this.audioAtual = null;
        this.tocando = false;
        if (!audio) return;

        try {
            audio.pause();
        } catch {
            // Elemento já descartado pelo navegador.
        }
        if (this.urlAtual) {
            URL.revokeObjectURL(this.urlAtual);
            this.urlAtual = '';
        }
        if (window.currentTtsAudio === audio) window.currentTtsAudio = null;
    }

    _encerrar() {
        if (this.parado) return;
        this.parado = true;
        this.aoTerminar();
    }
}
