/**
 * @jest-environment jsdom
 */

/**
 * modalVoz.test.js — modal "Voz e Acessibilidade" dos painéis (Issue #564).
 *
 * Carrega os três módulos reais do navegador — o catálogo do narrador
 * (`js/sidebar-voice.js`), o serviço de voz do dispositivo (`js/voz-sistema.js`)
 * e o modal — para que o teste meça o caminho que roda em produção, e não uma
 * cópia: escolher Sarah no modal tem de gravar Sarah, o gênero e chamar o
 * servidor exatamente como a gaveta e o chatbot fazem.
 */

const path = require('node:path');

const RAIZ = path.join(__dirname, '../../..');

const VOZES_DISPOSITIVO = [
    { voiceURI: 'google-br', name: 'Google português do Brasil', lang: 'pt-BR' },
    { voiceURI: 'ms-antonio', name: 'Microsoft Antonio Online (Natural)', lang: 'pt-BR' },
    { voiceURI: 'ms-thalita', name: 'Microsoft Thalita Online (Natural)', lang: 'pt-BR' },
    { voiceURI: 'generica', name: 'Voz Sintetizada', lang: 'en-US' },
];

function instalarSintese() {
    Object.defineProperty(window, 'speechSynthesis', {
        configurable: true,
        value: {
            cancel: jest.fn(),
            speak: jest.fn(),
            getVoices: jest.fn(() => VOZES_DISPOSITIVO),
            onvoiceschanged: null,
        },
    });
    window.SpeechSynthesisUtterance = jest.fn(function (texto) {
        this.text = texto;
    });
}

function carregar({ comSintese = true } = {}) {
    jest.resetModules();
    document.body.innerHTML =
        '<button type="button" id="gatilho" data-abrir-modal-voz>Voz</button>';
    // A saída animada é coberta pelo CSS; aqui o fechamento é imediato.
    document.documentElement.classList.add('reduce-motion');
    if (comSintese) instalarSintese();
    global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
    require(path.join(RAIZ, 'js/sidebar-voice.js'));
    require(path.join(RAIZ, 'js/voz-sistema.js'));
    require(path.join(RAIZ, 'js/modal-voz.js'));
    window.speak = jest.fn();
    window.VozDoSistema.definirConta('conta-professora');
}

function abrirPeloGatilho() {
    const gatilho = document.getElementById('gatilho');
    gatilho.focus();
    gatilho.click();
    return document.getElementById('modal-voz');
}

