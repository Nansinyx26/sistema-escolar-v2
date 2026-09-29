/**
 * som-notificacao.js — sons curtos do sistema (enviar/receber/aviso).
 *
 * O som de notificação principal usa o arquivo MP3/WAV da pasta /song/.
 * O usuário pode escolher entre vários sons disponíveis; a escolha é
 * persistida em localStorage ('somNotificacaoEscolhido').
 *
 * Se o arquivo de áudio falhar (rede, formato, bloqueio do navegador),
 * o sistema cai no fallback sintetizado via Web Audio API — sem silêncio
 * em nenhum cenário.
 *
 * Sons de chat (receber/enviar) continuam sintetizados: são curtos demais
 * para justificar um request de rede, e o Web Audio API é instantâneo.
 *
 * Por que um módulo compartilhado: o chat mantinha o seu próprio gerador e
 * criava um `AudioContext` NOVO a cada notificação. O navegador limita a
 * quantidade de contextos por aba (~50 no Chrome); numa conversa longa o som
 * simplesmente parava de sair. Aqui existe um único contexto reaproveitado.
 *
 * A preferência de som ligado/desligado continua na chave 'chatSomAtivo' —
 * a mesma que o chat já usava — para quem tinha desligado o som não vê-lo
 * voltar sozinho.
 */
