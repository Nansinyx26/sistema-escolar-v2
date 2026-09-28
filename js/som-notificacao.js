/**
 * som-notificacao.js — sons curtos do sistema (enviar/receber/aviso).
 *
 * Sintetizados via Web Audio API: nenhum arquivo .mp3 para baixar, nenhum
 * request extra, e o som toca no mesmo instante do evento.
 *
 * Por que um módulo compartilhado: o chat mantinha o seu próprio gerador e
 * criava um `AudioContext` NOVO a cada notificação. O navegador limita a
 * quantidade de contextos por aba (~50 no Chrome); numa conversa longa o som
 * simplesmente parava de sair. Aqui existe um único contexto reaproveitado.
 *
 * A preferência continua na chave 'chatSomAtivo' — a mesma que o chat já
 * usava — para quem tinha desligado o som não vê-lo voltar sozinho.
 */
window.SomNotificacao = (function () {
    'use strict';

    const PREF = 'chatSomAtivo';
    let ctx = null;

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

    function contexto() {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!ctx) ctx = new Ctx();
        // Navegadores suspendem o contexto até haver interação do usuário.
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        return ctx;
    }

    /**
     * Toca uma sequência de notas.
     * @param {Array<{f:number, ate?:number, inicio:number, dur:number, vol:number, tipo?:string}>} notas
     */
    function tocar(notas) {
        if (!ativo()) return;
        const c = contexto();
        if (!c) return;
        try {
            notas.forEach((n) => {
                const t0 = c.currentTime + n.inicio;
                const osc = c.createOscillator();
                const gain = c.createGain();
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

    /**
     * Som próprio das notificações do sistema (Issue #540): três notas
     * subindo em arpejo — Sol, Dó, Mi — com um harmônico de oitava em cada uma
     * para soar como sino, e a última mais longa, como um "chegou".
     * É o mesmo no painel da equipe e no portal do responsável, para quem usa
     * o sistema reconhecer o aviso da escola de ouvido.
     */
    const ASSINATURA = [
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
    const INTERVALO_MIN_MS = 1500;
    let ultimoAviso = 0;

    /** Aviso do mural / notificação do sistema: o som próprio da escola. */
    function aviso() {
        const agora = Date.now();
        if (agora - ultimoAviso < INTERVALO_MIN_MS) return;
        ultimoAviso = agora;
        tocar(ASSINATURA);
    }

    // Push que chega com o sistema aberto em alguma aba: o service worker
    // avisa as páginas, e a página toca o som (a notificação do aparelho, por
    // si, usa o som padrão do sistema operacional).
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', (e) => {
            if (e.data && e.data.tipo === 'notificacao:push') aviso();
        });
    }

    // O primeiro gesto do usuário na página libera o áudio para os sons que
    // chegam depois sem interação nenhuma (mensagem recebida, aviso do mural).
    ['pointerdown', 'keydown'].forEach((ev) => {
        window.addEventListener(
            ev,
            function liberar() {
                contexto();
                window.removeEventListener(ev, liberar);
            },
            { once: true, passive: true }
        );
    });

    return { receber, enviar, aviso, tocar, ativo, definir };
})();