function vozesVisiveis(dialogo) {
    return [...dialogo.querySelectorAll('[data-mv-voz]')].map((b) => b.dataset.mvVoz);
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

afterEach(() => {
    window.ModalVoz?.fechar();
    delete window.ModalVoz;
    delete window.Vozes;
    delete window.VozDoSistema;
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
    document.documentElement.classList.remove('reduce-motion');
});

describe('Modal de voz', () => {
    it('abre pelo gatilho na aba da voz em uso', () => {
        carregar();
        const dialogo = abrirPeloGatilho();

        expect(window.ModalVoz.estaAberto()).toBe(true);
        // Ninguém escolheu ainda: Brian é o padrão, então abre em Masculinas.
        expect(vozesVisiveis(dialogo)).toEqual(['brian', 'adam', 'eric', 'george']);
        expect(dialogo.querySelector('[data-mv-voz="brian"]').getAttribute('aria-pressed')).toBe(
            'true'
        );
        expect(document.activeElement).toBe(dialogo.querySelector('[data-mv-voz="brian"]'));
    });

    it('escolher uma voz feminina grava a voz, o gênero, toca a prévia e avisa o servidor', () => {
        carregar();
        const dialogo = abrirPeloGatilho();

        dialogo.querySelector('[data-mv-aba="feminina"]').click();
        expect(vozesVisiveis(dialogo)).toEqual(['sarah', 'alice', 'matilda', 'jessica']);

        dialogo.querySelector('[data-mv-voz="sarah"]').click();

        expect(localStorage.getItem('user_elevenlabs_voice')).toBe('sarah');
        expect(localStorage.getItem('user_voice_preference')).toBe('female');
        expect(window.speak).toHaveBeenCalledWith('Voz alterada com sucesso!');
        const corpo = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(corpo).toMatchObject({ elevenlabsVoice: 'sarah', voicePreference: 'female' });
        expect(dialogo.querySelector('[data-mv-voz="sarah"]').getAttribute('aria-pressed')).toBe(
            'true'
        );
    });

    it('reabre na aba Femininas quando a voz em uso é feminina', () => {
        carregar();
        window.Vozes.definir('matilda');
        const dialogo = abrirPeloGatilho();
        expect(vozesVisiveis(dialogo)).toContain('matilda');
        expect(dialogo.querySelector('[data-mv-aba="feminina"]').getAttribute('aria-pressed')).toBe(
            'true'
        );
    });

    it('filtra as vozes do dispositivo por gênero e salva a escolha na conta', () => {
        carregar();
        const dialogo = abrirPeloGatilho();

        dialogo.querySelector('[data-mv-filtro="feminina"]').click();
        const select = dialogo.querySelector('#mv-voz-dispositivo');
        const opcoes = [...select.options].map((o) => o.value).filter(Boolean);
        expect(opcoes.sort()).toEqual(['google-br', 'ms-thalita']);

        select.value = 'ms-thalita';
        select.dispatchEvent(new Event('change'));
        expect(window.VozDoSistema.preferencias().voiceURI).toBe('ms-thalita');

        // Outra conta no mesmo aparelho não herda a escolha.
        window.VozDoSistema.definirConta('outra-conta');
        expect(window.VozDoSistema.preferencias().voiceURI).toBeNull();
    });

    it('avisa quando o navegador não tem voz do gênero filtrado', () => {
        carregar();
        window.speechSynthesis.getVoices.mockReturnValue([
            { voiceURI: 'ms-antonio', name: 'Microsoft Antonio', lang: 'pt-BR' },
        ]);
        const dialogo = abrirPeloGatilho();

        dialogo.querySelector('[data-mv-filtro="feminina"]').click();
        const aviso = dialogo.querySelector('#mv-aviso-dispositivo');
        expect(aviso.hidden).toBe(false);
        expect(aviso.textContent).toContain('femininas');
    });

    it('sem Web Speech API esconde só a voz do dispositivo', () => {
        carregar({ comSintese: false });
        const dialogo = abrirPeloGatilho();

        expect(dialogo.querySelector('#mv-secao-dispositivo').hidden).toBe(true);
        expect(dialogo.querySelector('#mv-secao-narrador').hidden).toBe(false);
    });

    it('troca o modo de leitura', () => {
        carregar();
        const dialogo = abrirPeloGatilho();

        dialogo.querySelector('[data-mv-modo="texto"]').click();
        expect(localStorage.getItem('user_narration_mode')).toBe('texto');
        expect(document.body.classList.contains('preference-texto')).toBe(true);
        expect(dialogo.querySelector('[data-mv-modo="texto"]').getAttribute('aria-pressed')).toBe(
            'true'
        );
    });

    it('fecha pelo botão e pelo Esc, devolvendo o foco ao gatilho', () => {
        carregar();
        let dialogo = abrirPeloGatilho();
        dialogo.querySelector('[data-mv-fechar]').click();
        expect(window.ModalVoz.estaAberto()).toBe(false);
        expect(document.activeElement).toBe(document.getElementById('gatilho'));

        dialogo = abrirPeloGatilho();
        dialogo.dispatchEvent(new Event('cancel', { cancelable: true }));
        expect(window.ModalVoz.estaAberto()).toBe(false);
        expect(document.activeElement).toBe(document.getElementById('gatilho'));
    });
});
