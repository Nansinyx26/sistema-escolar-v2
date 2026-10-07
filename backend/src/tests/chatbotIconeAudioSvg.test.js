/**
 * @jest-environment jsdom
 */

/**
 * chatbotIconeAudioSvg.test.js — Issue #712
 *
 * O botão "ouvir" de cada resposta nasce como `<i class="bi bi-volume-up-fill"
 * id="play-icon-N">`, e o js/libs/lucide-init.js troca esse `<i>` por um
 * `<svg>` com o mesmo id. `js/chatbot-ia.js` mudava o ícone com
 * `icon.className = …` — em SVG, `className` é só leitura, e o fim de cada
 * narração estourava "Cannot set property className of #<SVGElement>" antes
 * de devolver o orb ao repouso. Estes testes rodam o script real com o ícone
 * já convertido em `<svg>`.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

let aoTerminar;
let estadosDoOrb;

/** Faz o que o lucide-init.js faz: `<i class="bi …">` vira `<svg>` com o mesmo id. */
function desenharComoLucide() {
    for (const i of document.querySelectorAll('i.bi')) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        if (i.id) svg.id = i.id;
        svg.setAttribute('class', `lucide ${i.className}`);
        i.replaceWith(svg);
    }
}

beforeAll(() => {
    localStorage.setItem('user_preferencia_narracao', 'texto'); // sem narração automática
    window.auth = { getCurrentUser: () => ({ nome: 'Ana Souza', perfil: 'professor' }) };
    window.AudioContext = class {
        state = 'running';
        createAnalyser() {
            return { fftSize: 0, frequencyBinCount: 128 };
        }
        resume() {}
    };
    window.renderLucideIcons = desenharComoLucide;
    window.VoiceOrbManager = {
        state: 'idle',
        ensureMounted() {},
        destroy() {},
        setState(estado) {
            estadosDoOrb.push(estado);
        },
    };
    window.speak = jest.fn(async () => ({
        pause() {},
        addEventListener(evento, fn) {
            if (evento === 'ended') aoTerminar = fn;
        },
    }));

    // O orb só é usado quando o palco existe na página.
    const palco = document.createElement('div');
    palco.id = 'chatbot-voice-orb-container';
    document.body.appendChild(palco);

    require('../../../js/chatbot-ia.js');
});

beforeEach(() => {
    aoTerminar = undefined;
    estadosDoOrb = [];
    // "Conversa limpa…" é uma resposta do assistente, com botão de ouvir.
    document.getElementById('chatbot-clear').click();
    desenharComoLucide();
});

const botaoOuvir = () => document.querySelector('.msg-ai .audio-btn[data-audio="tocar"]');
const icone = () => document.getElementById(`play-icon-${botaoOuvir().dataset.indice}`);

async function tocar() {
    botaoOuvir().click();
    for (let i = 0; i < 20 && !aoTerminar; i++) await new Promise((r) => setTimeout(r, 0));
}

it('o ícone de ouvir já é um <svg> antes do clique', () => {
    expect(icone().namespaceURI).toBe(SVG_NS);
});

it('tocar com o ícone em <svg> mostra o ícone de pausa', async () => {
    await tocar();

    expect(window.speak).toHaveBeenCalled();
    expect(icone().getAttribute('class')).toContain('bi-pause-fill');
});

it('o fim da narração não lança erro, devolve o ícone de ouvir e o orb ao repouso', async () => {
    await tocar();
    desenharComoLucide(); // o ícone de pausa também pode ter virado <svg>

    expect(() => aoTerminar()).not.toThrow();
    expect(icone().getAttribute('class')).toContain('bi-volume-up-fill');
    expect(estadosDoOrb.at(-1)).toBe('idle');
});

it('sem áudio devolvido, o ícone volta para ouvir', async () => {
    window.speak.mockResolvedValueOnce(null);

    botaoOuvir().click();
    await new Promise((r) => setTimeout(r, 0));

    expect(icone().getAttribute('class')).toContain('bi-volume-up-fill');
});