window.SomNotificacao = (function () {
    'use strict';

    var PREF = 'chatSomAtivo';
    var PREF_SOM = 'somNotificacaoEscolhido';
    var SOM_PADRAO = 'notificacao';
    var ctx = null;

    // ── Catálogo de sons disponíveis ─────────────────────────────────
    var SONS = [
        {
            id: 'notificacao',
            nome: 'Principal',
            arquivo: '/song/notificacao.mp3',
            desc: 'Som principal do sistema',
        },
        {
            id: 'sino',
            nome: 'Sino Cristalino',
            arquivo: '/song/sino.wav',
            desc: 'Duas notas subindo, estilo sino',
        },
        { id: 'bolha', nome: 'Bolha', arquivo: '/song/bolha.wav', desc: 'Pop curto e moderno' },
        {
            id: 'gentil',
            nome: 'Chime Gentil',
            arquivo: '/song/gentil.wav',
            desc: 'Arpejo suave, estilo iOS',
        },
        {
            id: 'dong-dong',
            nome: 'Ding-Dong',
            arquivo: '/song/dong-dong.wav',
            desc: 'Campainha de escola',
        },
        {
            id: 'moderno',
            nome: 'Moderno',
            arquivo: '/song/moderno.wav',
            desc: 'Swoosh + nota, Material Design',
        },
        {
            id: 'xilofone',
            nome: 'Xilofone',
            arquivo: '/song/xilofone.wav',
            desc: 'Três notas alegres, som de madeira',
        },
    ];

    // ── Cache de objetos Audio pré-carregados ────────────────────────
    var audioCache = {};
    var audioPronto = {};

    function precarregarSom(id) {
        if (audioCache[id]) return;
        var som = SONS.find(function (s) {
            return s.id === id;
        });
        if (!som) return;
        try {
            var audio = new Audio(som.arquivo);
            audio.preload = 'auto';
            audio.volume = 0.5;
            audio.addEventListener(
                'canplaythrough',
                function () {
                    audioPronto[id] = true;
                },
                { once: true }
            );
            audio.addEventListener(
                'error',
                function () {
                    audioPronto[id] = false;
                },
                { once: true }
            );
            audio.load();
            audioCache[id] = audio;
        } catch (_e) {
            audioCache[id] = null;
            audioPronto[id] = false;
        }
    }

    function precarregarTodos() {
        SONS.forEach(function (s) {
            precarregarSom(s.id);
        });
    }

    /**
     * Toca um som pelo id. Retorna true se conseguiu, false se precisa
     * do fallback sintetizado.
     */
    function tocarArquivo(id) {
        var audio = audioCache[id];
        if (!audio || !audioPronto[id]) return false;
        try {
            audio.currentTime = 0;
            audio.play().catch(function () {
                /* bloqueado pelo navegador */
            });
            return true;
        } catch (_e) {
            return false;
        }
    }

    // ── Preferência do usuário (ligado/desligado) ────────────────────
    function ativo() {
        try {
            return localStorage.getItem(PREF) !== '0';
        } catch (e) {
            return true;
        }
    }

    function definir(on) {
        try {
            localStorage.setItem(PREF, on ? '1' : '0');
        } catch (e) {
            /* storage off */
        }
    }

    // ── Escolha do som ───────────────────────────────────────────────

    /** Retorna o id do som atualmente selecionado. */
    function obterSom() {
        try {
            return localStorage.getItem(PREF_SOM) || SOM_PADRAO;
        } catch (_e) {
            return SOM_PADRAO;
        }
    }

    /** Define o som de notificação (persiste no localStorage). */
    function definirSom(id) {
        var existe = SONS.some(function (s) {
            return s.id === id;
        });
        if (!existe) return;
        try {
            localStorage.setItem(PREF_SOM, id);
        } catch (_e) {
            /* storage off */
        }
        // Pré-carrega o som escolhido.
        precarregarSom(id);
    }

    /** Retorna a lista de sons disponíveis para exibir em configurações. */
    function listarSons() {
        var escolhido = obterSom();
        return SONS.map(function (s) {
            return { id: s.id, nome: s.nome, desc: s.desc, selecionado: s.id === escolhido };
        });
    }

    /**
     * Toca um som específico para teste/preview (ignora debounce e preferência
     * de ligado/desligado). Útil na tela de configurações.
     */
    function testar(id) {
        precarregarSom(id);
        // Pequeno delay para dar tempo do preload se for a primeira vez.
        setTimeout(function () {
            if (!tocarArquivo(id)) {
                // Fallback sintetizado se o arquivo não carregou a tempo.
                tocar(ASSINATURA_FALLBACK);
            }
        }, 100);
    }

    // ── Web Audio API (chat + fallback) ──────────────────────────────
    function contexto() {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!ctx) ctx = new Ctx();
        // Navegadores suspendem o contexto até haver interação do usuário.
        if (ctx.state === 'suspended') ctx.resume().catch(function () {});
        return ctx;
    }

    /**
     * Toca uma sequência de notas sintetizadas.
     * @param {Array<{f:number, ate?:number, inicio:number, dur:number, vol:number, tipo?:string}>} notas
     */
    function tocar(notas) {
        if (!ativo()) return;
        var c = contexto();
        if (!c) return;
        try {
            notas.forEach(function (n) {
                var t0 = c.currentTime + n.inicio;
                var osc = c.createOscillator();
                var gain = c.createGain();
                osc.type = n.tipo || 'sine';
                osc.frequency.setValueAtTime(n.f, t0);
                if (n.ate) osc.frequency.exponentialRampToValueAtTime(n.ate, t0 + n.dur);
                // Ataque curto evita o "clique" de quem começa no volume cheio.
                gain.gain.setValueAtTime(0.0001, t0);
                gain.gain.exponentialRampToValueAtTime(n.vol, t0 + 0.012);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
                osc.connect(gain);
                gain.connect(c.destination);
                osc.start(t0);
                osc.stop(t0 + n.dur + 0.02);
            });
        } catch (e) {
            /* áudio indisponível */
        }
    }

    /** Mensagem recebida: sobe de D5 para A5 (som histórico do chat). */
    function receber() {
        tocar([{ f: 587.33, ate: 880, inicio: 0, dur: 0.25, vol: 0.15 }]);
    }

    /** Mensagem enviada: blip curto e discreto, mais grave que o de chegada. */
    function enviar() {
        tocar([{ f: 880, ate: 523.25, inicio: 0, dur: 0.11, vol: 0.07, tipo: 'triangle' }]);
    }

    // Fallback sintetizado: arpejo Sol→Dó→Mi, usado quando o arquivo não carregou.
    var ASSINATURA_FALLBACK = [
        { f: 783.99, inicio: 0, dur: 0.32, vol: 0.11 }, // G5
        { f: 1567.98, inicio: 0, dur: 0.18, vol: 0.025 },
        { f: 1046.5, inicio: 0.12, dur: 0.34, vol: 0.1 }, // C6
        { f: 2093.0, inicio: 0.12, dur: 0.18, vol: 0.022 },
        { f: 1318.51, inicio: 0.24, dur: 0.65, vol: 0.1 }, // E6
        { f: 2637.02, inicio: 0.24, dur: 0.3, vol: 0.02 },
    ];

    // O mesmo aviso chega por mais de um caminho (socket, toast, push do
    // service worker). Um toque só por aviso: repetição em menos de 1,5 s é
    // ignorada.
    var INTERVALO_MIN_MS = 1500;
    var ultimoAviso = 0;

    /**
     * Aviso do mural / notificação do sistema: toca o som escolhido pelo
     * usuário. Se o arquivo não estiver disponível, cai no sintetizado.
     */
    function aviso() {
        if (!ativo()) return;
        var agora = Date.now();
        if (agora - ultimoAviso < INTERVALO_MIN_MS) return;
        ultimoAviso = agora;

        var somEscolhido = obterSom();
        // Tenta o arquivo primeiro; se falhar, usa o sintetizado.
        if (!tocarArquivo(somEscolhido)) {
            tocar(ASSINATURA_FALLBACK);
        }
    }

    // Push que chega com o sistema aberto em alguma aba: o service worker
    // avisa as páginas, e a página toca o som (a notificação do aparelho, por
    // si, usa o som padrão do sistema operacional).
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', function (e) {
            if (e.data && e.data.tipo === 'notificacao:push') aviso();
        });
    }

    // O primeiro gesto do usuário na página libera o áudio para os sons que
    // chegam depois sem interação nenhuma (mensagem recebida, aviso do mural).
    // Também pré-carrega todos os sons disponíveis.
    ['pointerdown', 'keydown'].forEach(function (ev) {
        window.addEventListener(
            ev,
            function liberar() {
                contexto();
                precarregarTodos();
                window.removeEventListener(ev, liberar);
            },
            { once: true, passive: true }
        );
    });

    return {
        receber: receber,
        enviar: enviar,
        aviso: aviso,
        tocar: tocar,
        ativo: ativo,
        definir: definir,
        // ── Novos métodos para seleção de som ──
        listarSons: listarSons,
        obterSom: obterSom,
        definirSom: definirSom,
        testar: testar,
    };
})();
