/**
 * @jest-environment jsdom
 */

const path = require('node:path');

const ARQUIVO = path.join(__dirname, '../../../js/voz-sistema.js');

function instalarSintese(vozes) {
    const sintese = {
        cancel: jest.fn(),
        getVoices: jest.fn(() => vozes),
        speak: jest.fn(),
        onvoiceschanged: null,
    };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: sintese });
    window.SpeechSynthesisUtterance = jest.fn(function (texto) {
        this.text = texto;
    });
    return sintese;
}

function carregar(vozes) {
    delete window.VozDoSistema;
    instalarSintese(vozes);
    jest.resetModules();
    require(ARQUIVO);
    return window.VozDoSistema;
}

const VOZES = [
    { voiceURI: 'en', name: 'English', lang: 'en-US', default: true, localService: true },
    { voiceURI: 'pt', name: 'Português', lang: 'pt-PT', localService: true },
    { voiceURI: 'pt-br', name: 'Brasil', lang: 'pt-BR', localService: true },
];

beforeEach(() => {
    localStorage.clear();
    delete window.auth;
});

afterEach(() => {
    delete window.VozDoSistema;
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
});

describe('VozDoSistema', () => {
    it('prioriza pt-BR e atualiza a lista quando o navegador termina de carregá-la', () => {
        const voz = carregar(VOZES);
        const atualizada = jest.fn();
        window.addEventListener('voz-sistema:vozes-atualizadas', atualizada);

        expect(voz.listarVozes().map((item) => item.voiceURI)).toEqual(['pt-br', 'pt', 'en']);
        window.speechSynthesis.onvoiceschanged();
        expect(atualizada).toHaveBeenCalledTimes(1);
    });

    it('mantém preferências separadas para cada conta', () => {
        const voz = carregar(VOZES);

        voz.definirConta('conta-a');
        voz.salvarPreferencias({ voiceURI: 'pt-br', rate: 1.4, volume: 0.6 });
        voz.definirConta('conta-b');
        expect(voz.preferencias()).toEqual({ voiceURI: null, rate: 1, volume: 1 });

        voz.definirConta('conta-a');
        expect(voz.preferencias()).toEqual({ voiceURI: 'pt-br', rate: 1.4, volume: 0.6 });
    });

    it('usa a preferência na leitura e cai em pt-BR quando ela não está disponível', () => {
        const voz = carregar(VOZES);
        voz.definirConta('conta');
        voz.salvarPreferencias({ voiceURI: 'removida', rate: 1.2, volume: 0.4 });

        expect(voz.ouvirPrevia()).toBe(true);
        const utterance = window.SpeechSynthesisUtterance.mock.instances[0];
        expect(utterance.text).toBe(voz.FRASE_PREVIA);
        expect(utterance.voice.voiceURI).toBe('pt-br');
        expect(utterance.rate).toBe(1.2);
        expect(utterance.volume).toBe(0.4);
        expect(window.speechSynthesis.cancel).toHaveBeenCalledTimes(1);
        expect(window.speechSynthesis.speak).toHaveBeenCalledWith(utterance);
    });

    it('não quebra quando a Web Speech API não está disponível', () => {
        delete window.speechSynthesis;
        delete window.SpeechSynthesisUtterance;
        jest.resetModules();
        require(ARQUIVO);

        expect(window.VozDoSistema.disponivel()).toBe(false);
        expect(window.VozDoSistema.listarVozes()).toEqual([]);
        expect(window.VozDoSistema.falar('teste')).toBe(false);
    });
});
