/**
 * modelosGemini.test.js — Issue #703
 *
 * O `voiceService` (chatbot legado, plano de aula, insights, PEI, narração)
 * tinha a própria cascata de modelos e ainda tentava `gemini-1.5-flash` e
 * `gemini-1.5-pro`, que saíram da API e respondem 404. Agora ele e o copiloto
 * usam a mesma lista.
 */

const { MODELOS_FALLBACK, cascataDeModelos } = require('../services/ia/modelosGemini');

const ENV_ORIGINAL = { ...process.env };

afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
    delete global.fetch;
    jest.resetModules();
});

/** Modelo de cada URL chamada no Gemini. */
const modelosChamados = (fetchMock) =>
    fetchMock.mock.calls.map(([url]) => decodeURIComponent(url.match(/models\/([^:]+):/)[1]));

/** `fetch` que recusa com 429 os modelos de `recusar` e responde aos demais. */
function fetchDoGemini(recusar = []) {
    return jest.fn(async (url) => {
        const modelo = decodeURIComponent(url.match(/models\/([^:]+):/)[1]);
        if (recusar.includes(modelo)) {
            return {
                ok: false,
                status: 429,
                json: async () => ({ error: { message: 'Resource exhausted' } }),
            };
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({ candidates: [{ content: { parts: [{ text: 'Olá.' }] } }] }),
        };
    });
}

describe('cascata de modelos', () => {
    it('não tem modelo desativado', () => {
        for (const modelo of cascataDeModelos()) expect(modelo).not.toMatch(/1\.5/);
    });

    it('começa pelo IA_MODELO e não repete modelo', () => {
        expect(cascataDeModelos('gemini-2.5-flash')).toEqual([
            'gemini-2.5-flash',
            ...MODELOS_FALLBACK.filter((m) => m !== 'gemini-2.5-flash'),
        ]);
    });
});

describe('voiceService.generateInsightText', () => {
    function carregar(fetchMock) {
        process.env.GEMINI_KEY = 'chave-de-teste';
        delete process.env.IA_MODELO;
        global.fetch = fetchMock;
        return require('../services/voiceService');
    }

    it('segue a cascata compartilhada até o primeiro modelo que responde', async () => {
        const cascata = cascataDeModelos();
        const fetchMock = fetchDoGemini(cascata.slice(0, 2));
        const voiceService = carregar(fetchMock);

        const texto = await voiceService.generateInsightText('Diga olá');

        expect(texto).toBe('Olá.');
        expect(modelosChamados(fetchMock)).toEqual(cascata.slice(0, 3));
    });

    it('com todos recusando, tenta cada modelo uma vez e nenhum 1.5', async () => {
        const fetchMock = fetchDoGemini(cascataDeModelos());
        const voiceService = carregar(fetchMock);

        await expect(voiceService.generateInsightText('Diga olá')).rejects.toMatchObject({
            quotaExceeded: true,
        });
        const chamados = modelosChamados(fetchMock);
        expect(chamados).toEqual(cascataDeModelos());
        expect(chamados.some((m) => m.includes('1.5'))).toBe(false);
    });
});
